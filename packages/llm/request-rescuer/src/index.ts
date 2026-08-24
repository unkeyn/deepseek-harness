/**
 * Transient-failure rescuer on the agent loop's `agent/request-error`
 * waterfall. The exact-provider retry executor (`dsh-llm-retry`) owns the
 * first answer for every failed model request; this plugin runs upstream of
 * that decision and rescues only what it declined: failures whose provider
 * vocabulary says "transient" but whose normalized code is not in any
 * configured `retryableCodes` ??? the observed case being gateways answering
 * 400 with an `upstream_unavailable` body, which normalizes to
 * `INVALID_REQUEST` and otherwise kills the turn.
 *
 * Every rescue is durable: it reuses the `llm/retry` / `llm/retry-started`
 * session events under a `rescuer:`-namespaced policy key, so budgets are
 * read back from the log (counts survive restarts) and the UI shows the same
 * retry status it shows for policy retries.
 *
 * @module @deepseek-ai/dsh-request-rescuer
 */

import { randomUUID } from 'node:crypto'
import type { Context, Events } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { RequestErrorAction } from '@deepseek-ai/dsh-agent'
import type { LlmFailure } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { RetryId } from '@deepseek-ai/dsh-llm-retry'
import type { LlmRetryEventData } from '@deepseek-ai/dsh-llm-retry/types'

export const name = 'request-rescuer'

/** One configured rescue rule: a transient vocabulary match plus its own bounded budget. */
export interface RescuePattern {
  /**
   * ECMAScript regex source (compiled case-insensitive) tested against the
   * composite `"code message"` text of the failure.
   */
  match: string
  /** Normalized failure codes eligible for this rule; empty means any code. */
  codes?: string[]
  /** Rescue attempts allowed per request coordinate (default `4`). */
  maxRetries?: number
  /** Backoff floor in milliseconds (default `1000`). */
  initialDelayMs?: number
  /** Backoff ceiling in milliseconds (default `20000`). */
  maxDelayMs?: number
}

/**
 * Plugin config. An empty `patterns` list makes the plugin inert by choice;
 * every entry fails loud at load when its regex source does not compile or a
 * bound is not an integer >= 1.
 */
export interface Config {
  /** Rescue rules, evaluated in order; the first match owns the failure. */
  patterns?: RescuePattern[]
}

export const Config: z<Config> = z.object({
  patterns: z.array(z.object({
    match: z.string(),
    codes: z.array(z.string()).default([]),
    maxRetries: z.number().default(4),
    initialDelayMs: z.number().default(1000),
    maxDelayMs: z.number().default(20_000),
  })).default([]),
})

/** A validated rule with its compiled matcher and resolved numeric bounds. */
interface CompiledPattern {
  readonly key: string
  readonly matcher: RegExp
  readonly codes: ReadonlySet<string>
  readonly maxRetries: number
  readonly initialDelayMs: number
  readonly maxDelayMs: number
}

function compile(patterns: readonly RescuePattern[]): readonly CompiledPattern[] {
  return patterns.map((pattern, index) => {
    let matcher: RegExp
    try {
      matcher = new RegExp(pattern.match, 'i')
    } catch (error) {
      throw new Error(`request-rescuer: patterns[${index}].match does not compile`, { cause: error })
    }
    const maxRetries = pattern.maxRetries ?? 4
    const initialDelayMs = pattern.initialDelayMs ?? 1000
    const maxDelayMs = pattern.maxDelayMs ?? 20_000
    for (const [field, value] of [
      ['maxRetries', maxRetries],
      ['initialDelayMs', initialDelayMs],
      ['maxDelayMs', maxDelayMs],
    ] as const) {
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`request-rescuer: patterns[${index}].${field} must be an integer >= 1`)
      }
    }
    if (initialDelayMs > maxDelayMs) {
      throw new Error(`request-rescuer: patterns[${index}] initialDelayMs exceeds maxDelayMs`)
    }
    return {
      key: `rescuer:${index}`,
      matcher,
      codes: new Set(pattern.codes ?? []),
      maxRetries,
      initialDelayMs,
      maxDelayMs,
    }
  })
}

/** The composite text a rule's matcher runs against. */
function failureText(failure: LlmFailure): string {
  return `${failure.code} ${failure.message}`
}

/** Cancellable wait resolving to `false` when the signal won the race. */
function cancellableDelay(delayMs: number, signal: AbortSignal): Promise<boolean> {
  /* v8 ignore next -- cancellation lands while the wait is pending (the turn can only abort after a failure), never before this call. */
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, delayMs)
    function onAbort(): void {
      clearTimeout(timer)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Non-serializable hooks used to make timing deterministic in tests. */
export interface RescuerInternals {
  /** Random sample in the inclusive zero-to-one range used for jitter. */
  random?: () => number
}

/** The rule-owned durable retry event, narrowed from the shared session map entry. */
type RescuerRetryEvent = SessionEvent<'llm/retry'> & { data: Extract<LlmRetryEventData, { mode: 'normal' }> }

/**
 * Install the rescuer's listener.
 * @param ctx - plugin context; the listener and its lifetime abort are scoped to it.
 * @param config - validated {@link Config}.
 * @param internals - non-serializable deterministic hooks for tests.
 */
export function apply(ctx: Context, config: Config = {}, internals: RescuerInternals = {}): void {
  const patterns = compile(config.patterns ?? [])
  const random = internals.random ?? Math.random
  const lifetime = new AbortController()

  ctx.effect(() => async () => {
    lifetime.abort(new Error('request-rescuer plugin disposed'))
  }, 'request-rescuer: cancel pending rescue waits')

  ctx.on('agent/request-error', async (
    { agent, turn, step, provider, failure, signal }: Parameters<Events['agent/request-error']>[0],
    next: () => Promise<RequestErrorAction>,
  ): Promise<RequestErrorAction> => {
    // Delegate first: the exact-provider executor owns the first answer, and
    // its decision (or any later listener's) wins whenever it chooses to act.
    const downstream = await next()
    if (downstream?.kind === 'retry') return downstream

    const fusedSignal = AbortSignal.any([signal, lifetime.signal])
    /* v8 ignore next -- the lifetime abort fires only from this plugin's own disposal, which removes this listener in the same step. */
    if (fusedSignal.aborted) return downstream
    const pattern = patterns.find(candidate =>
      (candidate.codes.size === 0 || candidate.codes.has(failure.code))
      && candidate.matcher.test(failureText(failure)))
    if (pattern === undefined) return downstream

    // Budget reads flow from the durable log under this rule's own policy-key
    // namespace, so counts survive restarts and never collide with the
    // exact-provider executor's keys.
    const prior = agent.session.events.findLast((event): event is RescuerRetryEvent =>
      event.type === 'llm/retry'
      && event.data.mode === 'normal'
      && event.data.turn === turn
      && event.data.step === step
      && event.data.provider === provider
      && event.data.policyKey === pattern.key)
    const previousRetry = prior?.data.retry ?? 0
    if (previousRetry >= pattern.maxRetries) return downstream

    const retry = previousRetry + 1
    const retryId = prior?.data.retryId ?? RetryId(randomUUID())
    const exponential = Math.min(pattern.initialDelayMs * 2 ** previousRetry, pattern.maxDelayMs)
    const delayMs = Math.round(exponential * (1 + random() * 0.2 - 0.1))
    agent.session.append('llm/retry', {
      retryId,
      turn,
      step,
      provider,
      mode: 'normal',
      policyKey: pattern.key,
      retry,
      maxRetries: pattern.maxRetries,
      delayMs,
      failure,
    })
    if (!await cancellableDelay(delayMs, fusedSignal)) return undefined
    agent.session.append('llm/retry-started', { retryId, turn, step, retry })
    return { kind: 'retry' }
  })
}

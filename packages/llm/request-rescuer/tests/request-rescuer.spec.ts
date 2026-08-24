import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage, LlmAdapter, LlmError, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  NormalRetryPolicyConfig,
  ResolvedRetryPolicy,
  RetryPolicyConfig,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import * as llmRetry from '../../llm-retry/src/index.ts'
import { textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as rescuer from '../src/index.ts'

/**
 * Behavior suite for the transient-failure rescuer: delegation to the
 * exact-provider executor, vocabulary-gated rescue of misclassified
 * transient failures with durable budgeted retries, pass-through for
 * unmatched failures and exhausted budgets, abort cooperation, and fail-loud
 * config validation.
 */

type ScriptEntry = Error | Iterable<StreamChunk>

it('declares the shared llm/retry event map entry', () => {
  expectTypeOf<SessionEventMap['llm/retry']>().not.toBeNever()
})

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  private policies: Readonly<Record<string, ResolvedRetryPolicy | undefined>> = {}

  constructor(private readonly entries: ScriptEntry[]) {
    super()
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.entries.shift()
    if (entry === undefined) throw new Error('rescuer test script exhausted')
    if (entry instanceof Error) throw entry
    yield* entry
  }

  configureRetryPolicies(policies: Readonly<Record<string, RetryPolicyConfig | undefined>>): void {
    this.policies = Object.fromEntries(Object.entries(policies).map(([provider, policy]) => [
      provider,
      policy === undefined ? undefined : resolveRetryPolicy(policy, `rescuer test provider "${provider}" retryPolicy`),
    ]))
  }

  override providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined {
    return this.policies[provider]
  }
}


/** A 400 whose gateway vocabulary says transient, normalizing to a non-retryable code. */
const upstreamError = (): Error => new LlmError(
  'OpenAI API error (400): {"type":"upstream_unavailable","message":"upstream unavailable"}',
  'INVALID_REQUEST',
)

async function harness(
  adapter: ScriptedAdapter,
  config: rescuer.Config,
  options: {
    beforeRescuer?: (ctx: Context) => void
    internals?: rescuer.RescuerInternals
    policies?: Readonly<Record<string, RetryPolicyConfig | undefined>>
  } = {},
): Promise<{ ctx: Context; rescuerFiber: Fiber }> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  options.beforeRescuer?.(ctx)
  adapter.configureRetryPolicies(options.policies ?? { mock: undefined })
  const rescuerFiber = await ctx.plugin(Object.assign((inner: Context) => {
    rescuer.apply(inner, config, options.internals ?? { random: () => 0.5 })
  }, { inject: ['agents'] }))
  await ctx.plugin(Object.assign((inner: Context) => {
    llmRetry.apply(inner)
  }, { inject: llmRetry.inject }))
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.llm.registerAdapter(['mock'], adapter)
  return { ctx, rescuerFiber }
}

function waitForIdle(ctx: Context, agent: ReturnType<Context['agentLoop']['create']>): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') { dispose(); resolve() }
    })
  })
}

function retries(agent: ReturnType<Context['agentLoop']['create']>): { policyKey: string; retry: number; delayMs: number }[] {
  return [...agent.session.events]
    .filter((event): event is SessionEvent<'llm/retry'> => event.type === 'llm/retry')
    .map(event => ({ policyKey: event.data.policyKey, retry: event.data.retry, delayMs: event.data.delayMs }))
}

describe('rescue behavior', () => {
  it('rescues a misclassified upstream failure the exact-provider policy declines', async () => {
    const adapter = new ScriptedAdapter([upstreamError(), textResponse('recovered')])
    const { ctx } = await harness(adapter, {
      patterns: [{ match: 'upstream[_ -]?unavailable', codes: ['INVALID_REQUEST'], maxRetries: 3, initialDelayMs: 1, maxDelayMs: 4 }],
    })
    const agent = ctx.agentLoop.create(SessionId('rescue-recovers'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(2)
    const scheduled = retries(agent)
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]!.policyKey).toMatch(/^rescuer:/)

    const ended = [...agent.session.events].findLast(event => event.type === 'turn/end')
    expect(ended?.data.reason.kind).toBe('completed')
  })

  it('stops at the pattern budget and preserves the original failure', async () => {
    const adapter = new ScriptedAdapter(Array.from({ length: 5 }, () => upstreamError()))
    const { ctx, rescuerFiber } = await harness(adapter, {
      patterns: [{ match: 'upstream[_ -]?unavailable', codes: ['INVALID_REQUEST'], maxRetries: 3, initialDelayMs: 2, maxDelayMs: 3 }],
    })
    const agent = ctx.agentLoop.create(SessionId('rescue-budget'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const scheduled = retries(agent)
    expect(scheduled).toHaveLength(3)
    // Backoff grows 2 ??? 3 (capped) ??? 3, deterministic under the fixed jitter sample.
    expect(scheduled.map(entry => entry.delayMs)).toEqual([2, 3, 3])
    expect(adapter.requests).toHaveLength(4)
    const ended = [...agent.session.events].findLast(event => event.type === 'turn/end')
    expect(ended?.data.reason).toMatchObject({ kind: 'error', error: { code: 'INVALID_REQUEST' } })

    // Disposal removes the listener: a later failing turn gets no rescue.
    await rescuerFiber.dispose()
    const afterDispose = new ScriptedAdapter([upstreamError()])
    ctx.llm.registerAdapter(['mock2'], afterDispose)
    const second = ctx.agentLoop.create(SessionId('rescue-disposed'), { provider: 'mock2', model: 'mock' })
    second.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, second)
    expect([...second.session.events].filter(event => event.type === 'llm/retry')).toHaveLength(0)
  })

  it('leaves failures outside the configured vocabulary untouched', async () => {
    const adapter = new ScriptedAdapter([new LlmError('OpenAI API error (400): {"type":"bad_schema"}', 'INVALID_REQUEST'), textResponse('nope')])
    const { ctx } = await harness(adapter, {
      patterns: [{ match: 'upstream[_ -]?unavailable', codes: ['INVALID_REQUEST'], initialDelayMs: 1 }],
    })
    const agent = ctx.agentLoop.create(SessionId('rescue-unmatched'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(retries(agent)).toHaveLength(0)
    expect(adapter.requests).toHaveLength(1)
  })

  it('yields to the exact-provider executor when it already owns the retry', async () => {
    // RATE_LIMIT is in llm-retry's default retryable set, so its decision must
    // win and no rescuer-namespaced event may appear.
    const adapter = new ScriptedAdapter([
      new LlmError('OpenAI API error (429): {"code":"rate_limited"}', 'RATE_LIMIT'),
      textResponse('policy handled it'),
    ])
    const policy: NormalRetryPolicyConfig = { mode: 'normal', maxRetries: 2, retryableCodes: ['RATE_LIMIT'], backoff: { initialDelayMs: 1, maxDelayMs: 2, jitterRatio: 0 } }
    const { ctx } = await harness(adapter, {
      patterns: [{ match: 'rate.?limit' }],
    }, { policies: { mock: policy } })
    const agent = ctx.agentLoop.create(SessionId('rescue-yields'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(2)
    const scheduled = retries(agent)
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]!.policyKey).not.toMatch(/^rescuer:/)
  })

  it('cooperates with turn cancellation during the rescue wait', async () => {
    const adapter = new ScriptedAdapter([upstreamError(), textResponse('never reached')])
    const { ctx } = await harness(adapter, {
      patterns: [{ match: 'upstream[_ -]?unavailable', initialDelayMs: 60_000, maxDelayMs: 61_000 }],
    })
    const agent = ctx.agentLoop.create(SessionId('rescue-cancel'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await vi.waitFor(() => expect(retries(agent)).toHaveLength(1))
    agent.cancel({ kind: 'user' })
    await waitForIdle(ctx, agent)

    expect(adapter.requests).toHaveLength(1)
    const started = [...agent.session.events].filter(event => event.type === 'llm/retry-started')
    expect(started).toHaveLength(0)
  })
})

describe('config validation', () => {
  const base = { match: 'x', initialDelayMs: 1, maxDelayMs: 2 }

  it('accepts a bare apply with every default in place', () => {
    expect(() => rescuer.apply(new Context())).not.toThrow()
  })

  it('rejects an uncompilable matcher', () => {
    expect(() => rescuer.apply(new Context(), { patterns: [{ match: '(' }] })).toThrow(/does not compile/)
  })

  it('rejects non-positive bounds and inverted delays', () => {
    expect(() => rescuer.apply(new Context(), { patterns: [{ ...base, maxRetries: 0 }] })).toThrow(/maxRetries/)
    expect(() => rescuer.apply(new Context(), { patterns: [{ ...base, initialDelayMs: 0 }] })).toThrow(/initialDelayMs/)
    expect(() => rescuer.apply(new Context(), { patterns: [{ match: 'x', initialDelayMs: 10, maxDelayMs: 5 }] })).toThrow(/exceeds/)
  })

  it('accepts an empty pattern list as inert by choice', async () => {
    const adapter = new ScriptedAdapter([upstreamError()])
    const { ctx } = await harness(adapter, { patterns: [] })
    const agent = ctx.agentLoop.create(SessionId('rescue-inert'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(retries(agent)).toHaveLength(0)
  })
})

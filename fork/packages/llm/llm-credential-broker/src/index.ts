/** Broker-backed LLM adapter decorator for bounded credential failover. */
import type { Context } from '@deepseek-ai/cordis'
import { CredentialBroker } from '@deepseek-ai/dsh-fork-credential-broker'
import type { CredentialBrokerRequest, CredentialId, CredentialLease, LeaseCompletion, LeaseId } from '@deepseek-ai/dsh-fork-credential-broker'
import type { CredentialHealth, HealthDisposition, ProviderFailureEvidence } from '@deepseek-ai/dsh-fork-credential-health'
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-fork-llm'
import type { GenerateOptions, LlmFailure, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, ResolvedRetryPolicy, StreamChunk } from '@deepseek-ai/dsh-fork-llm'

/** Broker capability that releases a lease and persists one classified health decision. */
export interface HealthAwareBroker extends CredentialBroker {
  completeWithHealth(id: LeaseId, completion: LeaseCompletion, disposition: HealthDisposition): Promise<void>
}

/** Provider-specific callback that receives the resolved secret for one attempt. */
export type CredentialStream = (options: GenerateOptions, credential: string) => AsyncIterable<StreamChunk>

/** Finite credential failover decision applied to one adapter stream call. */
export interface FailoverPolicy {
  /** Total provider attempts, including the initial attempt. */
  readonly maxAttempts: number
  /** Failure codes that permit another credential attempt. */
  readonly retryableCodes: readonly string[]
}

/** The route facts one failover decision reads. */
export type FailoverRequest = Pick<GenerateOptions, 'provider' | 'model'>

/**
 * Static policy validated once at construction, or a resolver read per stream
 * call. Resolving to `undefined` bypasses the broker for that call, so a
 * provider without pool entries streams through the delegate unchanged.
 */
export type FailoverPolicySource = FailoverPolicy | ((request: FailoverRequest) => FailoverPolicy | undefined)

/** The provider route one attempt bills against: fixed, or read per request
 * for a multi-route adapter instance. */
export type ProviderSource = string | ((request: FailoverRequest) => string)

/** Classifier instance, or a resolver read per failure; `undefined` skips classification. */
export type HealthSource = CredentialHealth | (() => CredentialHealth | undefined)

/** Optional brokered adapter settings. */
export interface BrokeredLlmAdapterOptions {
  readonly failover?: FailoverPolicySource
  /** Classifies failure evidence into durable credential health decisions. */
  readonly health?: HealthSource
}

const NO_FAILOVER: FailoverPolicy = Object.freeze({ maxAttempts: 1, retryableCodes: Object.freeze([]) })

/**
 * Adapter decorator that owns one broker lease per network attempt. A failed
 * lease is completed before another lease is acquired, and credential ids used
 * by the current finite failover decision are excluded from later selection.
 * With a health classifier, failures persist the classified disposition
 * (cooldown, quarantine, model exclusion) instead of leaving credential state
 * untouched. An acquire rejection — the pool can offer no credential this
 * decision has not already consumed — ends the decision and surfaces the last
 * provider failure instead of the broker error.
 *
 * A dynamic policy or health resolver may name services that compose in
 * parallel: while they are absent the decorator streams through the delegate,
 * and pooling starts once the resolvers answer. A static policy instead
 * requires its services at construction, so misconfiguration fails at
 * composition.
 */
export class BrokeredLlmAdapter extends LlmAdapter {
  private readonly ctx: Context
  private readonly failover: (request: FailoverRequest) => FailoverPolicy | undefined
  private readonly health: HealthSource | undefined

  constructor(
    ctx: Context,
    private readonly provider: ProviderSource,
    private readonly delegate: LlmAdapter,
    private readonly streamWithCredential: CredentialStream,
    options: BrokeredLlmAdapterOptions = {},
  ) {
    super()
    this.ctx = ctx
    const broker = ctx.get('credentialBroker')
    const credentials = ctx.get('credentials')
    const dynamic = typeof options.failover === 'function'
    if ((broker === undefined || credentials === undefined) && !dynamic) {
      throw new Error('brokered LLM adapter requires credentialBroker and credentials services')
    }
    this.failover = dynamic
      ? options.failover as (request: FailoverRequest) => FailoverPolicy | undefined
      : () => resolveFailoverPolicy(options.failover as FailoverPolicy) ?? NO_FAILOVER
    // A static policy validates eagerly so misconfiguration fails at composition.
    if (!dynamic) resolveFailoverPolicy(options.failover as FailoverPolicy)
    this.health = options.health
    if (options.health !== undefined && !(options.health instanceof Function)) {
      // A classifier given outright is only usable when the constructor-time
      // broker can persist its decisions; anything else is misconfiguration.
      if (broker === undefined || typeof (broker as HealthAwareBroker).completeWithHealth !== 'function') {
        throwHealthUnsupported()
      }
    }
  }

  /** Resolve the classifier for one failure, or `undefined` when absent or unsupported. */
  private classifyWith(evidence: ProviderFailureEvidence): { disposition: HealthDisposition; broker: HealthAwareBroker } | undefined {
    const candidate = this.health instanceof Function ? this.health() : this.health
    const broker = this.ctx.get('credentialBroker') as HealthAwareBroker | undefined
    if (candidate === undefined || broker === undefined) return undefined
    if (typeof broker.completeWithHealth !== 'function') return undefined
    return { disposition: candidate.classify(evidence), broker }
  }

  override providerInfo(provider: string): LlmProviderInfo { return this.delegate.providerInfo(provider) }
  override providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined {
    const failover = this.failover({ provider, model: '' })
    const policy = this.delegate.providerRetryPolicy(provider)
    if (failover === undefined || policy === undefined || policy.mode !== 'normal' || failover.maxAttempts <= 1) return policy
    const requiredRetries = failover.maxAttempts - 1
    if (policy.maxRetries >= requiredRetries) return policy
    return Object.freeze({ ...policy, maxRetries: requiredRetries })
  }
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> { return this.delegate.listModels(provider) }
  override resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    return this.delegate.resolveModel(provider, model, signal)
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.runAttempts(options)
  }

  private async* runAttempts(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const route: FailoverRequest = { provider: providerOf(this.provider, options), model: options.model }
    const failover = this.failover(route)
    const broker = this.ctx.get('credentialBroker')
    const credentials = this.ctx.get('credentials')
    // A dynamic resolver may answer before its composition finished loading;
    // until the broker and credential seam exist there is nothing to pool.
    if (failover === undefined || broker === undefined || credentials === undefined) {
      yield* this.delegate.stream(options)
      return
    }
    const attempted = new Set<CredentialId>()
    let lastFailure: LlmFailure | undefined
    let acquireFailure: LlmFailure | undefined

    for (let attempt = 0; attempt < failover.maxAttempts; attempt += 1) {
      const request: CredentialBrokerRequest = {
        provider: route.provider,
        model: options.model,
        ...options.sessionId === undefined ? {} : { sessionId: options.sessionId },
        purpose: options.purpose ?? 'conversation',
        ...(attempted.size === 0 ? {} : { excludedCredentials: [...attempted] }),
        ...options.signal === undefined ? {} : { signal: options.signal },
      }
      let lease: CredentialLease
      try {
        lease = await broker.acquire(request)
      } catch (error) {
        // An abort while parked rethrows so the caller observes cancellation;
        // any other rejection means no credential can ever serve this decision
        // (every key consumed, disabled, or quarantined), so further attempts
        // cannot change the outcome.
        if (options.signal?.aborted) throw error
        acquireFailure = failureOf(error)
        this.ctx.logger.info(`key pool for provider "${route.provider}" offered no credential (attempt ${attempt + 1}/${failover.maxAttempts}): ${acquireFailure.message}`)
        break
      }
      if (attempted.has(lease.credential)) {
        broker.complete(lease.id, { kind: 'failure', disposition: 'retain', code: 'FAILOVER_DUPLICATE_CREDENTIAL' })
        throw new Error('credential broker returned a credential already used in this failover decision')
      }
      attempted.add(lease.credential)
      let completed = false
      let lastFailureChunk: StreamChunk | undefined
      const complete = (completion: LeaseCompletion, evidence?: ProviderFailureEvidence): void => {
        if (completed) return
        completed = true
        if (completion.kind === 'failure' && evidence !== undefined) {
          const classified = this.classifyWith(evidence)
          if (classified !== undefined) {
            const failureCompletion: LeaseCompletion = {
              kind: 'failure',
              disposition: classified.disposition.kind,
              code: completion.code,
            }
            void classified.broker.completeWithHealth(lease.id, failureCompletion, classified.disposition)
              .catch(() => {
                // Health persistence must not change the provider answer the caller already observes.
              })
            return
          }
        }
        broker.complete(lease.id, completion)
      }

      try {
        const resolved = await credentials.resolve(lease.credentialRef)
        if (resolved === undefined) {
          lastFailure = { message: `credential reference '${lease.credentialRef}' is not configured`, code: 'MISSING_CREDENTIAL' }
          complete({ kind: 'failure', disposition: 'retain', code: 'MISSING_CREDENTIAL' })
          if (attempt + 1 < failover.maxAttempts && failover.retryableCodes.includes('MISSING_CREDENTIAL')) continue
          throw new LlmError(lastFailure.message, 'MISSING_CREDENTIAL')
        }

        let terminal = false
        let retry = false
        for await (const chunk of this.streamWithCredential(options, resolved.value)) {
          if (chunk.type !== 'finish') {
            yield chunk
            continue
          }
          terminal = true
          if (chunk.reason.kind === 'error') {
            const failure = chunk.reason.failure
            complete({ kind: 'failure', disposition: 'retain', code: failure.code }, evidenceOf(route.provider, options.model, failure))
            lastFailure = failure
            lastFailureChunk = chunk
            retry = attempt + 1 < failover.maxAttempts && failover.retryableCodes.includes(failure.code)
            if (retry) {
              this.ctx.logger.info(`credential "${lease.credentialRef}" failed with ${failure.code}; failing over (attempt ${attempt + 2}/${failover.maxAttempts} for provider "${route.provider}")`)
              break
            }
          } else {
            complete(chunk.reason.kind === 'aborted' ? { kind: 'cancelled' } : { kind: 'success' })
            yield chunk
          }
        }
        if (!terminal) {
          lastFailure = { message: 'provider stream ended without a finish chunk', code: 'STREAM_NO_FINISH' }
          complete({ kind: 'failure', disposition: 'retain', code: 'STREAM_NO_FINISH' })
          retry = attempt + 1 < failover.maxAttempts && failover.retryableCodes.includes('STREAM_NO_FINISH')
        }
        if (retry) continue
        if (lastFailureChunk !== undefined) yield lastFailureChunk
        return
      } catch (error) {
        const failure = failureOf(error)
        if (options.signal?.aborted) complete({ kind: 'cancelled' })
        else if (!completed) {
          complete({ kind: 'failure', disposition: 'retain', code: failure.code }, evidenceOf(route.provider, options.model, failure))
          lastFailure = failure
        }
        if (options.signal?.aborted || !failover.retryableCodes.includes(failure.code)) throw error
        if (attempt + 1 >= failover.maxAttempts) throw error
      } finally {
        if (!completed) complete({ kind: 'cancelled' })
      }
    }

    yield {
      type: 'finish',
      reason: {
        kind: 'error',
        failure: lastFailure
          ?? acquireFailure
          ?? { message: `credential failover exhausted for provider "${route.provider}"`, code: 'CREDENTIAL_POOL_EXHAUSTED' },
      },
    }
  }
}

/** Resolve the attempt's route: a fixed provider, or the request's own. */
function providerOf(provider: ProviderSource, options: FailoverRequest): string {
  return typeof provider === 'function' ? provider(options) : provider
}

function evidenceOf(provider: string, model: string, failure: LlmFailure): ProviderFailureEvidence {
  return {
    provider,
    model,
    code: failure.code,
    ...failure.status === undefined ? {} : { status: failure.status },
    ...failure.providerRetryAfterMs === undefined ? {} : { retryAfterMs: failure.providerRetryAfterMs },
  }
}

function failureOf(error: unknown): LlmFailure {
  const failure = (error as { failure?: LlmFailure } | null)?.failure
  if (failure !== undefined) return failure
  const message = error instanceof Error && error.message.length > 0 ? error.message : String(error)
  return { message, code: errorCode(error) }
}

function resolveFailoverPolicy(policy: FailoverPolicy | undefined): FailoverPolicy | undefined {
  if (policy === undefined) return undefined
  if (!Number.isSafeInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new Error('brokered LLM failover maxAttempts must be a positive safe integer')
  }
  if (policy.retryableCodes.some(code => code.length === 0) || new Set(policy.retryableCodes).size !== policy.retryableCodes.length) {
    throw new Error('brokered LLM failover retryableCodes must contain unique non-empty strings')
  }
  return Object.freeze({ maxAttempts: policy.maxAttempts, retryableCodes: Object.freeze([...policy.retryableCodes]) })
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && code.length > 0 ? code : 'STREAM_FAILURE'
}

function throwHealthUnsupported(): never {
  throw new Error('brokered LLM adapter health classification requires a broker that persists health decisions')
}

export default BrokeredLlmAdapter

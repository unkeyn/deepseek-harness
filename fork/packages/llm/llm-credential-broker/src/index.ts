/** Broker-backed LLM adapter decorator for bounded credential failover. */
import type { Context } from '@deepseek-ai/cordis'
import { CredentialBroker } from '@deepseek-ai/dsh-fork-credential-broker'
import type { CredentialBrokerRequest, CredentialId, LeaseCompletion, LeaseId } from '@deepseek-ai/dsh-fork-credential-broker'
import type { CredentialHealth, HealthDisposition, ProviderFailureEvidence } from '@deepseek-ai/dsh-fork-credential-health'
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-fork-llm'
import type { GenerateOptions, LlmFailure, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, ResolvedRetryPolicy, StreamChunk } from '@deepseek-ai/dsh-fork-llm'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'

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

/**
 * Static policy validated once at construction, or a resolver read per stream
 * call. Resolving to `undefined` bypasses the broker for that call, so a
 * provider without pool entries streams through the delegate unchanged.
 */
export type FailoverPolicySource = FailoverPolicy | (() => FailoverPolicy | undefined)

/** Optional brokered adapter settings. */
export interface BrokeredLlmAdapterOptions {
  readonly failover?: FailoverPolicySource
  /** Classifies failure evidence into durable credential health decisions. */
  readonly health?: CredentialHealth
}

const NO_FAILOVER: FailoverPolicy = Object.freeze({ maxAttempts: 1, retryableCodes: Object.freeze([]) })

/**
 * Adapter decorator that owns one broker lease per network attempt. A failed
 * lease is completed before another lease is acquired, and credential ids used
 * by the current finite failover decision are excluded from later selection.
 * With a health classifier, failures persist the classified disposition
 * (cooldown, quarantine, model exclusion) instead of leaving credential state
 * untouched.
 */
export class BrokeredLlmAdapter extends LlmAdapter {
  private readonly broker: CredentialBroker
  private readonly credentials: CredentialProvider
  private readonly failover: () => FailoverPolicy | undefined
  private readonly health: HealthAwareBroker | undefined

  constructor(
    ctx: Context,
    private readonly provider: string,
    private readonly delegate: LlmAdapter,
    private readonly streamWithCredential: CredentialStream,
    options: BrokeredLlmAdapterOptions = {},
  ) {
    super()
    const broker = ctx.get('credentialBroker')
    const credentials = ctx.get('credentials')
    if (broker === undefined || credentials === undefined) {
      throw new Error('brokered LLM adapter requires credentialBroker and credentials services')
    }
    this.broker = broker
    this.credentials = credentials
    // A health classifier is only usable when the broker can persist its decisions.
    this.health = options.health === undefined
      ? undefined
      : typeof (broker as HealthAwareBroker).completeWithHealth === 'function'
        ? broker as HealthAwareBroker
        : throwHealthUnsupported()
    // Without any policy the decorator still owns one lease per stream call;
    // only a dynamic resolver may bypass the broker for a stream.
    this.failover = typeof options.failover === 'function'
      ? options.failover
      : () => resolveFailoverPolicy(options.failover) ?? NO_FAILOVER
    // A static policy is still validated eagerly so misconfiguration fails at composition.
    if (typeof options.failover !== 'function') resolveFailoverPolicy(options.failover)
  }

  override providerInfo(provider: string): LlmProviderInfo { return this.delegate.providerInfo(provider) }
  override providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined {
    const failover = this.failover()
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
    const failover = this.failover()
    if (failover === undefined) {
      yield* this.delegate.stream(options)
      return
    }
    const attempted = new Set<CredentialId>()
    let lastFailure: LlmFailure | undefined

    for (let attempt = 0; attempt < failover.maxAttempts; attempt += 1) {
      const request: CredentialBrokerRequest = {
        provider: this.provider,
        model: options.model,
        ...options.sessionId === undefined ? {} : { sessionId: options.sessionId },
        purpose: options.purpose ?? 'conversation',
        ...(attempted.size === 0 ? {} : { excludedCredentials: [...attempted] }),
        ...options.signal === undefined ? {} : { signal: options.signal },
      }
      const lease = await this.broker.acquire(request)
      if (attempted.has(lease.credential)) {
        this.broker.complete(lease.id, { kind: 'failure', disposition: 'retain', code: 'FAILOVER_DUPLICATE_CREDENTIAL' })
        throw new Error('credential broker returned a credential already used in this failover decision')
      }
      attempted.add(lease.credential)
      let completed = false
      let lastFailureChunk: StreamChunk | undefined
      const complete = (completion: LeaseCompletion, evidence?: ProviderFailureEvidence): void => {
        if (completed) return
        completed = true
        if (this.health !== undefined && completion.kind === 'failure' && evidence !== undefined) {
          const disposition = this.health.classify(evidence)
          void this.health.completeWithHealth(lease.id, { ...completion, disposition: disposition.kind }, disposition)
            .catch(() => {
              // Health persistence must not change the provider answer the caller already observes.
            })
          return
        }
        this.broker.complete(lease.id, completion)
      }

      try {
        const resolved = await this.credentials.resolve(lease.credentialRef)
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
            complete({ kind: 'failure', disposition: 'retain', code: failure.code }, evidenceOf(this.provider, options.model, failure))
            lastFailure = failure
            lastFailureChunk = chunk
            retry = attempt + 1 < failover.maxAttempts && failover.retryableCodes.includes(failure.code)
            if (retry) break
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
          complete({ kind: 'failure', disposition: 'retain', code: failure.code }, evidenceOf(this.provider, options.model, failure))
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
          ?? { message: `credential failover exhausted for provider "${this.provider}"`, code: 'CREDENTIAL_POOL_EXHAUSTED' },
      },
    }
  }
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

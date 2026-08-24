/** Broker-backed LLM adapter decorator for bounded credential failover. */
import type { Context } from '@deepseek-ai/cordis'
import { CredentialBroker } from '@deepseek-ai/dsh-fork-credential-broker'
import type { CredentialBrokerRequest, CredentialId, LeaseCompletion } from '@deepseek-ai/dsh-fork-credential-broker'
import { LlmAdapter } from '@deepseek-ai/dsh-fork-llm'
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, ResolvedRetryPolicy, StreamChunk } from '@deepseek-ai/dsh-fork-llm'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'

/** Provider-specific callback that receives the resolved secret for one attempt. */
export type CredentialStream = (options: GenerateOptions, credential: string) => AsyncIterable<StreamChunk>

/** Finite credential failover decision applied to one adapter stream call. */
export interface FailoverPolicy {
  /** Total provider attempts, including the initial attempt. */
  readonly maxAttempts: number
  /** Failure codes that permit another credential attempt. */
  readonly retryableCodes: readonly string[]
}

/** Optional brokered adapter settings. */
export interface BrokeredLlmAdapterOptions {
  readonly failover?: FailoverPolicy
}

const NO_FAILOVER: FailoverPolicy = Object.freeze({ maxAttempts: 1, retryableCodes: Object.freeze([]) })

/**
 * Adapter decorator that owns one broker lease per network attempt. A failed
 * lease is completed before another lease is acquired, and credential ids used
 * by the current finite failover decision are excluded from later selection.
 */
export class BrokeredLlmAdapter extends LlmAdapter {
  private readonly broker: CredentialBroker
  private readonly credentials: CredentialProvider
  private readonly failover: FailoverPolicy

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
    this.failover = resolveFailoverPolicy(options.failover)
  }

  override providerInfo(provider: string): LlmProviderInfo { return this.delegate.providerInfo(provider) }
  override providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined {
    const policy = this.delegate.providerRetryPolicy(provider)
    if (policy === undefined || policy.mode !== 'normal' || this.failover.maxAttempts <= 1) return policy
    const requiredRetries = this.failover.maxAttempts - 1
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
    const attempted = new Set<CredentialId>()

    for (let attempt = 0; attempt < this.failover.maxAttempts; attempt += 1) {
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
      let lastFailure: StreamChunk | undefined
      const complete = (completion: LeaseCompletion): void => {
        if (completed) return
        completed = true
        this.broker.complete(lease.id, completion)
      }

      try {
        const resolved = await this.credentials.resolve(lease.credentialRef)
        if (resolved === undefined) {
          complete({ kind: 'failure', disposition: 'retain', code: 'MISSING_CREDENTIAL' })
          throw new Error(`credential reference '${lease.credentialRef}' is not configured`)
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
            const code = chunk.reason.failure.code
            complete({ kind: 'failure', disposition: 'retain', code })
            lastFailure = chunk
            retry = attempt + 1 < this.failover.maxAttempts && this.failover.retryableCodes.includes(code)
            if (retry) break
          } else {
            complete(chunk.reason.kind === 'aborted' ? { kind: 'cancelled' } : { kind: 'success' })
            yield chunk
          }
        }
        if (!terminal) {
          complete({ kind: 'failure', disposition: 'retain', code: 'STREAM_NO_FINISH' })
          retry = attempt + 1 < this.failover.maxAttempts && this.failover.retryableCodes.includes('STREAM_NO_FINISH')
        }
        if (retry) continue
        if (lastFailure !== undefined) yield lastFailure
        return
      } catch (error) {
        if (options.signal?.aborted) complete({ kind: 'cancelled' })
        else if (!completed) complete({ kind: 'failure', disposition: 'retain', code: errorCode(error) })
        if (options.signal?.aborted || !this.failover.retryableCodes.includes(errorCode(error))) throw error
        if (attempt + 1 >= this.failover.maxAttempts) throw error
      } finally {
        if (!completed) complete({ kind: 'cancelled' })
      }
    }
  }
}

function resolveFailoverPolicy(policy: FailoverPolicy | undefined): FailoverPolicy {
  if (policy === undefined) return NO_FAILOVER
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

export default BrokeredLlmAdapter

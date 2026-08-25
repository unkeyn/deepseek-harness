import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CredentialBroker, credentialId, leaseId, poolId } from '@deepseek-ai/dsh-fork-credential-broker'
import type { CredentialBrokerRequest, CredentialLease, LeaseCompletion, LeaseId } from '@deepseek-ai/dsh-fork-credential-broker'
import { CredentialHealth } from '@deepseek-ai/dsh-fork-credential-health'
import type { HealthDisposition, ProviderFailureEvidence } from '@deepseek-ai/dsh-fork-credential-health'
import { CredentialProvider, credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { LlmAdapter } from '@deepseek-ai/dsh-fork-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-fork-llm'
import { BrokeredLlmAdapter } from '../src/index.ts'

class FakeBroker extends CredentialBroker {
  readonly completed: LeaseCompletion[] = []
  readonly healthCompletions: Array<{ completion: LeaseCompletion; disposition: unknown }> = []
  readonly events: string[] = []
  requests: CredentialBrokerRequest[] = []
  constructor(ctx: Context, private readonly credentials = ['key-a']) { super(ctx) }
  override acquire(request: CredentialBrokerRequest): Promise<CredentialLease> {
    this.requests.push(request)
    this.events.push('acquire')
    const credential = this.credentials.find(id => !request.excludedCredentials?.includes(credentialId(id)))
    if (credential === undefined) return Promise.reject(new Error('no eligible credential'))
    const reference = credential === 'key-a' ? 'DEEPSEEK_API_KEY' : 'SECOND_API_KEY'
    return Promise.resolve({ id: leaseId(`lease-${this.requests.length}`), pool: poolId('main'), credential: credentialId(credential), credentialRef: credentialRef(reference), authKind: 'api-key', provider: request.provider, model: request.model })
  }
  override complete(_id: LeaseId, completion: LeaseCompletion): void { this.events.push('complete'); this.completed.push(completion) }
  async completeWithHealth(_id: LeaseId, completion: LeaseCompletion, disposition: HealthDisposition): Promise<void> {
    this.events.push('complete')
    this.completed.push(completion)
    this.healthCompletions.push({ completion, disposition })
  }
  override listPools() { return [poolId('main')] }
}

class FakeHealth extends CredentialHealth {
  constructor(ctx: Context, private readonly decide: (evidence: ProviderFailureEvidence) => HealthDisposition) { super(ctx) }
  override classify(evidence: ProviderFailureEvidence): HealthDisposition { return this.decide(evidence) }
}

class FakeCredentials extends CredentialProvider {
  constructor(ctx: Context, private readonly value = 'secret') { super(ctx) }
  override resolve(_ref: CredentialRef): Promise<ResolvedCredential | undefined> { return Promise.resolve(this.value === '' ? undefined : { value: this.value, source: 'test' }) }
  override describe(_ref: CredentialRef): Promise<CredentialInfo> { return Promise.resolve({ configured: this.value !== '', writable: false }) }
  override set(): Promise<void> { return Promise.reject(new Error('read-only')) }
  override unset(): Promise<void> { return Promise.reject(new Error('read-only')) }
}

class Delegate extends LlmAdapter {
  override providerRetryPolicy(_provider: string) {
    return {
      mode: 'normal' as const,
      maxRetries: 2,
      retryableCodes: ['RATE_LIMIT'],
      initialDelayMs: 1,
      maxDelayMs: 10,
      jitterRatio: 0,
    }
  }
  override stream(_options: GenerateOptions): AsyncIterable<StreamChunk> { return emptyStream() }
}

async function* emptyStream(): AsyncIterable<StreamChunk> { yield { type: 'finish', reason: { kind: 'stop' } } }

async function boot(value = 'secret', brokerCredentials = ['key-a']) {
  const ctx = new Context()
  await ctx.plugin(FakeBroker, brokerCredentials)
  await ctx.plugin(FakeCredentials, value)
  return { ctx, broker: ctx.credentialBroker as FakeBroker }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

const options: GenerateOptions = { provider: 'routed', model: 'chat', messages: [] }

describe('brokered LLM adapter', () => {
  it('resolves a lease reference and completes success after terminal finish', async () => {
    const { ctx, broker } = await boot()
    const seen: string[] = []
    const adapter = new BrokeredLlmAdapter(ctx, 'routed', new Delegate(), async function* (_options, credential) {
      seen.push(credential)
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    await expect(collect(adapter.stream(options))).resolves.toHaveLength(1)
    expect(seen).toEqual(['secret'])
    expect(broker.completed).toEqual([{ kind: 'success' }])
  })

  it('marks cancellation when the provider throws after caller abort', async () => {
    const { ctx, broker } = await boot()
    const controller = new AbortController()
    const adapter = new BrokeredLlmAdapter(ctx, 'routed', new Delegate(), async function* () {
      controller.abort()
      throw new Error('request aborted')
    })
    await expect(collect(adapter.stream({ ...options, signal: controller.signal }))).rejects.toThrow(/aborted/)
    expect(broker.completed).toEqual([{ kind: 'cancelled' }])
  })

  it('completes a failed lease before acquiring an excluded alternative and stops at the attempt bound', async () => {
    const { ctx, broker } = await boot('secret', ['key-a', 'key-b'])
    const seen: string[] = []
    let calls = 0
    const adapter = new BrokeredLlmAdapter(ctx, 'routed', new Delegate(), async function* () {
      seen.push(calls === 0 ? 'first' : 'second')
      if (calls++ === 0) yield { type: 'finish', reason: { kind: 'error', failure: { message: 'busy', code: 'RATE_LIMIT' } } }
      else yield { type: 'finish', reason: { kind: 'stop' } }
    }, { failover: { maxAttempts: 2, retryableCodes: ['RATE_LIMIT'] } })
    await expect(collect(adapter.stream(options))).resolves.toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
    expect(seen).toEqual(['first', 'second'])
    expect(broker.events).toEqual(['acquire', 'complete', 'acquire', 'complete'])
    expect(broker.requests[1]?.excludedCredentials).toEqual(['key-a'])
    expect(broker.completed).toEqual([
      { kind: 'failure', disposition: 'retain', code: 'RATE_LIMIT' },
      { kind: 'success' },
    ])
  })

  it('raises the outer retry budget to cover credential failover attempts', async () => {
    const { ctx } = await boot('secret', ['key-a', 'key-b', 'key-c', 'key-d'])
    const adapter = new BrokeredLlmAdapter(ctx, 'routed', new Delegate(), async function* () {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'busy', code: 'RATE_LIMIT' } } }
    }, { failover: { maxAttempts: 4, retryableCodes: ['RATE_LIMIT'] } })
    expect(adapter.providerRetryPolicy('routed')).toMatchObject({ mode: 'normal', maxRetries: 3 })
  })
  it('rejects an unbounded or empty failover limit', async () => {
    const { ctx } = await boot()
    expect(() => new BrokeredLlmAdapter(ctx, 'routed', new Delegate(), async function* () {}, { failover: { maxAttempts: 0, retryableCodes: [] } })).toThrow(/positive safe integer/)
  })

  it('retains the lease state for an unconfigured reference', async () => {
    const { ctx, broker } = await boot('')
    const adapter = new BrokeredLlmAdapter(ctx, 'routed', new Delegate(), async function* () { yield { type: 'finish', reason: { kind: 'stop' } } })
    await expect(collect(adapter.stream(options))).rejects.toThrow(/not configured/)
    expect(broker.completed).toEqual([{ kind: 'failure', disposition: 'retain', code: 'MISSING_CREDENTIAL' }])
  })

  it('classifies failure evidence into a durable health disposition', async () => {
    const { ctx, broker } = await boot('secret', ['key-a', 'key-b'])
    let calls = 0
    const adapter = new BrokeredLlmAdapter(ctx, 'routed', new Delegate(), async function* () {
      if (calls++ === 0) {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: 'busy', code: 'RATE_LIMIT', status: 429, providerRetryAfterMs: 2000 } } }
      } else yield { type: 'finish', reason: { kind: 'stop' } }
    }, {
      failover: { maxAttempts: 2, retryableCodes: ['RATE_LIMIT'] },
      health: new FakeHealth(ctx, evidence => ({ kind: 'cooldown', ...evidence.retryAfterMs === undefined ? {} : { retryAfterMs: evidence.retryAfterMs } })),
    })
    await expect(collect(adapter.stream(options))).resolves.toEqual([{ type: 'finish', reason: { kind: 'stop' } }])
    expect(broker.healthCompletions).toEqual([{
      completion: { kind: 'failure', disposition: 'cooldown', code: 'RATE_LIMIT' },
      disposition: { kind: 'cooldown', retryAfterMs: 2000 },
    }])
  })

  it('bypasses the broker while the dynamic policy resolves to undefined', async () => {
    const { ctx, broker } = await boot()
    let pooled = false
    const adapter = new BrokeredLlmAdapter(ctx, 'routed', new Delegate(), async function* () {
      yield { type: 'finish', reason: { kind: 'stop' } }
    }, { failover: () => pooled ? { maxAttempts: 1, retryableCodes: [] } : undefined })
    await expect(collect(adapter.stream(options))).resolves.toHaveLength(1)
    expect(broker.events).toEqual([])
    pooled = true
    await expect(collect(adapter.stream(options))).resolves.toHaveLength(1)
    expect(broker.events).toEqual(['acquire', 'complete'])
  })

  it('yields a terminal failure chunk when every failover attempt is exhausted', async () => {
    const { ctx, broker } = await boot('secret', ['key-a', 'key-b'])
    const adapter = new BrokeredLlmAdapter(ctx, 'routed', new Delegate(), async function* () {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'busy', code: 'RATE_LIMIT' } } }
    }, { failover: { maxAttempts: 2, retryableCodes: ['RATE_LIMIT'] } })
    await expect(collect(adapter.stream(options))).resolves.toEqual([
      { type: 'finish', reason: { kind: 'error', failure: { message: 'busy', code: 'RATE_LIMIT' } } },
    ])
    expect(broker.completed).toEqual([
      { kind: 'failure', disposition: 'retain', code: 'RATE_LIMIT' },
      { kind: 'failure', disposition: 'retain', code: 'RATE_LIMIT' },
    ])
  })

  it('surfaces the last provider failure when the pool cannot offer another credential', async () => {
    const { ctx, broker } = await boot('secret', ['key-a'])
    const adapter = new BrokeredLlmAdapter(ctx, 'routed', new Delegate(), async function* () {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'busy', code: 'RATE_LIMIT' } } }
    }, { failover: { maxAttempts: 3, retryableCodes: ['RATE_LIMIT'] } })
    await expect(collect(adapter.stream(options))).resolves.toEqual([
      { type: 'finish', reason: { kind: 'error', failure: { message: 'busy', code: 'RATE_LIMIT' } } },
    ])
    expect(broker.events).toEqual(['acquire', 'complete', 'acquire'])
    expect(broker.completed).toEqual([{ kind: 'failure', disposition: 'retain', code: 'RATE_LIMIT' }])
  })

  it('yields a broker cooldown rejection as the finish failure when no attempt streamed', async () => {
    const { ctx, broker } = await boot('secret', ['key-a'])
    const adapter = new BrokeredLlmAdapter(ctx, 'routed', new Delegate(), async function* () {
      yield { type: 'finish', reason: { kind: 'stop' } }
    }, { failover: { maxAttempts: 2, retryableCodes: ['RATE_LIMIT'] } })
    const cooldown = new Error('every pooled credential for provider "routed" is cooling down until 2026-08-25T09:00:00.000Z') as Error & { code: string }
    cooldown.code = 'CREDENTIAL_COOLDOWN'
    broker.acquire = () => Promise.reject(cooldown)
    await expect(collect(adapter.stream(options))).resolves.toEqual([
      { type: 'finish', reason: { kind: 'error', failure: { message: expect.stringContaining('cooling down'), code: 'CREDENTIAL_COOLDOWN' } } },
    ])
  })

  it('fails over to another credential when the leased reference is unconfigured', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeBroker, ['key-a', 'key-b'])
    class RefAware extends CredentialProvider {
      constructor(ctx: Context) { super(ctx) }
      override resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
        return Promise.resolve(String(ref) === 'DEEPSEEK_API_KEY' ? undefined : { value: 'secret', source: 'test' })
      }
      override describe(ref: CredentialRef): Promise<CredentialInfo> { return Promise.resolve({ configured: String(ref) === 'DEEPSEEK_API_KEY', writable: false }) }
      override set(): Promise<void> { return Promise.reject(new Error('read-only')) }
      override unset(): Promise<void> { return Promise.reject(new Error('read-only')) }
    }
    await ctx.plugin(RefAware)
    const seen: string[] = []
    const adapter = new BrokeredLlmAdapter(ctx, 'routed', new Delegate(), async function* (_options, credential) {
      seen.push(credential)
      yield { type: 'finish', reason: { kind: 'stop' } }
    }, { failover: { maxAttempts: 2, retryableCodes: ['MISSING_CREDENTIAL'] } })
    await expect(collect(adapter.stream(options))).resolves.toHaveLength(1)
    expect(seen).toEqual(['secret'])
    expect((ctx.credentialBroker as FakeBroker).completed).toEqual([
      { kind: 'failure', disposition: 'retain', code: 'MISSING_CREDENTIAL' },
      { kind: 'success' },
    ])
  })
})

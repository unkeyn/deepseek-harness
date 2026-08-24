import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CredentialBroker, credentialId, leaseId, poolId } from '@deepseek-ai/dsh-fork-credential-broker'
import type { CredentialBrokerRequest, CredentialLease, LeaseCompletion, LeaseId } from '@deepseek-ai/dsh-fork-credential-broker'
import { CredentialProvider, credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { LlmAdapter } from '@deepseek-ai/dsh-fork-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-fork-llm'
import { BrokeredLlmAdapter } from '../src/index.ts'

class FakeBroker extends CredentialBroker {
  readonly completed: LeaseCompletion[] = []
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
  override listPools() { return [poolId('main')] }
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
})

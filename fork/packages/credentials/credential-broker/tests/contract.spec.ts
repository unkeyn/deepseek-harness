import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CredentialBroker, credentialId, leaseId, poolId } from '../src/index.ts'
import type { CredentialBrokerRequest, CredentialLease, LeaseCompletion, LeaseId } from '../src/index.ts'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

class MemoryBroker extends CredentialBroker {
  private sequence = 0
  private readonly live = new Set<string>()
  private readonly completed: LeaseCompletion[] = []

  override acquire(_request: CredentialBrokerRequest): Promise<CredentialLease> {
    const id = leaseId(`lease-${++this.sequence}`)
    this.live.add(id)
    return Promise.resolve({
      id,
      pool: poolId('deepseek'),
      credential: credentialId('key-1'),
      credentialRef: credentialRef('DEEPSEEK_API_KEY'),
      authKind: 'api-key',
      provider: 'deepseek',
      model: 'deepseek-chat',
    })
  }

  override complete(id: LeaseId, completion: LeaseCompletion): void {
    if (!this.live.delete(id)) throw new Error(`lease ${id} is not live`)
    this.completed.push(completion)
  }

  override listPools() { return [poolId('deepseek')] }

  publishTestSnapshot(event: import('../src/index.ts').CredentialBrokerSnapshotEvent): boolean {
    return this.publishSnapshot(event)
  }

  get completions(): readonly LeaseCompletion[] { return this.completed }
}

describe('credential broker contract', () => {
  it('brands non-empty ids and rejects empty ids', () => {
    expect(poolId('pool')).toBe('pool')
    expect(() => leaseId('')).toThrow(/non-empty/)
    expect(() => credentialId('')).toThrow(/non-empty/)
  })

  it('publishes generation-tagged snapshots and disposes subscriptions with the broker', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(MemoryBroker)
    const broker = ctx.credentialBroker as MemoryBroker
    const events: unknown[] = []
    const subscription = broker.subscribe(event => events.push(event))
    expect(broker.publishTestSnapshot({
      kind: 'entry', generation: 1, entry: {
        id: credentialId('key-2'), pool: poolId('deepseek'), provider: 'deepseek',
        reference: credentialRef('OTHER_KEY'), authKind: 'api-key',
      },
    })).toBe(true)
    expect(broker.publishTestSnapshot({
      kind: 'entry', generation: 1, entry: {
        id: credentialId('key-3'), pool: poolId('deepseek'), provider: 'deepseek',
        reference: credentialRef('STALE'), authKind: 'api-key',
      },
    })).toBe(false)
    expect(events).toHaveLength(1)
    subscription.dispose()
    await fiber.dispose()
    expect(ctx.get('credentialBroker')).toBeUndefined()
  })

  it('selects a reference without exposing a secret and completes exactly once', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(MemoryBroker)
    const broker = ctx.credentialBroker as MemoryBroker
    const lease = await ctx.credentialBroker.acquire({ provider: 'deepseek', model: 'deepseek-chat', purpose: 'conversation' })
    expect(lease.credentialRef).toBe('DEEPSEEK_API_KEY')
    expect(lease).not.toHaveProperty('value')
    ctx.credentialBroker.complete(lease.id, { kind: 'success' })
    expect(() => ctx.credentialBroker.complete(lease.id, { kind: 'success' })).toThrow(/not live/)
    expect(broker.completions).toEqual([{ kind: 'success' }])
    await fiber.dispose()
    expect(ctx.get('credentialBroker')).toBeUndefined()
  })
})

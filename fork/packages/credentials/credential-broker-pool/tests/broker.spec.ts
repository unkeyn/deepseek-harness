import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialId } from '@deepseek-ai/dsh-fork-credential-broker'
import { PoolCredentialBroker } from '../src/index.ts'

const snapshot = {
  version: 3 as const,
  pools: [{ id: 'main' as never, provider: 'deepseek' }],
  credentials: [
    {
      id: 'slow' as never, pool: 'main' as never, reference: 'FIRST_KEY' as never, authKind: 'api-key' as const,
      priority: 1, maxConcurrent: 1, enabled: true, health: { excludedModels: [] },
    },
    {
      id: 'fast' as never, pool: 'main' as never, reference: 'SECOND_KEY' as never, authKind: 'api-key' as const,
      priority: 2, maxConcurrent: 1, enabled: true, health: { excludedModels: [] },
    },
  ],
}

describe('pool credential broker', () => {
  it('chooses priority, enforces concurrency, and wakes after completion', async () => {
    const ctx = new Context()
    ctx.provide('credentialPoolStore', { getSnapshot: () => snapshot } as never)
    const fiber = await ctx.plugin(PoolCredentialBroker)
    const first = await ctx.credentialBroker.acquire({ provider: 'deepseek', model: 'chat', purpose: 'conversation' })
    expect(first.credential).toBe('fast')
    const second = await ctx.credentialBroker.acquire({ provider: 'deepseek', model: 'chat', purpose: 'conversation' })
    expect(second.credential).toBe('slow')
    let settled = false
    const third = ctx.credentialBroker.acquire({ provider: 'deepseek', model: 'chat', purpose: 'conversation' }).then((lease) => { settled = true; return lease })
    await Promise.resolve()
    expect(settled).toBe(false)
    ctx.credentialBroker.complete(first.id, { kind: 'success' })
    expect((await third).credential).toBe('fast')
    await fiber.dispose()
  })

  it('rotates equal-priority credentials across acquires instead of pinning one', async () => {
    const ctx = new Context()
    ctx.provide('credentialPoolStore', {
      getSnapshot: () => ({
        version: 3 as const,
        pools: [{ id: 'main' as never, provider: 'deepseek' }],
        credentials: (['a', 'b', 'c'] as const).map(id => ({
          id: `key-${id}` as never, pool: 'main' as never, reference: `${id.toUpperCase()}_KEY` as never, authKind: 'api-key' as const,
          priority: 1, maxConcurrent: 1, enabled: true, health: { excludedModels: [] },
        })),
      }),
    } as never)
    const fiber = await ctx.plugin(PoolCredentialBroker)
    try {
      const seen: string[] = []
      for (let index = 0; index < 3; index += 1) {
        const lease = await ctx.credentialBroker.acquire({ provider: 'deepseek', model: 'chat', purpose: 'conversation' })
        seen.push(lease.credential)
        ctx.credentialBroker.complete(lease.id, { kind: 'success' })
      }
      expect(seen).toEqual(['key-a', 'key-b', 'key-c'])
      const secondPass = await ctx.credentialBroker.acquire({ provider: 'deepseek', model: 'chat', purpose: 'conversation' })
      expect(secondPass.credential).toBe('key-a')
      ctx.credentialBroker.complete(secondPass.id, { kind: 'success' })
    } finally {
      await fiber.dispose()
    }
  })

  it('skips a credential during cooldown and only for its excluded models', async () => {
    const ctx = new Context()
    ctx.provide('credentialPoolStore', {
      getSnapshot: () => ({
        version: 3 as const,
        pools: [{ id: 'main' as never, provider: 'deepseek' }],
        credentials: [
          {
            id: 'cooling' as never, pool: 'main' as never, reference: 'COOLING_KEY' as never, authKind: 'api-key' as const,
            priority: 4, maxConcurrent: 1, enabled: true, health: { cooldownUntil: 2_000, excludedModels: [] },
          },
          {
            id: 'excluded' as never, pool: 'main' as never, reference: 'EXCLUDED_KEY' as never, authKind: 'api-key' as const,
            priority: 3, maxConcurrent: 1, enabled: true, health: { excludedModels: ['reasoner'] },
          },
          {
            id: 'eligible' as never, pool: 'main' as never, reference: 'ELIGIBLE_KEY' as never, authKind: 'api-key' as const,
            priority: 2, maxConcurrent: 1, enabled: true, health: { excludedModels: [] },
          },
        ],
      }),
    } as never)
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const fiber = await ctx.plugin(PoolCredentialBroker)
    try {
      const reasoner = await ctx.credentialBroker.acquire({ provider: 'deepseek', model: 'reasoner', purpose: 'conversation' })
      expect(reasoner.credential).toBe('eligible')
      ctx.credentialBroker.complete(reasoner.id, { kind: 'success' })

      now.mockReturnValue(2_000)
      const chat = await ctx.credentialBroker.acquire({ provider: 'deepseek', model: 'chat', purpose: 'conversation' })
      expect(chat.credential).toBe('cooling')
      ctx.credentialBroker.complete(chat.id, { kind: 'success' })
    } finally {
      now.mockRestore()
      await fiber.dispose()
    }
  })

  it('records classifier dispositions with the lease CAS token and releases once', async () => {
    const record = {
      id: 'key-a' as never, pool: 'main' as never, reference: 'KEY_REF' as never, authKind: 'api-key' as const,
      priority: 1, maxConcurrent: 1, enabled: true, generation: 4,
      health: { excludedModels: [] as string[] },
    }
    const snapshot = { version: 3 as const, generation: 9, pools: [{ id: 'main' as never, provider: 'deepseek' }], credentials: [record] }
    const updateCredentialHealth = vi.fn(async (_id, _expected, health) => ({
      credential: { ...record, health },
      version: { generation: 5, version: 10 },
    }))
    const store = { getSnapshot: () => snapshot, updateCredentialHealth, setCredentialReauthentication: vi.fn(), removeCredential: vi.fn() }
    const ctx = new Context()
    ctx.provide('credentialPoolStore', store as never)
    const fiber = await ctx.plugin(PoolCredentialBroker)
    try {
      const lease = await ctx.credentialBroker.acquire({ provider: 'deepseek', model: 'chat', purpose: 'conversation' })
      await (ctx.credentialBroker as PoolCredentialBroker).completeWithHealth(
        lease.id, { kind: 'failure', disposition: 'cooldown', code: 'RATE_LIMIT' }, { kind: 'cooldown', retryAfterMs: 5000 },
      )
      expect(updateCredentialHealth).toHaveBeenCalledWith('key-a', { generation: 4, version: 9 }, expect.objectContaining({ cooldownUntil: expect.any(Number), lastFailure: { disposition: 'cooldown', code: 'RATE_LIMIT', at: expect.any(Number) } }))
      await expect((ctx.credentialBroker as PoolCredentialBroker).completeWithHealth(lease.id, { kind: 'success' }, { kind: 'healthy' })).rejects.toThrow(/not live/)
    } finally {
      await fiber.dispose()
    }
  })

  it('propagates a stale generation after releasing the lease', async () => {
    const snapshot = {
      version: 3 as const, generation: 3, pools: [{ id: 'main' as never, provider: 'deepseek' }], credentials: [{
        id: 'key-a' as never, pool: 'main' as never, reference: 'KEY_REF' as never, authKind: 'api-key' as const,
        priority: 1, maxConcurrent: 1, enabled: true, generation: 1, health: { excludedModels: [] as string[] },
      }],
    }
    const stale = new Error('stale writer')
    const store = {
      getSnapshot: () => snapshot,
      updateCredentialHealth: vi.fn().mockRejectedValue(stale),
      setCredentialReauthentication: vi.fn(),
      removeCredential: vi.fn(),
    }
    const ctx = new Context()
    ctx.provide('credentialPoolStore', store as never)
    const fiber = await ctx.plugin(PoolCredentialBroker)
    try {
      const lease = await ctx.credentialBroker.acquire({ provider: 'deepseek', model: 'chat', purpose: 'conversation' })
      await expect((ctx.credentialBroker as PoolCredentialBroker).completeWithHealth(lease.id, { kind: 'failure', disposition: 'retain', code: 'STALE' }, { kind: 'retain' })).rejects.toBe(stale)
      await expect(ctx.credentialBroker.acquire({ provider: 'deepseek', model: 'chat', purpose: 'conversation' })).resolves.toMatchObject({ credential: 'key-a' })
    } finally {
      await fiber.dispose()
    }
  })

  it('rejects an acquire that every pool credential is permanently barred from serving', async () => {
    const ctx = new Context()
    ctx.provide('credentialPoolStore', { getSnapshot: () => snapshot } as never)
    const fiber = await ctx.plugin(PoolCredentialBroker)
    try {
      await expect(ctx.credentialBroker.acquire({
        provider: 'deepseek', model: 'chat', purpose: 'conversation',
        excludedCredentials: [credentialId('fast'), credentialId('slow')],
      })).rejects.toThrow(/no eligible credential/)
    } finally {
      await fiber.dispose()
    }
  })

  it('rejects an acquire while every candidate is cooling down, naming the earliest expiry', async () => {
    const ctx = new Context()
    ctx.provide('credentialPoolStore', {
      getSnapshot: () => ({
        version: 3 as const,
        pools: [{ id: 'main' as never, provider: 'deepseek' }],
        credentials: [{
          id: 'cooling' as never, pool: 'main' as never, reference: 'COOLING_KEY' as never, authKind: 'api-key' as const,
          priority: 1, maxConcurrent: 1, enabled: true,
          health: { excludedModels: [], cooldownUntil: Date.now() + 5_000 },
        }],
      }),
    } as never)
    const fiber = await ctx.plugin(PoolCredentialBroker)
    try {
      await expect(ctx.credentialBroker.acquire({ provider: 'deepseek', model: 'chat', purpose: 'conversation' }))
        .rejects.toMatchObject({ code: 'CREDENTIAL_COOLDOWN', message: expect.stringContaining('cooling down until') })
    } finally {
      await fiber.dispose()
    }
  })

  it('wakes a capacity waiter when a republished snapshot offers a fresh credential', async () => {
    const credentials = [{
      id: 'busy' as never, pool: 'main' as never, reference: 'BUSY_KEY' as never, authKind: 'api-key' as const,
      priority: 1, maxConcurrent: 1, enabled: true, health: { excludedModels: [] },
    }]
    const ctx = new Context()
    ctx.provide('credentialPoolStore', {
      getSnapshot: () => ({ version: 3 as const, generation: 1, pools: [{ id: 'main' as never, provider: 'deepseek' }], credentials }),
    } as never)
    const fiber = await ctx.plugin(PoolCredentialBroker)
    try {
      const busy = await ctx.credentialBroker.acquire({ provider: 'deepseek', model: 'chat', purpose: 'conversation' })
      let settled = false
      const parked = ctx.credentialBroker.acquire({ provider: 'deepseek', model: 'chat', purpose: 'conversation' })
        .then((lease) => { settled = true; return lease })
      await Promise.resolve()
      expect(settled).toBe(false)
      credentials.push({
        id: 'fresh' as never, pool: 'main' as never, reference: 'FRESH_KEY' as never, authKind: 'api-key' as const,
        priority: 1, maxConcurrent: 1, enabled: true, health: { excludedModels: [] },
      })
      ;(ctx.credentialBroker as unknown as { publishStoreSnapshot(): void }).publishStoreSnapshot()
      // The drain resolves the waiter; its continuation is one microtask away.
      await Promise.resolve()
      expect(settled).toBe(true)
      expect((await parked).credential).toBe('fresh')
      ctx.credentialBroker.complete(busy.id, { kind: 'success' })
    } finally {
      await fiber.dispose()
    }
  })
})

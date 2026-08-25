import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import type { PoolCredentialBroker } from '@deepseek-ai/dsh-fork-credential-broker-pool'
import * as keyPool from '@deepseek-ai/dsh-fork-key-pool'

const SECRET_A = 'secret-a-value'
const SECRET_B = 'secret-b-value'

function config(overrides: Partial<keyPool.Config> = {}): keyPool.Config {
  return {
    pools: [{
      provider: 'deepseek-official',
      keys: [{ ref: 'DEEPSEEK_API_KEY' }, { ref: 'DEEPSEEK_API_KEY_2' }],
    }],
    maxAttempts: 3,
    cooldownMs: 60_000,
    ...overrides,
  }
}

interface Mount {
  ctx: Context
  fiber: { dispose(): Promise<void> }
  settings: { get: () => unknown; update: ReturnType<typeof vi.fn> }
  broker: PoolCredentialBroker
}

async function mount(initial: keyPool.Config = config(), secrets: Record<string, string> = { DEEPSEEK_API_KEY: SECRET_A, DEEPSEEK_API_KEY_2: SECRET_B }): Promise<Mount> {
  const ctx = new Context()
  const values = new Map<CredentialRef, ResolvedCredential>(
    Object.entries(secrets).map(([ref, value]) => [credentialRef(ref), { value, source: 'test' }]),
  )
  ctx.provide('credentials', {
    resolve: (ref: CredentialRef) => Promise.resolve(values.get(ref)),
    describe: (ref: CredentialRef) => Promise.resolve({ configured: values.has(ref), writable: true }),
    set: () => Promise.reject(new Error('read-only')),
    unset: () => Promise.reject(new Error('read-only')),
  })
  const settings = {
    get: () => initial,
    update: vi.fn(async () => {}),
  }
  ctx.provide('settings', settings as never)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  const fiber = await ctx.plugin(keyPool, initial)
  return { ctx, fiber, settings, broker: ctx.credentialBroker as PoolCredentialBroker }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('key-pool', () => {
  it('rotates equal-priority keys across sequential acquires', async () => {
    const { ctx, fiber } = await mount()
    const refs: string[] = []
    for (let index = 0; index < 4; index += 1) {
      const lease = await ctx.credentialBroker.acquire({ provider: 'deepseek-official', model: 'chat', purpose: 'conversation' })
      refs.push(String(lease.credentialRef))
      ctx.credentialBroker.complete(lease.id, { kind: 'success' })
    }
    expect(refs).toEqual(['DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY_2', 'DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY_2'])
    await fiber.dispose()
  })

  it('cools a rate-limited key down and serves the next acquire from the surviving key', async () => {
    const { ctx, fiber, settings } = await mount()
    const first = await ctx.credentialBroker.acquire({ provider: 'deepseek-official', model: 'chat', purpose: 'conversation' })
    const disposition = ctx.credentialHealth.classify({ provider: 'deepseek-official', model: 'chat', code: 'RATE_LIMIT' })
    expect(disposition).toMatchObject({ kind: 'cooldown' })
    await (ctx.credentialBroker as PoolCredentialBroker).completeWithHealth(
      first.id,
      { kind: 'failure', disposition: 'cooldown', code: 'RATE_LIMIT' },
      disposition,
    )
    const second = await ctx.credentialBroker.acquire({ provider: 'deepseek-official', model: 'chat', purpose: 'conversation' })
    expect(String(second.credentialRef)).toBe('DEEPSEEK_API_KEY_2')
    ctx.credentialBroker.complete(second.id, { kind: 'success' })
    // The classified health reached the settings document redacted.
    expect(settings.update).toHaveBeenCalled()
    const patch = settings.update.mock.calls.at(-1)?.[1] as { pools: Array<{ keys: Array<{ ref: string; health?: { cooldownUntil?: number } }> }> }
    expect(patch.pools[0]?.keys[0]?.health?.cooldownUntil).toBeGreaterThan(Date.now() - 1000)
    expect(JSON.stringify(patch)).not.toContain(SECRET_A)
    await fiber.dispose()
  })

  it('makes the cooled key eligible again after the cooldown passes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const { ctx, fiber } = await mount()
    const first = await ctx.credentialBroker.acquire({ provider: 'deepseek-official', model: 'chat', purpose: 'conversation' })
    const disposition = ctx.credentialHealth.classify({ provider: 'deepseek-official', model: 'chat', code: 'RATE_LIMIT' })
    await (ctx.credentialBroker as PoolCredentialBroker).completeWithHealth(
      first.id,
      { kind: 'failure', disposition: 'cooldown', code: 'RATE_LIMIT' },
      disposition,
    )
    const second = await ctx.credentialBroker.acquire({ provider: 'deepseek-official', model: 'chat', purpose: 'conversation' })
    expect(String(second.credentialRef)).toBe('DEEPSEEK_API_KEY_2')
    ctx.credentialBroker.complete(second.id, { kind: 'success' })
    vi.setSystemTime(1_000_000 + 60_000 + 1)
    const third = await ctx.credentialBroker.acquire({ provider: 'deepseek-official', model: 'chat', purpose: 'conversation' })
    expect(String(third.credentialRef)).toBe('DEEPSEEK_API_KEY')
    ctx.credentialBroker.complete(third.id, { kind: 'success' })
    await fiber.dispose()
  })

  it('persists overlapping leases cooldowns and rejects acquires it cannot serve', async () => {
    const { ctx, fiber, broker, settings } = await mount()
    const first = await ctx.credentialBroker.acquire({ provider: 'deepseek-official', model: 'chat', purpose: 'conversation' })
    const second = await ctx.credentialBroker.acquire({ provider: 'deepseek-official', model: 'chat', purpose: 'conversation' })
    const disposition = ctx.credentialHealth.classify({ provider: 'deepseek-official', model: 'chat', code: 'RATE_LIMIT' })
    await broker.completeWithHealth(first.id, { kind: 'failure', disposition: 'cooldown', code: 'RATE_LIMIT' }, disposition)
    // The second lease's CAS token was captured before the first mutation
    // landed; the broker refreshes it instead of silently dropping the cooldown.
    await broker.completeWithHealth(second.id, { kind: 'failure', disposition: 'cooldown', code: 'RATE_LIMIT' }, disposition)
    const patch = settings.update.mock.calls.at(-1)?.[1] as { pools: Array<{ keys: Array<{ ref: string; health?: { cooldownUntil?: number } }> }> }
    expect(patch.pools[0]?.keys[1]?.ref).toBe('DEEPSEEK_API_KEY_2')
    expect(patch.pools[0]?.keys[1]?.health?.cooldownUntil).toBeGreaterThan(Date.now() - 1000)
    // A failover decision that already consumed both keys gets the permanent
    // rejection; a fresh acquire during the cooldown window gets the retryable
    // cooldown rejection instead of a parked promise.
    await expect(ctx.credentialBroker.acquire({
      provider: 'deepseek-official', model: 'chat', purpose: 'conversation',
      excludedCredentials: [first.credential, second.credential],
    })).rejects.toMatchObject({ code: 'NO_ELIGIBLE_CREDENTIAL' })
    await expect(ctx.credentialBroker.acquire({ provider: 'deepseek-official', model: 'chat', purpose: 'conversation' }))
      .rejects.toMatchObject({ code: 'CREDENTIAL_COOLDOWN' })
    await fiber.dispose()
  })

  it('quarantines a provider-rejected key until the configuration changes', async () => {
    const { ctx, fiber } = await mount()
    const first = await ctx.credentialBroker.acquire({ provider: 'deepseek-official', model: 'chat', purpose: 'conversation' })
    const disposition = ctx.credentialHealth.classify({ provider: 'deepseek-official', model: 'chat', code: 'AUTH' })
    expect(disposition).toEqual({ kind: 'quarantine', reason: expect.stringContaining('rejected') })
    await (ctx.credentialBroker as PoolCredentialBroker).completeWithHealth(
      first.id,
      { kind: 'failure', disposition: 'quarantine', code: 'AUTH' },
      disposition,
    )
    const second = await ctx.credentialBroker.acquire({ provider: 'deepseek-official', model: 'chat', purpose: 'conversation' })
    expect(String(second.credentialRef)).toBe('DEEPSEEK_API_KEY_2')
    ctx.credentialBroker.complete(second.id, { kind: 'success' })
    // The quarantined key never returns while the pool keeps running.
    const third = await ctx.credentialBroker.acquire({ provider: 'deepseek-official', model: 'chat', purpose: 'conversation' })
    expect(String(third.credentialRef)).toBe('DEEPSEEK_API_KEY_2')
    ctx.credentialBroker.complete(third.id, { kind: 'success' })
    await fiber.dispose()
  })

  it('never selects a disabled key', async () => {
    const { ctx, fiber } = await mount(config({
      pools: [{ provider: 'deepseek-official', keys: [{ ref: 'DEEPSEEK_API_KEY', enabled: false }, { ref: 'DEEPSEEK_API_KEY_2' }] }],
    }))
    const lease = await ctx.credentialBroker.acquire({ provider: 'deepseek-official', model: 'chat', purpose: 'conversation' })
    expect(String(lease.credentialRef)).toBe('DEEPSEEK_API_KEY_2')
    ctx.credentialBroker.complete(lease.id, { kind: 'success' })
    await fiber.dispose()
  })

  it('answers the adapter failover policy only for pooled providers', async () => {
    const { ctx, fiber } = await mount(config({ maxAttempts: 5 }))
    expect(ctx.keyPool.failover('deepseek-official')).toEqual({
      maxAttempts: 5,
      retryableCodes: expect.arrayContaining(['RATE_LIMIT', 'AUTH', 'QUOTA', 'MISSING_CREDENTIAL']),
    })
    expect(ctx.keyPool.failover('other-provider')).toBeUndefined()
    await fiber.dispose()
  })

  it('reports redacted pool status through the status tool', async () => {
    const { ctx, fiber } = await mount()
    const tool = ctx.tools.get('key_pool_status')
    expect(tool).toBeDefined()
    const status = await tool!.execute({}) as { pools: Array<{ provider: string; keys: Array<{ ref: string; eligible: boolean }> }> }
    expect(status.pools).toEqual([{
      provider: 'deepseek-official',
      keys: [
        { ref: 'DEEPSEEK_API_KEY', enabled: true, eligible: true },
        { ref: 'DEEPSEEK_API_KEY_2', enabled: true, eligible: true },
      ],
    }])
    expect(JSON.stringify(status)).not.toContain(SECRET_A)
    await fiber.dispose()
  })
})

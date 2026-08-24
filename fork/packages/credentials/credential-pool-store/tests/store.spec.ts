import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Storage } from '@deepseek-ai/dsh-storage'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { CredentialPoolStore } from '../src/index.ts'
import { credentialId, poolId } from '@deepseek-ai/dsh-fork-credential-broker'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

let root: string | undefined
const contexts: Context[] = []

const health = () => ({ excludedModels: [] as string[] })

afterEach(async () => {
  for (const context of contexts.splice(0)) await context.fiber.dispose()
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function boot(): Promise<Context> {
  const context = new Context()
  contexts.push(context)
  await context.plugin(Storage)
  const backend = new JsonStorageBackend(root!)
  const unregister = context.storage.backend.register('json', backend)
  context.effect(() => async () => { unregister(); await backend.close() })
  await context.plugin(CredentialPoolStore, { backend: 'json', unitName: 'credential_pools' })
  return context
}

describe('durable credential pool store', () => {
  it('commits pools, credentials, and detached health state as one snapshot', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pool-store-'))
    const first = await boot()
    await first.credentialPoolStore.upsertPool({ id: poolId('main'), provider: 'deepseek' })
    await first.credentialPoolStore.upsertCredential({
      id: credentialId('key-a'), pool: poolId('main'), reference: credentialRef('DEEPSEEK_API_KEY'),
      authKind: 'api-key', priority: 2, maxConcurrent: 1, enabled: true,
      health: {
        cooldownUntil: 5_000,
        quarantineReason: 'provider verification required',
        excludedModels: ['reasoner'],
        lastFailure: { disposition: 'cooldown', code: 'RATE_LIMIT', at: 4_000 },
        lastSuccessAt: 3_000,
      },
    })
    await expect(first.credentialPoolStore.upsertCredential({
      id: credentialId('key-b'), pool: poolId('main'), reference: credentialRef('DEEPSEEK_API_KEY'),
      authKind: 'api-key', priority: 1, maxConcurrent: 1, enabled: true, health: health(),
    })).rejects.toThrow(/already assigned/)

    const detached = first.credentialPoolStore.getSnapshot()
    ;(detached.credentials[0]!.health.excludedModels as string[]).push('chat')
    expect(first.credentialPoolStore.getSnapshot().credentials[0]!.health.excludedModels).toEqual(['reasoner'])

    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)

    const second = await boot()
    expect(second.credentialPoolStore.getSnapshot()).toEqual({
      version: 3,
      generation: 2,
      pools: [{ id: 'main', provider: 'deepseek' }],
      credentials: [{
        id: 'key-a', pool: 'main', reference: 'DEEPSEEK_API_KEY', authKind: 'api-key', priority: 2, maxConcurrent: 1, enabled: true, generation: 0,
        health: {
          cooldownUntil: 5_000,
          quarantineReason: 'provider verification required',
          excludedModels: ['reasoner'],
          lastFailure: { disposition: 'cooldown', code: 'RATE_LIMIT', at: 4_000 },
          lastSuccessAt: 3_000,
        },
      }],
    })
  })

  it('serializes id-based CAS mutations and rejects stale writers', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pool-store-'))
    const context = await boot()
    await context.credentialPoolStore.upsertPool({ id: poolId('main'), provider: 'deepseek' })
    await context.credentialPoolStore.upsertCredential({
      id: credentialId('key-a'), pool: poolId('main'), reference: credentialRef('DEEPSEEK_API_KEY'),
      authKind: 'api-key', priority: 0, maxConcurrent: 1, enabled: true, health: health(),
    })
    const expected = { generation: 0, version: 2 }
    const first = context.credentialPoolStore.setCredentialEnabled(credentialId('key-a'), expected, false)
    const second = context.credentialPoolStore.setCredentialEnabled(credentialId('key-a'), expected, true)
    const firstResult = await first
    expect(firstResult).toMatchObject({ version: { generation: 1, version: 3 } })
    await expect(second).rejects.toMatchObject({ code: 'CREDENTIAL_POOL_STALE_WRITER', actual: { generation: 1, version: 3 } })
    expect(context.credentialPoolStore.getSnapshot().credentials[0]?.enabled).toBe(false)
  })

  it('persists health and reauthentication transitions without secret values', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pool-store-'))
    const first = await boot()
    await first.credentialPoolStore.upsertPool({ id: poolId('main'), provider: 'deepseek' })
    await first.credentialPoolStore.upsertCredential({
      id: credentialId('key-a'), pool: poolId('main'), reference: credentialRef('DEEPSEEK_API_KEY'),
      authKind: 'oauth', priority: 0, maxConcurrent: 1, enabled: true, health: health(),
    })
    const healthResult = await first.credentialPoolStore.updateCredentialHealth(credentialId('key-a'), { generation: 0, version: 2 }, {
      excludedModels: ['reasoner'], lastSuccessAt: 10,
    })
    await first.credentialPoolStore.setCredentialReauthentication(credentialId('key-a'), healthResult.version, 'invalid_grant')
    await first.fiber.dispose()
    contexts.splice(contexts.indexOf(first), 1)
    const second = await boot()
    expect(second.credentialPoolStore.getSnapshot().credentials[0]).toMatchObject({
      enabled: false, generation: 2, reference: 'DEEPSEEK_API_KEY',
      health: { excludedModels: ['reasoner'], lastSuccessAt: 10, reauthenticateReason: 'invalid_grant' },
    })
    expect(JSON.stringify(second.credentialPoolStore.getSnapshot())).not.toContain('secret')
  })
  it('rejects stale CAS removal without deleting the credential', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pool-store-'))
    const context = await boot()
    await context.credentialPoolStore.upsertPool({ id: poolId('main'), provider: 'deepseek' })
    await context.credentialPoolStore.upsertCredential({
      id: credentialId('key-a'), pool: poolId('main'), reference: credentialRef('DEEPSEEK_API_KEY'),
      authKind: 'api-key', priority: 0, maxConcurrent: 1, enabled: true, health: health(),
    })
    await expect(context.credentialPoolStore.removeCredential(credentialId('key-a'), { generation: 9, version: 2 }))
      .rejects.toMatchObject({ code: 'CREDENTIAL_POOL_STALE_WRITER', actual: { generation: 0, version: 2 } })
    expect(context.credentialPoolStore.getSnapshot().credentials).toHaveLength(1)
  })

  it('rejects an entry whose pool does not exist', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pool-store-'))
    const context = await boot()
    await expect(context.credentialPoolStore.upsertCredential({
      id: credentialId('key-a'), pool: poolId('missing'), reference: credentialRef('DEEPSEEK_API_KEY'),
      authKind: 'api-key', priority: 0, maxConcurrent: 1, enabled: true, health: health(),
    })).rejects.toThrow(/does not exist/)
  })

  it('rejects malformed durable health state before committing it', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pool-store-'))
    const context = await boot()
    await context.credentialPoolStore.upsertPool({ id: poolId('main'), provider: 'deepseek' })
    await expect(context.credentialPoolStore.upsertCredential({
      id: credentialId('key-a'), pool: poolId('main'), reference: credentialRef('DEEPSEEK_API_KEY'),
      authKind: 'api-key', priority: 0, maxConcurrent: 1, enabled: true,
      health: { cooldownUntil: -1, excludedModels: ['chat'] },
    })).rejects.toThrow(/cooldownUntil/)
    await expect(context.credentialPoolStore.upsertCredential({
      id: credentialId('key-a'), pool: poolId('main'), reference: credentialRef('DEEPSEEK_API_KEY'),
      authKind: 'api-key', priority: 0, maxConcurrent: 1, enabled: true,
      health: { excludedModels: [], lastFailure: { disposition: 'unknown', code: 'BAD', at: 1 } },
    } as never)).rejects.toThrow(/failure disposition/)
    expect(context.credentialPoolStore.getSnapshot().credentials).toEqual([])
  })
})

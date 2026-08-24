import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Storage from '@deepseek-ai/dsh-storage'
import { apply as applyJson, Config as JsonConfig } from '@deepseek-ai/dsh-storage-json'
import { RemoteOAuthCredentialStore } from '@deepseek-ai/dsh-fork-credential-oauth'
import CredentialPoolStore from '@deepseek-ai/dsh-fork-credential-pool-store'
import PoolCredentialBroker from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('credential vertical chain through a real Loader composition', () => {
  it('propagates broker snapshots, applies health eligibility, and disposes remote subscriptions', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-credential-chain-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-storage'",
      "- name: '@deepseek-ai/dsh-storage-json'",
      '  config:',
      `    root: ${root.replaceAll('\\', '/')}`,
      "- name: '@deepseek-ai/dsh-fork-credential-pool-store'",
      '  config:',
      '    backend: json',
      '    unitName: credential_pools',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier === '@deepseek-ai/dsh-storage') return Storage
        if (specifier === '@deepseek-ai/dsh-storage-json') return { apply: applyJson, Config: JsonConfig, inject: ['storage'] }
        if (specifier === '@deepseek-ai/dsh-fork-credential-pool-store') return CredentialPoolStore
        if (specifier === '@deepseek-ai/dsh-fork-credential-broker-pool') return PoolCredentialBroker
        throw new Error(`unexpected Loader import: ${specifier}`)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    await context.credentialPoolStore.upsertPool({ id: 'main' as never, provider: 'deepseek' })
    await context.credentialPoolStore.upsertCredential({
      id: 'primary' as never, pool: 'main' as never, reference: 'PRIMARY_KEY' as never, authKind: 'api-key',
      priority: 2, maxConcurrent: 1, enabled: true, health: { excludedModels: [] },
    })
    await context.credentialPoolStore.upsertCredential({
      id: 'backup' as never, pool: 'main' as never, reference: 'BACKUP_KEY' as never, authKind: 'api-key',
      priority: 1, maxConcurrent: 1, enabled: true, health: { excludedModels: [] },
    })
    await context.loader.create({ name: '@deepseek-ai/dsh-fork-credential-broker-pool' })
    await context.loader.await()

    const loadedBroker = context.credentialBroker as PoolCredentialBroker
    let projected = loadedBroker.getSnapshot()
    const remote = new RemoteOAuthCredentialStore({
      getSnapshot: () => projected,
      subscribe: listener => loadedBroker.subscribe((event) => {
        projected = loadedBroker.getSnapshot()
        listener(event)
      }),
    }, 'deepseek')
    try {
      expect(remote.snapshot()).toMatchObject({ generation: 3, credentials: [{ id: 'primary' }, { id: 'backup' }] })

      const primary = await loadedBroker.acquire({ provider: 'deepseek', model: 'reasoner', purpose: 'conversation' })
      expect(primary.credential).toBe('primary')
      await loadedBroker.completeWithHealth(
        primary.id,
        { kind: 'failure', disposition: 'model-exclude', code: 'UNSUPPORTED_MODEL' },
        { kind: 'model-exclude', model: 'reasoner' },
      )
      expect(remote.snapshot()).toMatchObject({ generation: 4, credentials: [{ id: 'primary' }, { id: 'backup' }] })
      expect(context.credentialPoolStore.getSnapshot().credentials[0]?.health.excludedModels).toEqual(['reasoner'])

      const backup = await loadedBroker.acquire({ provider: 'deepseek', model: 'reasoner', purpose: 'conversation' })
      expect(backup.credential).toBe('backup')
      await loadedBroker.completeWithHealth(backup.id, { kind: 'success' }, { kind: 'healthy' })
      const beforeDispose = remote.snapshot()
      remote.dispose()

      const next = await loadedBroker.acquire({ provider: 'deepseek', model: 'chat', purpose: 'conversation' })
      await loadedBroker.completeWithHealth(next.id, { kind: 'failure', disposition: 'retain', code: 'TRANSIENT' }, { kind: 'retain' })
      expect(context.credentialPoolStore.getSnapshot().generation).toBe(beforeDispose.generation + 1)
      expect(remote.snapshot()).toEqual(beforeDispose)
    } finally {
      remote.dispose()
    }
  })
})

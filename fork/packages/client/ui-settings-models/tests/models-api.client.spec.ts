import { describe, expect, it, vi } from 'vitest'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import { createModelsApi } from '../src/client/models-api.ts'

function remoteFixture(): ClientRemote {
  return {
    settings: {
      describe: vi.fn(async () => ({
        ok: true as const,
        value: { writable: true, hasDocument: true, namespaces: [] },
      })),
      update: vi.fn(async () => ({ ok: true as const, value: {} })),
      replace: vi.fn(async () => ({ ok: true as const, value: {} })),
      mutate: vi.fn(async () => ({ ok: true as const, value: {} })),
    },
    credentials: {
      describe: vi.fn(async () => ({
        ok: true as const,
        value: { KEY: { configured: true, writable: true } },
      })),
      set: vi.fn(async () => ({ ok: true as const, value: undefined })),
      unset: vi.fn(async () => ({ ok: true as const, value: undefined })),
    },
    llm: {
      listConfigurableProviders: vi.fn(async () => ({
        ok: true as const,
        value: [{ provider: 'declared', displayName: 'Declared', settingsNs: 'llm-pi-ai', settingsPath: [] }],
      })),
      listProviders: vi.fn(async () => ({
        ok: true as const,
        value: [{ id: 'declared', name: 'Declared' }, { id: 'native', name: 'Native' }],
      })),
      discoverModels: vi.fn(async () => ({
        ok: true as const,
        value: [{ id: 'model-a', name: 'Model A' }],
      })),
    },
  } as unknown as ClientRemote
}

describe('fork Models Remote compatibility face', () => {
  it('merges provider directory entries and maps credential responses', async () => {
    const remote = remoteFixture()
    const api = createModelsApi(remote)

    const providers = await api.llm.providers({})
    expect(providers.result).toEqual({
      ok: true,
      value: {
        providers: [
          { provider: 'declared', displayName: 'Declared', settingsNs: 'llm-pi-ai', settingsPath: [], active: true },
          { provider: 'native', displayName: 'Native', settingsNs: '', settingsPath: [], active: true },
        ],
      },
    })

    const credentials = await api.credentials.describe({ refs: ['KEY'] })
    expect(credentials.result).toEqual({ ok: true, value: { credentials: { KEY: { configured: true, writable: true } } } })
    await api.credentials.set({ ref: 'KEY', value: 'secret' })
    expect(remote.credentials.set).toHaveBeenCalledWith('KEY', 'secret')
  })

  it('forwards settings writes and maps model discovery', async () => {
    const remote = remoteFixture()
    const api = createModelsApi(remote)
    const signal = new AbortController().signal

    await api.settings.mutate({ ns: 'llm-pi-ai', ops: [{ op: 'unset', path: ['providers', 'demo'] }], expectedRevision: 4 })
    expect(remote.settings.mutate).toHaveBeenCalledWith('llm-pi-ai', [{ op: 'unset', path: ['providers', 'demo'] }], 4)

    const discovered = await api.llm.discoverModels({
      settingsNs: 'llm-bearer',
      provider: 'demo',
      modelsURL: 'https://example.test/models',
      api: 'bearer-chat',
    }, signal)
    expect(discovered.result).toEqual({ ok: true, value: { models: [{ id: 'model-a', name: 'Model A' }] } })
    expect(remote.llm.discoverModels).toHaveBeenCalledWith(
      'llm-bearer',
      {
        provider: 'demo',
        baseURL: 'https://example.test/models',
        modelsURL: 'https://example.test/models',
        api: 'bearer-chat',
      },
      signal,
    )
  })
})

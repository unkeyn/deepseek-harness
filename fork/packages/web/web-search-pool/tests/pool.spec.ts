import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WebRuntime from '@deepseek-ai/dsh-fork-web'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import * as poolPlugin from '@deepseek-ai/dsh-fork-web-search-pool'

const secretA = 'secret-a-value'
const secretB = 'secret-b-value'

function config(overrides: Partial<poolPlugin.Config> = {}): poolPlugin.Config {
  return {
    providers: [{
      id: 'provider-a', name: 'Provider A', priority: 0, endpoint: 'https://search.example.test/api', method: 'GET', queryParam: 'q', authMode: 'header', authName: 'x-api-key',
      responseResultsPath: 'results', resultUrlPath: 'url', resultTitlePath: 'title', resultSnippetPath: 'snippet', resultDatePath: 'date',
      keys: [
        { id: 'key-1', ref: 'CUSTOM_KEY_A', enabled: true, priority: 10, maxConcurrent: 1 },
        { id: 'key-2', ref: 'CUSTOM_KEY_B', enabled: true, priority: 1, maxConcurrent: 1 },
      ], enabled: true,
    }], maxAttempts: 2, cooldownMs: 60_000, ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function mount(initial: poolPlugin.Config = config()) {
  const ctx = new Context()
  const values = new Map([
    [credentialRef('CUSTOM_KEY_A'), { value: secretA, source: 'test' }],
    [credentialRef('CUSTOM_KEY_B'), { value: secretB, source: 'test' }],
  ])
  const credentials = {
    resolve: vi.fn((ref: ReturnType<typeof credentialRef>) => Promise.resolve(values.get(ref))),
    describe: vi.fn((ref: ReturnType<typeof credentialRef>) => Promise.resolve({ configured: values.has(ref), writable: true })),
    set: vi.fn(), unset: vi.fn(),
  }
  // The real wiring registers the namespace and rebuilds the runtime config
  // from committed documents; the double resolves and validates through the
  // real schema exactly as the settings service would, so a stored section
  // the owner's validate refuses fails here the same way.
  const watchers = new Set<() => void>()
  const registerErrors: unknown[] = []
  const settings = {
    get: vi.fn(() => initial),
    update: vi.fn(async (_ns: unknown, patch: { providers: poolPlugin.PoolProvider[] }) => {
      initial.providers = patch.providers
      for (const watcher of watchers) watcher()
    }),
  }
  ;(settings as Record<string, unknown>).register = vi.fn((_ns: unknown, schema: (value: unknown) => unknown, options?: { base?: unknown; validate?: (value: unknown) => void }) => {
    try {
      const resolved = schema({ ...(options?.base ?? {}), ...initial }) as poolPlugin.Config
      options?.validate?.(resolved)
      return {
        get: (): poolPlugin.Config => ({ ...(options?.base ?? {}), ...initial }),
        watch: (callback: () => void) => {
          watchers.add(callback)
          return () => watchers.delete(callback)
        },
        update: async (patch: { providers: poolPlugin.PoolProvider[] }): Promise<void> => {
          initial.providers = patch.providers
          for (const watcher of watchers) watcher()
        },
        replace: async (section: poolPlugin.Config): Promise<void> => {
          Object.assign(initial, section)
          for (const watcher of watchers) watcher()
        },
      }
    } catch (error) {
      registerErrors.push(error)
      throw error
    }
  })
  ctx.provide('credentials', credentials as never)
  ctx.provide('settings', settings as never)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(WebRuntime, { searchProviders: ['custom-pool'] })
  const fiber = await ctx.plugin(poolPlugin, initial)
  return { ctx, fiber, credentials, settings, initial, registerErrors }
}

afterEach(() => vi.unstubAllGlobals())

describe('web-search-pool', () => {
  it('rotates from a failing key to a lower-priority key and persists redacted health', async () => {
    const calls: Array<{ key: string; url: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      const key = headers['x-api-key'] ?? ''
      calls.push({ key, url: String(input) })
      return key === secretA ? jsonResponse({ error: 'rate limited' }, 429) : jsonResponse({ results: [{ url: 'https://result.test', title: 'Result' }] })
    }))
    const { ctx, fiber, settings, initial } = await mount()
    await expect(ctx.web.search({ query: 'hello' })).resolves.toEqual({ sources: [{ url: 'https://result.test', title: 'Result' }], truncated: false })
    expect(calls.map(call => call.key)).toEqual([secretA, secretB])
    expect(calls[0]!.url).toBe('https://search.example.test/api?q=hello')
    expect(settings.update).toHaveBeenCalled()
    const persisted = initial.providers?.[0]?.keys[0]
    expect(persisted).toBeDefined()
    expect(persisted!.lastError).toContain('HTTP 429')
    expect(JSON.stringify(persisted)).not.toContain(secretA)
    await fiber.dispose()
  })

  it('never follows redirects and does not include a secret in exhausted errors or status', async () => {
    const fetchMock = vi.fn(async (..._args: [string | URL, RequestInit | undefined]) => jsonResponse({ error: 'unauthorized' }, 401))
    vi.stubGlobal('fetch', fetchMock)
    const { ctx, fiber } = await mount()
    await expect(ctx.web.search({ query: 'private' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CHAIN_FAILED' }))
    const error = await ctx.web.search({ query: 'private' }).then(() => new Error('unexpected success'), value => value as Error)
    expect(error.message).not.toContain(secretA)
    const tool = ctx.tools.get('web_search_pool_status')
    expect(tool).toBeDefined()
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0)
    expect(fetchMock.mock.calls.every(call => (call[1] as RequestInit | undefined)?.redirect === 'error')).toBe(true)
    await fiber.dispose()
  })

  it('quarantines confirmed auth failures and skips the quarantined key on the next request', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const key = ((init?.headers ?? {}) as Record<string, string>)['x-api-key'] ?? ''
      calls.push(key)
      if (key === secretA) return jsonResponse({ error: 'unauthorized' }, 401)
      return jsonResponse({ results: [{ url: 'https://result.test', title: 'Result' }] })
    }))
    const { ctx, fiber } = await mount()
    await expect(ctx.web.search({ query: 'first' })).resolves.toMatchObject({ sources: [{ url: 'https://result.test' }] })
    await expect(ctx.web.search({ query: 'second' })).resolves.toMatchObject({ sources: [{ url: 'https://result.test' }] })
    expect(calls).toEqual([secretA, secretB, secretB])
    await fiber.dispose()
  })

  it('reports a missing credential without exposing a secret or making a request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const { ctx, fiber, credentials } = await mount(config({ providers: [{
      ...config().providers![0]!,
      keys: [{ id: 'missing', ref: 'MISSING_KEY', enabled: true, priority: 10, maxConcurrent: 1 }],
    }] }))
    credentials.resolve.mockResolvedValue(undefined)
    const error = await ctx.web.search({ query: 'missing' }).then(() => new Error('unexpected success'), value => value as Error)
    expect(error.message).toContain('WEB_CREDENTIAL_MISSING')
    expect(error.message).not.toContain(secretA)
    expect(fetchMock).not.toHaveBeenCalled()
    await fiber.dispose()
  })
  it('registers and removes its provider and management tools with the fiber', async () => {
    const { ctx, fiber } = await mount(config({ providers: [] }))
    expect(ctx.tools.get('web_search_pool_status')).toBeDefined()
    expect(ctx.tools.get('web_search_pool_rotate')).toBeDefined()
    await fiber.dispose()
    expect(ctx.tools.get('web_search_pool_status')).toBeUndefined()
  })

  it('registers its namespace for a stored section whose providers carry no check spec', async () => {
    // Schemastery materializes an absent nested object as `{}`; the owner's
    // validate must treat that as absence or the registration dies and the
    // whole namespace disappears from the deployment.
    const { fiber, registerErrors } = await mount(config())
    expect(registerErrors).toEqual([])
    await fiber.dispose()
  })

  it('reports per-key credits through the status tool for providers with an account endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      if (String(input).includes('credit-usage')) return jsonResponse({ data: { remainingCredits: 490, planCredits: 500 } })
      return jsonResponse({ results: [] })
    }))
    const { ctx, fiber } = await mount(config({ providers: [{
      ...config().providers![0]!,
      check: { endpoint: 'https://account.example.test/credit-usage', remainingPath: 'data.remainingCredits', limitPath: 'data.planCredits' },
    }] }))
    const result = await ctx.tools.execute({ name: 'web_search_pool_status', arguments: {}, signal: new AbortController().signal })
    const payload = result.value as { providers: Array<{ credits?: Array<Record<string, unknown>> }> }
    expect(payload.providers[0].credits).toEqual([
      { keyId: 'key-1', ref: 'CUSTOM_KEY_A', valid: true, status: 200, remaining: 490, limit: 500 },
      { keyId: 'key-2', ref: 'CUSTOM_KEY_B', valid: true, status: 200, remaining: 490, limit: 500 },
    ])
    await fiber.dispose()
  })

  it('quarantines a key the provider rejects as out of credits', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL, init?: RequestInit) => {
      const key = ((init?.headers ?? {}) as Record<string, string>)['x-api-key'] ?? ''
      return key === secretA ? jsonResponse({ error: 'payment required' }, 402) : jsonResponse({ results: [{ url: 'https://result.test' }] })
    }))
    const { ctx, fiber, initial } = await mount()
    await expect(ctx.web.search({ query: 'first' })).resolves.toMatchObject({ sources: [{ url: 'https://result.test' }] })
    const persisted = initial.providers?.[0]?.keys[0]
    expect(persisted?.lastError).toContain('HTTP 402')
    expect(persisted?.quarantineUntil).toBeGreaterThan(Date.now())
    await fiber.dispose()
  })

  it('applies a committed settings change to the live pool without a reload', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL, init?: RequestInit) => {
      calls.push(((init?.headers ?? {}) as Record<string, string>)['x-api-key'] ?? '')
      return jsonResponse({ results: [{ url: 'https://result.test' }] })
    }))
    const { ctx, fiber, settings } = await mount(config({ maxAttempts: 1 }))
    await expect(ctx.web.search({ query: 'first' })).resolves.toMatchObject({ sources: [{ url: 'https://result.test' }] })
    // The document write a UI save makes: the pool keeps only the second key.
    await settings.update('web-search-pool', {
      providers: [{ ...config().providers![0]!, keys: [config().providers![0]!.keys[1]!] }],
    })
    await expect(ctx.web.search({ query: 'second' })).resolves.toMatchObject({ sources: [{ url: 'https://result.test' }] })
    expect(calls).toEqual([secretA, secretB])
    await fiber.dispose()
  })
})

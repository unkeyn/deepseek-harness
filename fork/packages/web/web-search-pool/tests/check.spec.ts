import { afterEach, describe, expect, it, vi } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { checkProviderKeys, type CheckDeps } from '../src/check.ts'
import type { PoolProvider, RuntimeConfig } from '../src/types.ts'

const secret = 'secret-key-value'

afterEach(() => vi.unstubAllGlobals())

function provider(overrides: Partial<PoolProvider> = {}): PoolProvider {
  return {
    id: 'provider-a', name: 'Provider A', priority: 0, endpoint: 'https://search.example.test/api', method: 'GET', queryParam: 'q',
    authMode: 'bearer', authName: 'authorization', responseResultsPath: 'results', resultUrlPath: 'url', resultTitlePath: 'title',
    resultSnippetPath: 'snippet', resultDatePath: 'date',
    keys: [{ id: 'key-1', ref: 'CHECK_KEY', enabled: true, priority: 0, maxConcurrent: 1 }],
    enabled: true, ...overrides,
  }
}

function config(providers: PoolProvider[]): RuntimeConfig {
  return { providers, maxAttempts: 2, cooldownMs: 60_000 }
}

function deps(configValue: RuntimeConfig, resolve = async () => ({ value: secret })): CheckDeps {
  return { resolveCredential: resolve as (ref: ReturnType<typeof credentialRef>) => Promise<{ value: string } | undefined>, config: configValue }
}

describe('web-search-pool key checks', () => {
  it('reads validity and credit numbers from the account endpoint', async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; redirect: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', headers: init?.headers as Record<string, string>, redirect: String(init?.redirect ?? '') })
      return new Response(JSON.stringify({ data: { remainingCredits: 490, planCredits: 500, usage: 10 } }), { status: 200 })
    }))
    const results = await checkProviderKeys(deps(config([provider({
      check: { endpoint: 'https://api.example.test/usage', remainingPath: 'data.remainingCredits', limitPath: 'data.planCredits', usagePath: 'data.usage' },
    })])), 'provider-a')
    expect(results).toEqual([{
      keyId: 'key-1', ref: 'CHECK_KEY', valid: true, status: 200, remaining: 490, limit: 500, used: 10,
    }])
    expect(calls[0]?.url).toBe('https://api.example.test/usage')
    expect(calls[0]?.headers.authorization).toBe(`Bearer ${secret}`)
    expect(calls[0]?.redirect).toBe('error')
  })

  it('marks a key invalid when the account endpoint rejects it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    const results = await checkProviderKeys(deps(config([provider({
      check: { endpoint: 'https://api.example.test/usage', remainingPath: 'data.remainingCredits' },
    })])), 'provider-a')
    expect(results[0]).toMatchObject({ valid: false, status: 401 })
    expect(JSON.stringify(results)).not.toContain(secret)
  })

  it('falls back to one minimal query ping without a check spec', async () => {
    const calls: Array<{ url: string; method: string; body: string }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: String(init?.body ?? '') })
      return new Response(JSON.stringify({ results: [] }), { status: 200 })
    }))
    const results = await checkProviderKeys(deps(config([provider({ method: 'POST', queryParam: 'query' })])), 'provider-a')
    expect(results[0]).toMatchObject({ valid: true, status: 200 })
    expect(calls[0]?.url).toBe('https://search.example.test/api')
    expect(JSON.parse(calls[0]?.body)).toEqual({ query: 'dsh key check' })
  })

  it('treats a validation refusal from the ping as an accepted key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 422 })))
    const results = await checkProviderKeys(deps(config([provider()])), 'provider-a')
    expect(results[0]).toMatchObject({ valid: true, status: 422 })
  })

  it('reports a missing credential without making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const results = await checkProviderKeys(deps(config([provider()]), async () => undefined), 'provider-a')
    expect(results[0]).toMatchObject({ valid: false, error: "credential 'CHECK_KEY' is not configured" })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(JSON.stringify(results)).not.toContain(secret)
  })

  it('never carries the key material in a transport failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const results = await checkProviderKeys(deps(config([provider({
      check: { endpoint: 'https://api.example.test/usage' },
    })])), 'provider-a')
    expect(results[0]?.valid).toBe(false)
    expect(results[0]?.error).toContain('check request failed')
    expect(JSON.stringify(results)).not.toContain(secret)
  })
})

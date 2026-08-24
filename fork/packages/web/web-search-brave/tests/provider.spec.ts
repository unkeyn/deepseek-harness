import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BraveSearchProvider,
  mapBraveResponse,
  mapBraveResult,
} from '../src/provider.ts'

afterEach(() => vi.unstubAllGlobals())

describe('Brave result mapping', () => {
  it('keeps title, snippet, and age when present', () => {
    expect(mapBraveResult({ url: 'https://a', title: 'A', description: 'snippet', age: '2 days ago' }))
      .toEqual({ url: 'https://a', title: 'A', snippet: 'snippet', publishedAt: '2 days ago' })
  })

  it('drops entries without a portable snippet and blank snippets', () => {
    expect(mapBraveResult({ url: 'https://a' })).toBeUndefined()
    expect(mapBraveResult({ url: 'https://a', description: '   ' })).toBeUndefined()
  })

  it('maps an envelope, dropping snippet-less results', () => {
    expect(mapBraveResponse({
      results: [
        { url: 'https://kept', description: 'kept snippet' },
        { url: 'https://dropped' },
      ],
    })).toEqual({
      sources: [{ url: 'https://kept', snippet: 'kept snippet' }],
      truncated: false,
    })
  })

  it('maps an empty envelope to no sources', () => {
    expect(mapBraveResponse({})).toEqual({ sources: [], truncated: false })
  })
})

describe('BraveSearchProvider availability', () => {
  it('is unavailable without a key and available with one', () => {
    expect(new BraveSearchProvider({ apiKey: '', baseURL: 'https://b.test', model: 'brave-search' }).available()).toBe(false)
    expect(new BraveSearchProvider({ apiKey: 'k', baseURL: 'https://b.test', model: 'brave-search' }).available()).toBe(true)
  })

  it('sends the key header and maps the response', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), headers: init?.headers as Record<string, string> })
      return new Response(JSON.stringify({ results: [{ url: 'https://a', title: 'A', description: 's' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    const provider = new BraveSearchProvider({ apiKey: 'k', baseURL: 'https://b.test/search', model: 'brave-search' })
    await expect(provider.search({ query: 'q v' })).resolves.toEqual({
      sources: [{ url: 'https://a', title: 'A', snippet: 's' }],
      truncated: false,
    })
    expect(calls[0]?.url).toBe('https://b.test/search?q=q%20v')
    expect(calls[0]?.headers['x-api-key']).toBe('k')
  })

  it('fails redirects as WEB_PROVIDER_ERROR without contacting the target', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.test/' } })))
    const provider = new BraveSearchProvider({ apiKey: 'k', baseURL: 'https://b.test', model: 'brave-search' })
    await expect(provider.search({ query: 'q' })).rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })
})

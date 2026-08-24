import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FirecrawlSearchProvider,
  mapFirecrawlResponse,
  mapFirecrawlResult,
} from '../src/provider.ts'

afterEach(() => vi.unstubAllGlobals())

describe('Firecrawl result mapping', () => {
  it('keeps title and snippet when present', () => {
    expect(mapFirecrawlResult({ url: 'https://a', title: 'A', description: 'snippet' }))
      .toEqual({ url: 'https://a', title: 'A', snippet: 'snippet' })
  })

  it('drops entries without a portable snippet and blank snippets', () => {
    expect(mapFirecrawlResult({ url: 'https://a' })).toBeUndefined()
    expect(mapFirecrawlResult({ url: 'https://a', description: '' })).toBeUndefined()
  })

  it('maps an envelope, dropping snippet-less results', () => {
    expect(mapFirecrawlResponse({
      results: [
        { url: 'https://kept', title: 'Kept', description: 'kept snippet' },
        { url: 'https://dropped' },
      ],
    })).toEqual({
      sources: [{ url: 'https://kept', title: 'Kept', snippet: 'kept snippet' }],
      truncated: false,
    })
  })
})

describe('FirecrawlSearchProvider availability and transport', () => {
  it('is unavailable without a key and available with one', () => {
    expect(new FirecrawlSearchProvider({ apiKey: '', baseURL: 'https://f.test' }).available()).toBe(false)
    expect(new FirecrawlSearchProvider({ apiKey: 'k', baseURL: 'https://f.test' }).available()).toBe(true)
  })

  it('sends the query parameter and key header', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), headers: init?.headers as Record<string, string> })
      return new Response(JSON.stringify({ results: [{ url: 'https://a', description: 's' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } })
    }))

    const provider = new FirecrawlSearchProvider({ apiKey: 'k', baseURL: 'https://f.test/v1/search' })
    await expect(provider.search({ query: 'q' })).resolves.toEqual({
      sources: [{ url: 'https://a', snippet: 's' }],
      truncated: false,
    })
    expect(calls[0]?.url).toBe('https://f.test/v1/search?query=q')
    expect(calls[0]?.headers['x-api-key']).toBe('k')
  })

  it('propagates the abort signal as WEB_ABORTED', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn((_url: string | URL, init?: RequestInit) => {
      controller.abort()
      return new Promise<Response>((_resolve, reject) => reject(new DOMException('aborted', 'AbortError')))
    }))
    const provider = new FirecrawlSearchProvider({ apiKey: 'k', baseURL: 'https://f.test' })
    await expect(provider.search({ query: 'q' }, controller.signal))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })
})

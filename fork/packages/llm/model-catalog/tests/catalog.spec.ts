import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ModelCatalog, { DEFAULT_REFRESH_URL } from '@deepseek-ai/dsh-fork-model-catalog'
import type { Config } from '@deepseek-ai/dsh-fork-model-catalog'

/**
 * A bundled-snapshot id the pinned dependency ships. It anchors every
 * fallback assertion: whatever the refresh outcome, resolution must keep
 * working for ids the process already knew.
 */
const BUNDLED_ID = 'gpt-5.6-sol'

/** A minimal valid catalog document: one id no snapshot ships plus a replacement for the bundled anchor. */
const FRESH_DOCUMENT = {
  'acme-gateway': {
    'acme-nova': {
      id: 'acme-nova',
      name: 'Acme Nova',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 123_456,
      maxTokens: 4_096,
      thinking: { mode: 'effort', efforts: ['low', 'high'] },
    },
    [BUNDLED_ID]: {
      id: BUNDLED_ID,
      name: 'Fresh Snapshot Entry',
    },
  },
  'kilo': {
    'stealth/ox-alpha': {
      id: 'stealth/ox-alpha',
      name: 'Ox Alpha (kilo)',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 1_048_576,
      maxTokens: 131_072,
      thinking: { mode: 'effort', efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
    },
  },
  'openrouter': {
    'stealth/ox-alpha': {
      id: 'stealth/ox-alpha',
      name: 'Ox Alpha',
      reasoning: true,
      input: ['text', 'image'],
      contextWindow: 1_048_576,
      maxTokens: 131_072,
      thinking: { mode: 'effort', efforts: ['low', 'high', 'max'] },
    },
  },
}

type FetchMock = ReturnType<typeof vi.fn>

let fetchMock: FetchMock

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** One reply with the given JSON body and status. */
function reply(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, ...init })
}

async function boot(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(ModelCatalog, config)
  return ctx
}

describe('startup catalog refresh', () => {
  it('replaces the bundled snapshot with a fetched one before consumers resolve', async () => {
    fetchMock.mockResolvedValue(reply(FRESH_DOCUMENT))
    const ctx = await boot()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[0]).toBe(DEFAULT_REFRESH_URL)
    // The bundled anchor resolves through the fetched document's replacement,
    // proving the whole lookup table was swapped rather than merged.
    expect(ctx.modelCatalog.resolve(BUNDLED_ID)).toMatchObject({ id: BUNDLED_ID, name: 'Fresh Snapshot Entry' })
    expect(ctx.modelCatalog.resolve('acme-nova')).toMatchObject({
      id: 'acme-nova',
      name: 'Acme Nova',
      input: ['text', 'image'],
      reasoning: true,
      contextWindow: 123_456,
      maxTokens: 4_096,
      thinking: { mode: 'effort', efforts: ['low', 'high'] },
    })
    // Lookup keys stay lowercase across the swap.
    expect(ctx.modelCatalog.resolve('ACME-NOVA')?.id).toBe('acme-nova')
  })

  it('answers a named provider with its own record before the cross-provider best', async () => {
    fetchMock.mockResolvedValue(reply(FRESH_DOCUMENT))
    const ctx = await boot()

    // The global pick ranks the more complete entry, whatever provider owns it.
    expect(ctx.modelCatalog.resolve('stealth/ox-alpha')?.thinking?.efforts).toEqual([
      'minimal', 'low', 'medium', 'high', 'xhigh',
    ])
    // A consumer serving a known gateway reads that gateway's wire facts.
    expect(ctx.modelCatalog.resolveFor('OpenRouter', 'stealth/ox-alpha')?.thinking?.efforts).toEqual([
      'low', 'high', 'max',
    ])
    // An unknown provider falls back to the global pick.
    expect(ctx.modelCatalog.resolveFor('acme-gateway', 'stealth/ox-alpha')?.name).toBe('Ox Alpha (kilo)')
  })

  it('keeps serving the bundled snapshot when the source is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'))
    const ctx = await boot()

    expect(ctx.modelCatalog.resolve(BUNDLED_ID)?.id).toBe(BUNDLED_ID)
    expect(ctx.modelCatalog.resolve('acme-nova')).toBeUndefined()
  })

  it('keeps serving the bundled snapshot when the source refuses or answers wrongly', async () => {
    for (const outcome of [
      () => new Response('nope', { status: 503 }),
      () => reply({ providers: [] }),
      () => reply({ acme: { broken: { name: 'no id' } } }),
      () => reply('not even an object'),
      () => new Response('{"a":1}', { headers: { 'content-length': String(64 * 1024 * 1024) } }),
    ]) {
      fetchMock.mockReset()
      fetchMock.mockResolvedValueOnce(outcome())
      const ctx = await boot()

      expect(ctx.modelCatalog.resolve(BUNDLED_ID)?.id).toBe(BUNDLED_ID)
      expect(ctx.modelCatalog.resolve('acme-nova')).toBeUndefined()
    }
  })

  it('honors a custom URL from configuration', async () => {
    let observedInit: RequestInit | undefined
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      observedInit = init
      return Promise.resolve(reply(FRESH_DOCUMENT))
    })
    await boot({ refreshUrl: 'https://pi.dev/api/models' })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://pi.dev/api/models')
    // The deadline travels as the request's abort signal.
    expect(observedInit?.signal).toBeInstanceOf(AbortSignal)
  })

  it('skips the network entirely when refresh is disabled', async () => {
    const ctx = await boot({ refresh: false })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(ctx.modelCatalog.resolve(BUNDLED_ID)?.id).toBe(BUNDLED_ID)
  })
})

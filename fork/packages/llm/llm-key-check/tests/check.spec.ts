import { describe, expect, it, vi } from 'vitest'
import { checkKeys, findRoute, MAX_KEYS_PER_CALL, type KeyCheckDeps, type KeyCheckTarget } from '../src/check.ts'
import type { KeyCheckRoute } from '../src/providers.ts'

/** A key that is legal to put in a header and easy to assert is not echoed back. */
const KEY = 'nvapi-check-key-0001'

/** One route, wired to the fake gateway's paths. */
function route(overrides: Partial<KeyCheckRoute> = {}): KeyCheckRoute {
  return {
    provider: 'nvidia',
    displayName: 'nvidia',
    api: 'openai-completions',
    modelsUrl: 'https://gw.example.test/v1/models',
    completionsUrl: 'https://gw.example.test/v1/chat/completions',
    probeModel: 'model-one',
    source: 'catalog',
    ...overrides,
  }
}

/** One probe request, as the fake gateway saw it. */
interface Seen {
  url: string
  method: string
  headers: Record<string, string>
  body: string
}

/**
 * A fetch stand-in answering with one status per shape of request.
 * @param completions - status for a POST to the completion endpoint.
 * @param listing - status for a GET of the listing endpoint.
 * @returns the fetch implementation and the requests it was asked.
 */
function gateway(completions: number, listing = 200): { fetch: typeof fetch; seen: Seen[] } {
  const seen: Seen[] = []
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : String(input)
    seen.push({
      url,
      method: init?.method ?? 'GET',
      headers: init?.headers as Record<string, string>,
      body: init?.body === undefined ? '' : String(init.body),
    })
    const status = init?.method === 'POST' ? completions : listing
    return new Response('{}', { status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fetch: fetchImpl, seen }
}

/** Run one check against one route with the supplied fetch. */
function deps(routes: readonly KeyCheckRoute[], overrides: Partial<KeyCheckDeps> = {}): KeyCheckDeps {
  return { routes: () => routes, ...overrides }
}

/** One target, so a test name can say what it is asking about. */
function target(overrides: Partial<KeyCheckTarget> = {}): KeyCheckTarget {
  return { id: 'row-0', provider: 'nvidia', apiKey: KEY, ...overrides }
}

describe('findRoute', () => {
  it('matches a provider id without regard to case or surrounding space', () => {
    expect(findRoute([route()], 'NVIDIA')?.provider).toBe('nvidia')
    expect(findRoute([route()], '  nvidia  ')?.provider).toBe('nvidia')
  })

  it('answers undefined for an id no source describes', () => {
    expect(findRoute([route()], 'not-a-provider')).toBeUndefined()
  })
})

describe('checkKeys', () => {
  it('proves a key with the completion the gateway authenticates', async () => {
    const { fetch, seen } = gateway(200)
    const outcomes = await checkKeys(deps([route()], { fetch }), [target()])
    expect(outcomes).toEqual([{ id: 'row-0', provider: 'nvidia', valid: true, status: 200, via: 'completion' }])
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe('https://gw.example.test/v1/chat/completions')
    expect(seen[0]?.headers.authorization).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(seen[0]?.body ?? '{}')).toMatchObject({ model: 'model-one', max_tokens: 1 })
  })

  it('reads a complaint raised after the gateway resolved the caller as acceptance', async () => {
    // A model the account no longer carries is not a statement about the key.
    const { fetch } = gateway(404)
    const outcomes = await checkKeys(deps([route()], { fetch }), [target()])
    expect(outcomes[0]).toMatchObject({ valid: true, status: 404, via: 'completion' })
  })

  it('reads a gateway rejection as a bad key', async () => {
    const { fetch } = gateway(403)
    const outcomes = await checkKeys(deps([route()], { fetch }), [target()])
    expect(outcomes[0]).toMatchObject({ valid: false, status: 403, via: 'completion', error: 'the provider rejected the key (HTTP 403)' })
  })

  it('falls back to the listing when the completion endpoint fails on its own', async () => {
    const { fetch, seen } = gateway(500, 200)
    const outcomes = await checkKeys(deps([route()], { fetch }), [target()])
    expect(outcomes[0]).toMatchObject({ valid: true, status: 200, via: 'listing' })
    expect(seen.map(request => request.url)).toEqual([
      'https://gw.example.test/v1/chat/completions',
      'https://gw.example.test/v1/models',
    ])
  })

  it('reports the listing rejection when both requests refuse the key', async () => {
    const { fetch } = gateway(500, 401)
    const outcomes = await checkKeys(deps([route()], { fetch }), [target()])
    expect(outcomes[0]).toMatchObject({ valid: false, status: 401, via: 'listing' })
  })

  it('asks only the listing for a route that names no model', async () => {
    // Guessing a model id would turn "model unknown" into "key unknown".
    const { fetch, seen } = gateway(500, 200)
    const outcomes = await checkKeys(deps([route({ probeModel: undefined })], { fetch }), [target()])
    expect(outcomes[0]).toMatchObject({ valid: true, via: 'listing' })
    expect(seen.map(request => request.url)).toEqual(['https://gw.example.test/v1/models'])
  })

  it('keys an Anthropic route with its own header, not a bearer token', async () => {
    const { fetch, seen } = gateway(200)
    const outcomes = await checkKeys(
      deps([route({ api: 'anthropic-messages', completionsUrl: 'https://gw.example.test/v1/messages' })], { fetch }),
      [target()],
    )
    expect(outcomes[0]?.valid).toBe(true)
    expect(seen[0]?.headers).toMatchObject({ 'x-api-key': KEY, 'anthropic-version': '2023-06-01' })
    expect(seen[0]?.headers.authorization).toBeUndefined()
  })

  it('refuses a provider no source describes without leaving the host', async () => {
    const { fetch, seen } = gateway(200)
    const outcomes = await checkKeys(deps([route()], { fetch }), [target({ provider: 'not-a-provider' })])
    expect(outcomes[0]).toEqual({
      id: 'row-0',
      provider: 'not-a-provider',
      valid: false,
      error: 'this provider is not available here',
    })
    expect(seen).toHaveLength(0)
  })

  it('refuses an unusable key locally rather than blaming the provider', async () => {
    const { fetch, seen } = gateway(200)
    const outcomes = await checkKeys(deps([route()], { fetch }), [target({ apiKey: '   ' }), target({ id: 'row-1', apiKey: 'ba\0d' })])
    expect(outcomes[0]?.error).toBe('the key is empty')
    expect(outcomes[1]?.error).toBe('the key contains characters no HTTP header can carry')
    expect(seen).toHaveLength(0)
  })

  it('reports a transport failure as unreachable, not as a bad key', async () => {
    const fetch = vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND') }) as unknown as typeof fetch
    const outcomes = await checkKeys(deps([route()], { fetch }), [target()])
    expect(outcomes[0]).toMatchObject({ valid: false, error: 'the provider could not be reached (getaddrinfo ENOTFOUND)' })
  })

  it('never echoes a key back, whatever the verdict', async () => {
    for (const status of [200, 403]) {
      const { fetch } = gateway(status)
      const outcomes = await checkKeys(deps([route()], { fetch }), [target()])
      expect(JSON.stringify(outcomes)).not.toContain(KEY)
    }
  })

  it('answers one verdict per target, in the order asked', async () => {
    const { fetch } = gateway(200)
    const targets = [target({ id: 'a' }), target({ id: 'b' }), target({ id: 'c' })]
    const outcomes = await checkKeys(deps([route()], { fetch, concurrency: 3 }), targets)
    expect(outcomes.map(outcome => outcome.id)).toEqual(['a', 'b', 'c'])
    expect(outcomes.every(outcome => outcome.valid)).toBe(true)
  })

  it('probes at most one page of keys per call', async () => {
    const { fetch, seen } = gateway(200)
    const targets = Array.from({ length: MAX_KEYS_PER_CALL + 5 }, (_, index) => target({ id: `row-${index}` }))
    const outcomes = await checkKeys(deps([route()], { fetch }), targets)
    expect(outcomes).toHaveLength(MAX_KEYS_PER_CALL)
    expect(seen).toHaveLength(MAX_KEYS_PER_CALL)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { CHECK_ENDPOINT, createKeyCheckHandler, PROVIDERS_ENDPOINT, readCheckPayload } from '../src/route.ts'
import type { KeyCheckRoute } from '../src/providers.ts'

/** A key that is legal to put in a header. */
const KEY = 'nvapi-check-key-0001'

/** One route, wired to a base no test here reaches. */
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

/** A fetch stand-in answering the completion endpoint with one status. */
function gateway(status: number): typeof fetch {
  return vi.fn(async () => new Response('{}', { status })) as unknown as typeof fetch
}

describe('readCheckPayload', () => {
  it('reads one well-formed page of keys', () => {
    const parsed = readCheckPayload({ keys: [{ id: 'row-0', provider: 'nvidia', apiKey: KEY }] })
    expect(parsed).toEqual({ targets: [{ id: 'row-0', provider: 'nvidia', apiKey: KEY }] })
  })

  it('supplies an id a caller omitted, so ordered answers still line up', () => {
    const parsed = readCheckPayload({ keys: [{ provider: 'nvidia', apiKey: KEY }] })
    expect(parsed).toEqual({ targets: [{ id: 'key-0', provider: 'nvidia', apiKey: KEY }] })
  })

  it('trims the provider id but carries the key through untouched', () => {
    const parsed = readCheckPayload({ keys: [{ id: 'row-0', provider: '  nvidia  ', apiKey: ` ${KEY} ` }] })
    expect(parsed).toEqual({ targets: [{ id: 'row-0', provider: 'nvidia', apiKey: ` ${KEY} ` }] })
  })

  it('refuses anything that is not an object carrying a keys array', () => {
    for (const payload of [undefined, null, 'keys', [], {}]) {
      expect(readCheckPayload(payload)).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    }
  })

  it('refuses an empty page', () => {
    expect(readCheckPayload({ keys: [] })).toMatchObject({ ok: false })
  })

  it('refuses a row that is not an object, or that names no provider', () => {
    expect(readCheckPayload({ keys: ['nvidia'] })).toMatchObject({ ok: false })
    expect(readCheckPayload({ keys: [{ apiKey: KEY }] })).toMatchObject({ ok: false })
    expect(readCheckPayload({ keys: [{ provider: '   ', apiKey: KEY }] })).toMatchObject({ ok: false })
  })

  it('refuses a row whose key is not a string', () => {
    expect(readCheckPayload({ keys: [{ provider: 'nvidia', apiKey: 42 }] })).toMatchObject({ ok: false })
  })
})

describe('createKeyCheckHandler', () => {
  it('announces the directory, and nothing about where it points', async () => {
    const handler = createKeyCheckHandler(() => [route()])
    const result = await handler(PROVIDERS_ENDPOINT, {})
    expect(result).toEqual({ ok: true, value: { providers: [{ provider: 'nvidia', displayName: 'nvidia' }] } })
    expect(JSON.stringify(result)).not.toContain('https://')
  })

  it('answers one verdict per pasted key', async () => {
    const handler = createKeyCheckHandler(() => [route()], { fetch: gateway(200) })
    const result = await handler(CHECK_ENDPOINT, { keys: [{ id: 'row-0', provider: 'nvidia', apiKey: KEY }] })
    expect(result).toEqual({ ok: true, value: { outcomes: [{ id: 'row-0', provider: 'nvidia', valid: true, status: 200, via: 'completion' }] } })
    // A key that crossed the wire once never crosses it again.
    expect(JSON.stringify(result)).not.toContain(KEY)
  })

  it('reports a bad payload as a bad request rather than checking anything', async () => {
    const handler = createKeyCheckHandler(() => [route()], { fetch: gateway(200) })
    const result = await handler(CHECK_ENDPOINT, { keys: 'nvidia' })
    expect(result).toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })

  it('refuses an endpoint it does not serve', async () => {
    const handler = createKeyCheckHandler(() => [route()])
    expect(await handler('llmKeyCheck.anything', {})).toMatchObject({ ok: false })
  })

  it('reads the directory per call, so a settings edit reaches the next check', async () => {
    let directory: readonly KeyCheckRoute[] = [route()]
    const handler = createKeyCheckHandler(() => directory, { fetch: gateway(200) })
    const payload = { keys: [{ id: 'row-0', provider: 'nvidia', apiKey: KEY }] }
    expect(await handler(CHECK_ENDPOINT, payload)).toMatchObject({ ok: true })
    // The route disappears between calls, exactly as an edit would drop it.
    directory = []
    const result = await handler(CHECK_ENDPOINT, payload)
    expect(result).toMatchObject({ ok: true })
    expect((result as { value: { outcomes: Array<{ error?: string }> } }).value.outcomes[0]?.error)
      .toBe('this provider is not available here')
  })

  it('reports a directory that will not read as an internal failure, never as a verdict', async () => {
    // The directory is read per call, so a settings document that throws on
    // read surfaces here rather than being mistaken for an empty directory —
    // an empty directory would answer "not available here" for every key.
    const handler = createKeyCheckHandler(() => { throw new Error('settings unreadable') }, { fetch: gateway(200) })
    const result = await handler(CHECK_ENDPOINT, { keys: [{ id: 'row-0', provider: 'nvidia', apiKey: KEY }] })
    expect(result).toMatchObject({ ok: false, error: { code: 'internal', message: 'settings unreadable' } })
    expect(JSON.stringify(result)).not.toContain(KEY)
  })

  it('answers a transport failure as a verdict, not as a failure of the host', async () => {
    const fetch = vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND') }) as unknown as typeof fetch
    const handler = createKeyCheckHandler(() => [route()], { fetch })
    const result = await handler(CHECK_ENDPOINT, { keys: [{ id: 'row-0', provider: 'nvidia', apiKey: KEY }] })
    expect(result).toMatchObject({ ok: true })
    expect((result as { value: { outcomes: Array<{ error?: string }> } }).value.outcomes[0]?.error)
      .toBe('the provider could not be reached (getaddrinfo ENOTFOUND)')
  })
})

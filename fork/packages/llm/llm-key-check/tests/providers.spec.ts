import { describe, expect, it } from 'vitest'
import type { KeyCheckRoute, SettingsReader } from '../src/providers.ts'
import {
  completionBody,
  completionsUrlFor,
  keyCheckRoutes,
  providerDirectory,
  usesBearerAuth,
} from '../src/providers.ts'

/** A settings service over a plain document, one namespace at a time. */
function settings(document: Record<string, unknown>): SettingsReader {
  return { get: (ns: string) => document[ns] }
}

/** One catalog-shaped route, as a source would build it. */
function route(overrides: Partial<KeyCheckRoute> = {}): KeyCheckRoute {
  return {
    provider: 'nvidia',
    displayName: 'NVIDIA',
    api: 'openai-completions',
    modelsUrl: 'https://gw.example.test/v1/models',
    completionsUrl: 'https://gw.example.test/v1/chat/completions',
    probeModel: 'model-one',
    source: 'catalog',
    ...overrides,
  }
}

describe('usesBearerAuth', () => {
  it('sends a bearer token for the OpenAI-compatible protocols', () => {
    expect(usesBearerAuth('openai-completions')).toBe(true)
    expect(usesBearerAuth('openai-responses')).toBe(true)
  })

  it('withholds it for the Anthropic protocol, which keys on its own header', () => {
    expect(usesBearerAuth('anthropic-messages')).toBe(false)
  })
})

describe('completionsUrlFor', () => {
  it('appends the chat-completions path to a versioned base verbatim', () => {
    expect(completionsUrlFor('https://gw.example.test/v1', 'openai-completions'))
      .toBe('https://gw.example.test/v1/chat/completions')
  })

  it('uses the responses path for the responses protocol', () => {
    expect(completionsUrlFor('https://gw.example.test/v1', 'openai-responses'))
      .toBe('https://gw.example.test/v1/responses')
  })

  it('adds the version segment an Anthropic base was recorded without', () => {
    expect(completionsUrlFor('https://api.anthropic.test', 'anthropic-messages'))
      .toBe('https://api.anthropic.test/v1/messages')
  })

  it('does not double the version segment an Anthropic base already carries', () => {
    expect(completionsUrlFor('https://api.anthropic.test/v3', 'anthropic-messages'))
      .toBe('https://api.anthropic.test/v3/messages')
  })

  it('ignores trailing slashes on the base', () => {
    expect(completionsUrlFor('https://gw.example.test/v1///', 'openai-completions'))
      .toBe('https://gw.example.test/v1/chat/completions')
  })
})

describe('completionBody', () => {
  it('asks chat completions for one token against one word', () => {
    expect(JSON.parse(completionBody('openai-completions', 'model-one')))
      .toEqual({ model: 'model-one', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })
  })

  it('asks the responses endpoint in its own input shape', () => {
    expect(JSON.parse(completionBody('openai-responses', 'model-one')))
      .toEqual({ model: 'model-one', input: 'hi', max_output_tokens: 1 })
  })

  it('asks Anthropic in the messages shape it accepts', () => {
    expect(JSON.parse(completionBody('anthropic-messages', 'model-one')))
      .toEqual({ model: 'model-one', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })
  })
})

describe('keyCheckRoutes', () => {
  it('offers every key-taking route the installed catalog ships', () => {
    const routes = keyCheckRoutes()
    expect(routes.length).toBeGreaterThan(0)
    // The catalog is the directory's reason to exist: a route listed here is
    // one the user can paste a key for without declaring anything.
    expect(routes.every(candidate => candidate.source === 'catalog')).toBe(true)
    for (const candidate of routes) {
      expect(candidate.modelsUrl.endsWith('/models')).toBe(true)
      expect(candidate.completionsUrl).toBeTypeOf('string')
    }
  })

  it('names nvidia, the route the paste format is written against', () => {
    const nvidia = keyCheckRoutes().find(candidate => candidate.provider === 'nvidia')
    expect(nvidia).toBeDefined()
    expect(nvidia?.modelsUrl).toContain('integrate.api.nvidia.com')
    expect(nvidia?.probeModel).toBeTypeOf('string')
  })

  it('adds a pi-ai settings route and derives its endpoints from the declared base', () => {
    const routes = keyCheckRoutes(settings({
      'llm-pi-ai': { providers: { 'my-gateway': { baseURL: 'https://gw.example.test/v1', displayName: 'My Gateway' } } },
    }))
    const declared = routes.find(candidate => candidate.provider === 'my-gateway')
    expect(declared).toMatchObject({
      provider: 'my-gateway',
      displayName: 'My Gateway',
      api: 'openai-completions',
      modelsUrl: 'https://gw.example.test/v1/models',
      completionsUrl: 'https://gw.example.test/v1/chat/completions',
      source: 'settings',
    })
    // A hand-declared gateway names no model, so its probe is the listing.
    expect(declared?.probeModel).toBeUndefined()
  })

  it('honours the protocol a pi-ai settings route declares', () => {
    const routes = keyCheckRoutes(settings({
      'llm-pi-ai': { providers: { 'my-gateway': { baseURL: 'https://gw.example.test/v1', api: 'anthropic-messages' } } },
    }))
    expect(routes.find(candidate => candidate.provider === 'my-gateway')?.completionsUrl)
      .toBe('https://gw.example.test/v1/messages')
  })

  it('takes a Bearer settings route listing endpoint verbatim', () => {
    const routes = keyCheckRoutes(settings({
      'llm-bearer': { providers: { 'my-bearer': { modelsURL: 'https://gw.example.test/v1/models' } } },
    }))
    expect(routes.find(candidate => candidate.provider === 'my-bearer')).toMatchObject({
      modelsUrl: 'https://gw.example.test/v1/models',
      completionsUrl: 'https://gw.example.test/v1/chat/completions',
      source: 'settings',
    })
  })

  it('keeps one entry when a settings route overrides a catalog route', () => {
    const routes = keyCheckRoutes(settings({
      'llm-pi-ai': { providers: { nvidia: { baseURL: 'https://gw.example.test/v1' } } },
    }))
    const nvidia = routes.filter(candidate => candidate.provider === 'nvidia')
    expect(nvidia).toHaveLength(1)
    // The override wins: the address the adapter itself would call.
    expect(nvidia[0]?.modelsUrl).toBe('https://gw.example.test/v1/models')
    expect(nvidia[0]?.source).toBe('settings')
  })

  it('skips profiles that name no endpoint, and unreadable documents', () => {
    const routes = keyCheckRoutes(settings({
      'llm-pi-ai': { providers: { blank: { baseURL: '   ' }, wrong: { baseURL: 42 }, empty: null } },
      'llm-bearer': 'not an object',
    }))
    expect(routes.some(candidate => candidate.provider === 'blank')).toBe(false)
    expect(routes.some(candidate => candidate.provider === 'wrong')).toBe(false)
    expect(routes.some(candidate => candidate.provider === 'empty')).toBe(false)
  })

  it('reads nothing when no settings service is mounted', () => {
    expect(keyCheckRoutes(undefined).every(candidate => candidate.source === 'catalog')).toBe(true)
  })
})

describe('providerDirectory', () => {
  it('announces identity only, never an address', () => {
    const directory = providerDirectory([route()])
    expect(directory).toEqual([{ provider: 'nvidia', displayName: 'NVIDIA' }])
    expect(JSON.stringify(directory)).not.toContain('https://')
  })
})

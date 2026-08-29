import { describe, expect, it, vi } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { BearerTokenResolver } from '../src/bearer.ts'
import { discoverBearerModels } from '../src/discovery.ts'
import type { BearerCredentialStore } from '../src/bearer.ts'
import type { ResolvedBearerAuth } from '../src/config.ts'

const ACCESS = credentialRef('EXAMPLE_BEARER_TOKEN')
const REFRESH = credentialRef('EXAMPLE_REFRESH_TOKEN')
const REFRESH_ENDPOINT = 'https://auth.example/token'

function jwt(exp: number, issuer?: string): string {
  return `header.${Buffer.from(JSON.stringify({ exp, ...issuer === undefined ? {} : { iss: issuer } })).toString('base64url')}.signature`
}

function auth(refresh = true): ResolvedBearerAuth {
  return {
    type: 'bearer',
    accessTokenEnv: ACCESS,
    ...refresh ? {
      refresh: {
        type: 'firebase',
        endpoint: REFRESH_ENDPOINT,
        refreshTokenEnv: REFRESH,
        apiKey: 'public-refresh-key',
      },
    } : {},
  }
}

function memoryStore(values: Map<string, string>): BearerCredentialStore {
  return {
    resolve: ref => Promise.resolve(values.get(ref)),
    set: async (ref, value) => { values.set(ref, value) },
  }
}

describe('BearerTokenResolver', () => {
  it('reuses an unexpired static token', async () => {
    const values = new Map<string, string>([[ACCESS, jwt(200)]])
    const resolver = new BearerTokenResolver(memoryStore(values), vi.fn(), () => 100_000)
    await expect(resolver.resolve('example', auth(false))).resolves.toBe(values.get(ACCESS))
  })

  it('deduplicates refresh, prefers Firebase id_token, and survives a new resolver', async () => {
    const values = new Map<string, string>([[ACCESS, jwt(100)], [REFRESH, 'refresh-old']])
    const nextIdToken = jwt(500)
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      id_token: nextIdToken,
      access_token: 'oauth-access-token-is-not-the-id-token',
      refresh_token: 'refresh-new',
    }))) as typeof fetch
    const resolver = new BearerTokenResolver(memoryStore(values), fetcher, () => 100_000)

    await expect(Promise.all([
      resolver.resolve('example', auth()),
      resolver.resolve('example', auth()),
    ])).resolves.toEqual([nextIdToken, nextIdToken])
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledWith(
      `${REFRESH_ENDPOINT}?key=public-refresh-key`,
      expect.objectContaining({ method: 'POST' }),
    )
    expect(values.get(ACCESS)).toBe(nextIdToken)
    expect(values.get(REFRESH)).toBe('refresh-new')

    const afterRestartFetch = vi.fn()
    const afterRestart = new BearerTokenResolver(memoryStore(values), afterRestartFetch, () => 100_000)
    await expect(afterRestart.resolve('example', auth())).resolves.toBe(nextIdToken)
    expect(afterRestartFetch).not.toHaveBeenCalled()
  })

  it('immediately exchanges a Firebase session cookie even when its expiry is far away', async () => {
    const sessionCookie = jwt(10_000, 'https://session.firebase.google.com/example-project')
    const idToken = jwt(500, 'https://securetoken.google.com/example-project')
    const values = new Map<string, string>([[ACCESS, sessionCookie], [REFRESH, 'refresh-old']])
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id_token: idToken }))) as typeof fetch
    const resolver = new BearerTokenResolver(memoryStore(values), fetcher, () => 100_000)

    await expect(resolver.resolve('example', auth())).resolves.toBe(idToken)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(values.get(ACCESS)).toBe(idToken)
  })

  it('refuses a Firebase session cookie when no refresh credential is configured', async () => {
    const values = new Map<string, string>([[
      ACCESS,
      jwt(10_000, 'https://session.firebase.google.com/example-project'),
    ]])
    const resolver = new BearerTokenResolver(memoryStore(values), vi.fn(), () => 100_000)
    await expect(resolver.resolve('example', auth(false))).rejects.toMatchObject({
      code: 'OAUTH_REAUTHENTICATE',
    })
  })

  it('requires sign-in when Firebase rejects or lacks the refresh token', async () => {
    const rejected = new BearerTokenResolver(
      memoryStore(new Map([[ACCESS, jwt(100)], [REFRESH, 'dead-refresh']])),
      vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })),
      () => 100_000,
    )
    await expect(rejected.resolve('example', auth())).rejects.toMatchObject({ code: 'OAUTH_REAUTHENTICATE' })

    const missing = new BearerTokenResolver(
      memoryStore(new Map([[ACCESS, jwt(100)]])),
      vi.fn(),
      () => 100_000,
    )
    await expect(missing.resolve('example', auth())).rejects.toMatchObject({ code: 'OAUTH_REAUTHENTICATE' })
  })

  it('persists a rotated refresh value before the access value', async () => {
    const values = new Map<string, string>([[ACCESS, jwt(100)], [REFRESH, 'refresh-old']])
    const writes: string[] = []
    const store: BearerCredentialStore = {
      resolve: ref => Promise.resolve(values.get(ref)),
      set: async (ref, value) => { writes.push(ref); values.set(ref, value) },
    }
    const resolver = new BearerTokenResolver(
      store,
      vi.fn(async () => new Response(JSON.stringify({ id_token: jwt(500), refresh_token: 'refresh-new' }))),
      () => 100_000,
    )
    await resolver.resolve('example', auth())
    expect(writes).toEqual([REFRESH, ACCESS])
  })
})

describe('Bearer model discovery compatibility', () => {
  it('accepts the exact models endpoint through the upstream baseURL wire field', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      providers: [{ models: [{ name: 'model-a', display_name: 'Model A' }] }],
    })))
    vi.stubGlobal('fetch', fetcher)
    try {
      await expect(discoverBearerModels({
        baseURL: 'https://models.example/list',
        api: 'bearer-chat',
        apiKey: 'synthetic-token',
      })).resolves.toEqual([{
        id: 'model-a',
        name: 'Model A',
        inputModalities: ['text'],
        catalogMatched: false,
      }])
      expect(fetcher).toHaveBeenCalledWith(
        'https://models.example/list',
        expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer synthetic-token' }) }),
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

import { describe, expect, it, vi } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { BearerTokenResolver } from '../src/bearer.ts'
import type { BearerCredentialStore } from '../src/bearer.ts'
import type { ResolvedBearerAuth } from '../src/config.ts'

const ACCESS = credentialRef('TWINMIND_BEARER_TOKEN')
const REFRESH = credentialRef('TWINMIND_REFRESH_TOKEN')

function jwt(exp: number): string {
  return `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`
}

function auth(refresh = true): ResolvedBearerAuth {
  return {
    type: 'bearer',
    accessTokenEnv: ACCESS,
    ...refresh ? { refresh: { type: 'firebase', refreshTokenEnv: REFRESH, apiKey: 'public-firebase-key' } } : {},
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
    await expect(resolver.resolve('twinmind', auth(false))).resolves.toBe(values.get(ACCESS))
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
      resolver.resolve('twinmind', auth()),
      resolver.resolve('twinmind', auth()),
    ])).resolves.toEqual([nextIdToken, nextIdToken])
    expect(fetcher).toHaveBeenCalledOnce()
    expect(values.get(ACCESS)).toBe(nextIdToken)
    expect(values.get(REFRESH)).toBe('refresh-new')

    const afterRestartFetch = vi.fn()
    const afterRestart = new BearerTokenResolver(memoryStore(values), afterRestartFetch, () => 100_000)
    await expect(afterRestart.resolve('twinmind', auth())).resolves.toBe(nextIdToken)
    expect(afterRestartFetch).not.toHaveBeenCalled()
  })

  it('requires sign-in when Firebase rejects or lacks the refresh token', async () => {
    const rejected = new BearerTokenResolver(
      memoryStore(new Map([[ACCESS, jwt(100)], [REFRESH, 'dead-refresh']])),
      vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })),
      () => 100_000,
    )
    await expect(rejected.resolve('twinmind', auth())).rejects.toMatchObject({ code: 'OAUTH_REAUTHENTICATE' })

    const missing = new BearerTokenResolver(
      memoryStore(new Map([[ACCESS, jwt(100)]])),
      vi.fn(),
      () => 100_000,
    )
    await expect(missing.resolve('twinmind', auth())).rejects.toMatchObject({ code: 'OAUTH_REAUTHENTICATE' })
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
    await resolver.resolve('twinmind', auth())
    expect(writes).toEqual([REFRESH, ACCESS])
  })
})

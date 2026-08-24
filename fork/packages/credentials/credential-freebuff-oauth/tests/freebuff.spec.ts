import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { getFingerprintId } from '../src/fingerprint.ts'
import { FreebuffOAuthProvider, FreebuffOAuthService } from '../src/index.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('FreebuffOAuthProvider', () => {
  it('uses a stable official-format process fingerprint by default', async () => {
    const first = await getFingerprintId()
    const second = await getFingerprintId()

    expect(second).toBe(first)
    expect(first).toMatch(/^(enhanced-[A-Za-z0-9_-]{43}|codebuff-cli-[A-Za-z0-9_-]{8})$/u)
    expect(first).not.toBe('deepseek-harness')
  }, 15_000)

  it('requests a device challenge and polls pending status until approval', async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = []
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? 'GET',
        ...init?.body === undefined ? {} : { body: String(init.body) },
      })
      return requests.length === 1
        ? response({ loginUrl: 'https://freebuff.com/login/device', fingerprintHash: 'hash', expiresAt: 1893456000000 })
        : requests.length === 2
          ? response({ user: null }, 401)
          : response({ user: { id: 'user-1', name: 'Freebuff User', authToken: 'token-secret' } })
    })
    const provider = new FreebuffOAuthProvider({ baseURL: 'https://freebuff.test', requestTimeoutMs: 1_000, fetch })
    const challenge = await provider.beginLogin('client-1')
    const result = await provider.pollLogin(challenge, { pollIntervalMs: 1, sleep: async () => {} })

    expect(challenge).toEqual({
      fingerprintId: 'client-1',
      loginUrl: 'https://freebuff.com/login/device',
      fingerprintHash: 'hash',
      expiresAt: '1893456000000',
    })
    expect(result).toMatchObject({ accountId: 'user-1', displayName: 'Freebuff User', accessToken: 'token-secret' })
    expect(requests[0]).toMatchObject({ method: 'POST', body: JSON.stringify({ fingerprintId: 'client-1' }) })
    expect(requests[1]?.url).toContain('/api/auth/cli/status?')
    expect(requests[1]?.url).toContain('fingerprintHash=hash')
    expect(JSON.stringify(challenge)).not.toContain('token-secret')
  })

  it('times out device polling with the number of attempts and never returns a token', async () => {
    let now = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      now += 6
      return response({ user: null }, 401)
    })
    const provider = new FreebuffOAuthProvider({ baseURL: 'https://freebuff.test', requestTimeoutMs: 1_000, fetch })

    await expect(provider.pollLogin({
      fingerprintId: 'client-1',
      loginUrl: 'https://freebuff.test/login',
      fingerprintHash: 'hash',
      expiresAt: '1893456000000',
    }, { timeoutMs: 10, pollIntervalMs: 1, sleep: async () => { now += 5 } })).rejects.toThrow('timed out')
    expect(fetch).toHaveBeenCalled()
  })

  it('clears a rejected stored token and its redacted account snapshot', async () => {
    const values = new Map([[credentialRef('FREEBUFF_AUTH_TOKEN'), 'stale-token']])
    const credentials = {
      resolve: async (ref: ReturnType<typeof credentialRef>) => {
        const value = values.get(ref)
        return value === undefined ? undefined : { value, source: 'test' }
      },
      set: async (ref: ReturnType<typeof credentialRef>, value: string) => { values.set(ref, value) },
      unset: async (ref: ReturnType<typeof credentialRef>) => { values.delete(ref) },
    }
    const ctx = new Context()
    ctx.provide('credentials', credentials as never)
    const service = new FreebuffOAuthService(ctx, { baseURL: 'https://freebuff.test' })

    await expect(service.status()).resolves.toMatchObject({ accounts: [{ accountId: 'default', status: 'active' }] })
    await service.invalidate()

    expect(values.has(credentialRef('FREEBUFF_AUTH_TOKEN'))).toBe(false)
    expect(service.snapshot()).toEqual([])
    await expect(service.status()).resolves.toEqual({ accounts: [] })
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { IApiClient } from '@deepseek-ai/dsh-fork-host-apiproxy/client'
import { FreebuffOAuthController } from '../src/client/controller.ts'

function ok<T>(value: T) {
  return { rpcId: 'test', result: { ok: true as const, value } }
}

function freebuff(overrides: Partial<IApiClient['freebuff']> = {}): IApiClient['freebuff'] {
  return {
    status: vi.fn(async () => ok({ accounts: [] })),
    beginLogin: vi.fn(async () => ok({ loginUrl: 'https://freebuff.com/login/device', expiresAt: '2030-01-01T00:00:00Z' })),
    completeLogin: vi.fn(async () => ok({ account: { accountId: 'account-1', status: 'active' as const } })),
    logout: vi.fn(async () => ok({})),
    openDesktop: vi.fn(async () => ok({ opened: true as const })),
    ...overrides,
  }
}

describe('FreebuffOAuthController', () => {
  it('projects a connected account without exposing credential values', async () => {
    const client = freebuff({
      status: vi.fn(async () => ok({
        accounts: [{ accountId: 'account-1', displayName: 'Freebuff User', status: 'active' as const }],
      })),
    })
    const controller = new FreebuffOAuthController(client)
    const face = controller.inject()

    await vi.waitFor(() => {
      expect(face.hooks.oauth.getSnapshot()).toEqual({
        status: 'connected',
        account: { accountId: 'account-1', displayName: 'Freebuff User', status: 'active' },
      })
    })
    expect(JSON.stringify(face.hooks.oauth.getSnapshot())).not.toContain('token')
  })

  it('keeps the login URL while the Host waits, then projects the account', async () => {
    let resolve!: (value: ReturnType<typeof ok<{ account: { accountId: string; status: 'active' } }>>) => void
    const client = freebuff({
      beginLogin: vi.fn(async () => ok({ loginUrl: 'https://freebuff.com/login/device', expiresAt: '2030-01-01T00:00:00Z' })),
      completeLogin: vi.fn(() => new Promise<ReturnType<typeof ok<{ account: { accountId: string; status: 'active' } }>>>(done => { resolve = done })),
    })
    const controller = new FreebuffOAuthController(client)
    const face = controller.inject()
    await vi.waitFor(() => { expect(face.hooks.oauth.getSnapshot().status).toBe('signed-out') })

    face.beginLogin()
    await vi.waitFor(() => {
      expect(face.hooks.oauth.getSnapshot()).toMatchObject({
        status: 'pending',
        loginUrl: 'https://freebuff.com/login/device',
      })
    })

    face.completeLogin()
    await vi.waitFor(() => { expect(face.hooks.oauth.getSnapshot().status).toBe('waiting') })
    resolve(ok({ account: { accountId: 'account-1', status: 'active' } }))
    await vi.waitFor(() => {
      expect(face.hooks.oauth.getSnapshot()).toEqual({
        status: 'connected',
        account: { accountId: 'account-1', status: 'active' },
      })
    })
  })

  it('clears the account after logout', async () => {
    const client = freebuff({
      status: vi.fn(async () => ok({ accounts: [{ accountId: 'account-1', status: 'active' as const }] })),
    })
    const controller = new FreebuffOAuthController(client)
    const face = controller.inject()
    await vi.waitFor(() => { expect(face.hooks.oauth.getSnapshot().status).toBe('connected') })

    face.logout()
    await vi.waitFor(() => { expect(face.hooks.oauth.getSnapshot()).toEqual({ status: 'signed-out' }) })
  })

  it('opens the configured desktop through the Host', async () => {
    const api = freebuff()
    const controller = new FreebuffOAuthController(api)
    const face = controller.inject()

    face.openDesktop()
    await vi.waitFor(() => { expect(api.openDesktop).toHaveBeenCalledWith({}) })
    expect(face.hooks.oauth.getSnapshot().desktopStatus).toBe('idle')
  })
})

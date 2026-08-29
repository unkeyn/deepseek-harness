import { describe, expect, it } from 'vitest'
import { ClaudeCodeOAuthProvider, FakeOAuthProvider, OAuthLifecycle, OAuthReauthenticationRequired, OAuthRefreshScheduler, RemoteOAuthCredentialStore, filterOAuthAccounts } from '../src/index.ts'
import type { OAuthCredentialStore } from '../src/types.ts'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { credentialId } from '@deepseek-ai/dsh-fork-credential-broker'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { RemoteOAuthCredentialSnapshot } from '../src/index.ts'

function store(): OAuthCredentialStore & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    async resolve(ref: CredentialRef) { return values.get(ref) },
    async set(ref: CredentialRef, value: string) { values.set(ref, value) },
    async unset(ref: CredentialRef) { values.delete(ref) },
  }
}

const login = { accountId: 'account-1', displayName: 'Test', accessToken: 'access-secret', refreshToken: 'refresh-secret', expiresAt: 100 }

describe('OAuthLifecycle', () => {
  it('accepts provider-owned stable references for restart restoration', async () => {
    const provider = new FakeOAuthProvider()
    provider.setLoginResult(login)
    const credentials = store()
    const lifecycle = new OAuthLifecycle(provider, credentials, 'TEST_OAUTH', () => ({
      accessRef: credentialRef('OAUTH_ACCESS_TOKEN'),
    }))
    const snapshot = await lifecycle.login('callback')
    expect(snapshot.accessRef).toBe('OAUTH_ACCESS_TOKEN')
    expect(credentials.values.get('OAUTH_ACCESS_TOKEN')).toBe('access-secret')

    const restored = new OAuthLifecycle(provider, credentials, 'TEST_OAUTH', () => ({
      accessRef: credentialRef('OAUTH_ACCESS_TOKEN'),
    }))
    await expect(restored.restore({
      accountId: 'account-1',
      accessToken: 'access-secret',
      expiresAt: Number.MAX_SAFE_INTEGER,
    })).resolves.toMatchObject({ accessRef: 'OAUTH_ACCESS_TOKEN', status: 'active' })
  })

  it('stores tokens by references and redacts values from snapshots', async () => {
    const provider = new FakeOAuthProvider()
    provider.setLoginResult(login)
    const credentials = store()
    const lifecycle = new OAuthLifecycle(provider, credentials, 'TEST_OAUTH')
    const snapshot = await lifecycle.login('callback')
    expect(snapshot.accessRef).toBe('TEST_OAUTH_account_1_access')
    expect(snapshot.refreshRef).toBe('TEST_OAUTH_account_1_refresh')
    expect(JSON.stringify(lifecycle.snapshot())).not.toContain('secret')
    expect(credentials.values.get(snapshot.accessRef)).toBe('access-secret')
  })

  it('deduplicates concurrent refreshes for one expired account', async () => {
    const provider = new FakeOAuthProvider()
    provider.setLoginResult(login)
    provider.setRefreshResult({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: 500 })
    const credentials = store()
    const lifecycle = new OAuthLifecycle(provider, credentials, 'TEST_OAUTH')
    await lifecycle.login('callback')
    const results = await Promise.all([lifecycle.accessToken('account-1', 100), lifecycle.accessToken('account-1', 100)])
    expect(results).toEqual(['new-access', 'new-access'])
    expect(provider.refreshCalls).toHaveLength(1)
  })

  it('moves a dead refresh token to reauthenticate', async () => {
    const provider = new FakeOAuthProvider()
    provider.setLoginResult(login)
    provider.setRefreshError(new Error('invalid_grant'))
    const lifecycle = new OAuthLifecycle(provider, store(), 'TEST_OAUTH')
    await lifecycle.login('callback')
    await expect(lifecycle.accessToken('account-1', 100)).rejects.toBeInstanceOf(OAuthReauthenticationRequired)
    expect(lifecycle.snapshot()[0]?.status).toBe('reauthenticate')
    await expect(lifecycle.accessToken('account-1', 100)).rejects.toBeInstanceOf(OAuthReauthenticationRequired)
    expect(provider.refreshCalls).toHaveLength(1)
  })

  it('sweeps near-expiry accounts and filters redacted snapshots by provider pool', async () => {
    const provider = new FakeOAuthProvider()
    provider.setLoginResult({ ...login, expiresAt: 100 })
    provider.setRefreshResult({ accessToken: 'sweep-access', expiresAt: 500 })
    const lifecycle = new OAuthLifecycle(provider, store(), 'TEST_OAUTH')
    await lifecycle.login('callback')
    const scheduler = new OAuthRefreshScheduler(lifecycle, { skewMs: 25, intervalMs: 1000, now: () => 100 })
    await scheduler.tick()
    expect(provider.refreshCalls).toHaveLength(1)
    expect(filterOAuthAccounts(lifecycle.snapshot(), 'test', new Map([['test', new Set(['missing'])]])).length).toBe(0)
    expect(lifecycle.snapshot()[0]?.generation).toBe(1)
  })

  it('does not let a stale definitive failure disable a newer login generation', async () => {
    let rejectRefresh: ((error: Error) => void) | undefined
    const provider = {
      async completeLogin(): Promise<typeof login> { return { ...login } },
      async refresh(): Promise<{ accessToken: string; expiresAt: number }> {
        return new Promise((_, reject) => { rejectRefresh = reject })
      },
    }
    const lifecycle = new OAuthLifecycle(provider, store(), 'TEST_OAUTH')
    await lifecycle.login('callback')
    const pending = lifecycle.accessToken('account-1', 100)
    const replacement = { ...login, accessToken: 'replacement', refreshToken: 'replacement-refresh', expiresAt: 500 }
    provider.completeLogin = async () => replacement
    await lifecycle.login('callback')
    rejectRefresh!(new Error('invalid_grant'))
    await expect(pending).resolves.toBe('replacement')
    expect(lifecycle.snapshot()[0]).toMatchObject({ generation: 2, status: 'active' })
  })

  it('hands the lifecycle access token to provider authorization and requests', async () => {
    const provider = new FakeOAuthProvider()
    provider.setLoginResult({ ...login, expiresAt: Date.now() + 10_000 })
    provider.setRequestResult({ status: 200, body: 'ok' })
    const lifecycle = new OAuthLifecycle(provider, store(), 'TEST_OAUTH')
    await lifecycle.login('callback')
    const adapter = lifecycle.adapter(provider)
    await expect(adapter.authorization('account-1', { path: '/v1/models' })).resolves.toEqual({ path: '/v1/models', authorization: 'Bearer access-secret' })
    await expect(adapter.request('account-1', { path: '/v1/models' })).resolves.toEqual({ status: 200, body: 'ok' })
    expect(provider.requests).toEqual([{ accessToken: 'access-secret', request: { path: '/v1/models' } }])
    expect(JSON.stringify(lifecycle.snapshot())).not.toContain('access-secret')
  })

  it('propagates reauthentication through provider requests', async () => {
    const provider = new FakeOAuthProvider()
    provider.setLoginResult(login)
    provider.setRefreshError(new Error('invalid_grant'))
    const lifecycle = new OAuthLifecycle(provider, store(), 'TEST_OAUTH')
    await lifecycle.login('callback')
    const adapter = lifecycle.adapter(provider)
    await expect(adapter.request('account-1', { path: '/v1/models' })).rejects.toMatchObject({ code: 'OAUTH_REAUTHENTICATE', accountId: 'account-1' })
    expect(provider.requests).toEqual([])
    expect(lifecycle.snapshot()[0]?.status).toBe('reauthenticate')
  })

  it('cleans local references and reports provider revocation', async () => {
    const provider = new FakeOAuthProvider()
    provider.setLoginResult(login)
    const credentials = store()
    const lifecycle = new OAuthLifecycle(provider, credentials, 'TEST_OAUTH')
    const account = await lifecycle.login('callback')
    await expect(lifecycle.logout(account.accountId)).resolves.toEqual({ accountId: 'account-1', localCleanup: 'completed', providerRevocation: 'completed' })
    expect(credentials.values.size).toBe(0)
    expect(provider.revocations).toEqual([{ accessToken: 'access-secret', refreshToken: 'refresh-secret' }])
    expect(lifecycle.snapshot()).toEqual([])
  })


  it('supports Claude Code browser callback login through an injected transport', async () => {
    const provider = new ClaudeCodeOAuthProvider({
      completeBrowserLogin: async callback => ({ ...login, accountId: callback }),
      completeSetupToken: async () => login,
      refresh: async () => ({ accessToken: 'refreshed-access', expiresAt: 500 }),
      authorization: (accessToken: string) => ({ authorization: `Bearer ${accessToken}` }),
      request: async () => ({ ok: true }),
    })
    const lifecycle = new OAuthLifecycle(provider, store(), 'CLAUDE_OAUTH')
    await expect(lifecycle.login('browser-account')).resolves.toMatchObject({ accountId: 'browser-account' })
  })

  it('supports Claude Code setup-token input without exposing the token in snapshots', async () => {
    const setupToken = 'claude-setup-secret'
    const provider = new ClaudeCodeOAuthProvider({
      completeBrowserLogin: async () => login,
      completeSetupToken: async token => ({ accountId: 'setup-account', accessToken: token, expiresAt: Date.now() + 10_000 }),
    })
    const lifecycle = new OAuthLifecycle(provider, store(), 'CLAUDE_OAUTH')
    const snapshot = await lifecycle.loginSetupToken(setupToken)
    expect(snapshot.refreshRef).toBeUndefined()
    expect(JSON.stringify(lifecycle.snapshot())).not.toContain(setupToken)
  })

  it('uses Claude Code injected refresh transport', async () => {
    const provider = new ClaudeCodeOAuthProvider({
      completeBrowserLogin: async () => login,
      completeSetupToken: async () => login,
      refresh: async refreshToken => ({ accessToken: `refreshed-${refreshToken}`, expiresAt: 500 }),
    })
    const lifecycle = new OAuthLifecycle(provider, store(), 'CLAUDE_OAUTH')
    await lifecycle.login('callback')
    await expect(lifecycle.accessToken('account-1', 100)).resolves.toBe('refreshed-refresh-secret')
  })

  it('reports unsupported Claude Code revocation explicitly after local cleanup', async () => {
    const provider = new ClaudeCodeOAuthProvider({
      completeBrowserLogin: async () => login,
      completeSetupToken: async () => login,
    })
    const credentials = store()
    const lifecycle = new OAuthLifecycle(provider, credentials, 'CLAUDE_OAUTH')
    await lifecycle.login('callback')
    await expect(lifecycle.logout('account-1')).resolves.toMatchObject({
      localCleanup: 'completed',
      providerRevocation: 'failed',
      providerRevocationError: 'Claude Code OAuth does not support revoke',
    })
    expect(credentials.values.size).toBe(0)
    await expect(provider.revoke({ accessToken: 'secret' })).rejects.toMatchObject({ code: 'OAUTH_UNSUPPORTED_OPERATION' })
  })

  it('projects generation-aware broker metadata without token values', async () => {
    let current: RemoteOAuthCredentialSnapshot = {
      generation: 2,
      credentials: [
        { id: credentialId('oauth-account'), provider: 'test', reference: credentialRef('oauth_ref'), authKind: 'oauth', accountId: 'account-1' },
        { id: credentialId('api-key'), provider: 'test', reference: credentialRef('api_ref'), authKind: 'api-key' },
      ],
    }
    const store = new RemoteOAuthCredentialStore({ getSnapshot: () => current }, 'test', new Map([['test', new Set(['other-account'])]]))
    expect(store.snapshot().credentials).toEqual([current.credentials[1]])
    current = {
      generation: 3,
      credentials: [{ ...current.credentials[0]!, accountId: 'other-account', reference: credentialRef('new_oauth_ref') }, current.credentials[1]!],
    }
    expect(store.snapshot()).toEqual(current)
    expect(JSON.stringify(store.snapshot())).not.toContain('token')
    expect(store.replaceSnapshot({ generation: 2, credentials: [] })).toBe(false)
    expect(store.snapshot()).toEqual(current)
    const detached = store.snapshot()
    ;(detached.credentials as Array<typeof detached.credentials[number]>).pop()
    expect(store.snapshot().credentials).toHaveLength(2)
    await expect(store.set(credentialRef('oauth_ref'), 'token')).rejects.toMatchObject({ code: 'OAUTH_REMOTE_STORE_READ_ONLY' })
    await expect(store.unset(credentialRef('oauth_ref'))).rejects.toMatchObject({ code: 'OAUTH_REMOTE_STORE_READ_ONLY' })
    await expect(store.resolve(credentialRef('oauth_ref'))).resolves.toBeUndefined()
  })

  it('applies broker snapshot events and disposes the subscription', () => {
    let listener: ((event: import('@deepseek-ai/dsh-fork-credential-broker').CredentialBrokerSnapshotEvent) => void) | undefined
    let disposed = false
    const source = {
      getSnapshot: () => ({ generation: 1, credentials: [] }),
      subscribe: (next: typeof listener) => { listener = next; return { dispose: () => { disposed = true } } },
    }
    const store = new RemoteOAuthCredentialStore(source, 'test')
    listener?.({ kind: 'entry', generation: 2, entry: { id: credentialId('oauth'), pool: 'main' as never, provider: 'test', reference: credentialRef('oauth_ref'), authKind: 'oauth', accountId: 'account-1' } })
    expect(store.snapshot().credentials).toHaveLength(1)
    expect(store.applyEvent({ kind: 'removed', generation: 1, id: credentialId('oauth') })).toBe(false)
    store.dispose()
    expect(disposed).toBe(true)
  })

  it('moves Claude Code accounts to reauthenticate after injected refresh rejection', async () => {
    const provider = new ClaudeCodeOAuthProvider({
      completeBrowserLogin: async () => login,
      completeSetupToken: async () => login,
      refresh: async () => { throw new Error('invalid_grant') },
    })
    const lifecycle = new OAuthLifecycle(provider, store(), 'CLAUDE_OAUTH')
    await lifecycle.login('callback')
    await expect(lifecycle.accessToken('account-1', 100)).rejects.toMatchObject({ code: 'OAUTH_REAUTHENTICATE' })
    expect(lifecycle.snapshot()[0]?.status).toBe('reauthenticate')
  })
})

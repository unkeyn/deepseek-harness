import { afterEach, describe, expect, it } from 'vitest'
import type { AnonymousUserId } from '@deepseek-ai/dsh-anonymous-user-id'
import { FakeOAuthProvider, OAuthLifecycle } from '@deepseek-ai/dsh-credential-oauth'
import { createDeepSeekOAuthAdapter, resolveAdapterOptions } from '@deepseek-ai/dsh-llm-deepseek'
import type { OAuthCredentialStore } from '@deepseek-ai/dsh-credential-oauth'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

afterEach(async () => {
  await closeMockServers()
})

function store(): OAuthCredentialStore {
  const values = new Map<string, string>()
  return {
    async resolve(ref: CredentialRef) { return values.get(ref) },
    async set(ref: CredentialRef, value: string) { values.set(ref, value) },
    async unset(ref: CredentialRef) { values.delete(ref) },
  }
}

describe('DeepSeek OAuth route adapter', () => {
  it('composes lifecycle authorization with the real DeepSeek provider stream', async () => {
    const server = await mockServer([{ kind: 'sse', events: textEvents }])
    const provider = new FakeOAuthProvider()
    provider.setLoginResult({
      accountId: 'deepseek-account',
      accessToken: 'oauth-access',
      refreshToken: 'oauth-refresh',
      expiresAt: Date.now() + 60_000,
    })
    const lifecycle = new OAuthLifecycle(provider, store(), 'DEEPSEEK_OAUTH')
    await lifecycle.login('provider-callback')

    const adapter = createDeepSeekOAuthAdapter({
      lifecycle,
      accountId: 'deepseek-account',
      provider,
      options: () => resolveAdapterOptions({ baseURL: server.url }),
      resolveUserId: () => '00000000-0000-4000-8000-000000000001' as AnonymousUserId,
    })
    const assembler = new BlockAssembler()
    for await (const chunk of adapter.stream({ provider: 'deepseek-official', model: 'deepseek-v4-flash', messages: [] })) {
      assembler.push(chunk)
    }

    expect(assembler.finish).toEqual({ kind: 'stop' })
    expect(server.headers[0]?.authorization).toBe('Bearer oauth-access')
    expect(JSON.stringify(lifecycle.snapshot())).not.toContain('oauth-access')
  })
})

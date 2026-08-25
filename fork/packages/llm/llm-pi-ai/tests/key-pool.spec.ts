/**
 * The key-pool composition over a pi-ai route: equal-priority keys rotate
 * across requests, and a rate-limited key cools down inside the same stream
 * call while the bounded failover budget completes the request on the next
 * one. The broker and pool plugins compose alongside the adapter exactly as a
 * deployment would mount them.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-fork-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-fork-llm-pi-ai'
import type { CredentialInfo, CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import * as KeyPool from '@deepseek-ai/dsh-fork-key-pool'
import { assemble } from './assemble.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

const KEY_ONE = 'key-one-value'
const KEY_TWO = 'key-two-value'

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeMockServers()
})

async function mount(baseURL: string): Promise<Context> {
  vi.stubEnv('PI_POOL_KEY', KEY_ONE)
  vi.stubEnv('PI_POOL_KEY_2', KEY_TWO)
  const values = new Map<CredentialRef, ResolvedCredential>([
    [credentialRef('PI_POOL_KEY'), { value: KEY_ONE, source: 'test' }],
    [credentialRef('PI_POOL_KEY_2'), { value: KEY_TWO, source: 'test' }],
  ])
  const ctx = new Context()
  ctx.provide('credentials', {
    resolve: (ref: CredentialRef) => Promise.resolve(values.get(ref)),
    describe: (ref: CredentialRef) => Promise.resolve({ configured: values.has(ref), writable: true } satisfies CredentialInfo),
    set: () => Promise.reject(new Error('read-only')),
    unset: () => Promise.reject(new Error('read-only')),
  })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(KeyPool, {
    cooldownMs: 60_000,
    pools: [{
      provider: 'deepseek',
      keys: [{ ref: 'PI_POOL_KEY' }, { ref: 'PI_POOL_KEY_2' }],
    }],
  })
  await ctx.plugin(LlmPiAi, {
    providers: { deepseek: { apiKeyEnv: 'PI_POOL_KEY', baseURL } },
  })
  return ctx
}

describe('llm-pi-ai over the key-pool composition', () => {
  it('rotates pooled keys across requests and fails over after a rate limit', async () => {
    const server = await mockServer([
      { status: 429, body: '{"error":{"message":"rate limited"}}' },
      { events: textEvents },
      { events: textEvents },
    ])
    const ctx = await mount(server.url)
    const message = createUserMessage({
      content: [{ type: 'text', text: 'hi' }],
      source: { kind: 'plugin', plugin: 'test' },
    })

    // The rate-limited first key cools down inside the same stream call, and
    // the bounded failover budget completes the request with the next one.
    await expect(assemble(ctx, { model: 'deepseek-v4-flash', messages: [message] }))
      .resolves.toMatchObject({ finish: { kind: 'stop' } })
    expect(server.headers[0]?.authorization).toBe(`Bearer ${KEY_ONE}`)
    expect(server.headers[1]?.authorization).toBe(`Bearer ${KEY_TWO}`)

    // The cooled key stays out of rotation for the next request.
    await expect(assemble(ctx, { model: 'deepseek-v4-flash', messages: [message] }))
      .resolves.toMatchObject({ finish: { kind: 'stop' } })
    expect(server.headers[2]?.authorization).toBe(`Bearer ${KEY_TWO}`)
  })

  it('rotates on a 429 and fails fast with the retryable cooldown code while both keys cool', async () => {
    const server = await mockServer([
      { status: 429, body: '{"error":{"message":"rate limited"}}' },
      { status: 429, body: '{"error":{"message":"rate limited"}}' },
    ])
    const ctx = await mount(server.url)
    const message = createUserMessage({
      content: [{ type: 'text', text: 'hi' }],
      source: { kind: 'plugin', plugin: 'test' },
    })
    // Stream call 1 rotates key one → key two and yields the 429.
    await expect(assemble(ctx, { model: 'deepseek-v4-flash', messages: [message] }))
      .resolves.toMatchObject({ finish: { kind: 'error', failure: { code: 'RATE_LIMIT' } } })
    expect(server.headers).toHaveLength(2)
    expect(server.headers[0]?.authorization).toBe(`Bearer ${KEY_ONE}`)
    expect(server.headers[1]?.authorization).toBe(`Bearer ${KEY_TWO}`)
    // A follow-up request inside the cooldown window fails fast with the
    // retryable cooldown code instead of stalling inside the broker; the
    // llm-retry plugin owns the visible wait on the agent loop.
    await expect(assemble(ctx, { model: 'deepseek-v4-flash', messages: [message] }))
      .resolves.toMatchObject({ finish: { kind: 'error', failure: { code: 'CREDENTIAL_COOLDOWN' } } })
    expect(server.headers).toHaveLength(2)
  }, 10_000)
})

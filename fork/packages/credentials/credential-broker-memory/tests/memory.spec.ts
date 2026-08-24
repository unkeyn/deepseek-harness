import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { MemoryCredentialBroker } from '../src/index.ts'

const config = {
  entries: [{ pool: 'main', credential: 'key-a', reference: 'DEEPSEEK_API_KEY', authKind: 'api-key' as const, maxConcurrent: 1 }],
}

describe('memory credential broker', () => {
  it('queues a second request until the first lease completes', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(MemoryCredentialBroker, config)
    const first = await ctx.credentialBroker.acquire({ provider: 'deepseek', model: 'deepseek-chat', purpose: 'conversation' })
    let settled = false
    const second = ctx.credentialBroker.acquire({ provider: 'deepseek', model: 'deepseek-chat', purpose: 'conversation' }).then((lease) => { settled = true; return lease })
    await Promise.resolve()
    expect(settled).toBe(false)
    ctx.credentialBroker.complete(first.id, { kind: 'success' })
    expect((await second).id).not.toBe(first.id)
    await fiber.dispose()
  })

  it('cancels a queued request without changing the active lease', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(MemoryCredentialBroker, config)
    const first = await ctx.credentialBroker.acquire({ provider: 'deepseek', model: 'deepseek-chat', purpose: 'conversation' })
    const controller = new AbortController()
    const second = ctx.credentialBroker.acquire({ provider: 'deepseek', model: 'deepseek-chat', purpose: 'conversation', signal: controller.signal })
    controller.abort()
    await expect(second).rejects.toThrow(/aborted/)
    ctx.credentialBroker.complete(first.id, { kind: 'cancelled' })
    await fiber.dispose()
  })

  it('disposes waiting requests and rejects duplicate completion', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin(MemoryCredentialBroker, config)
    const broker = ctx.credentialBroker
    const first = await broker.acquire({ provider: 'deepseek', model: 'deepseek-chat', purpose: 'conversation' })
    const waiting = broker.acquire({ provider: 'deepseek', model: 'deepseek-chat', purpose: 'conversation' })
    await fiber.dispose()
    await expect(waiting).rejects.toThrow(/disposed/)
    expect(() => broker.complete(first.id, { kind: 'success' })).toThrow(/not live/)
    expect(() => broker.complete(first.id, { kind: 'success' })).toThrow(/not live/)
  })
})

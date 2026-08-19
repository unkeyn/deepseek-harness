import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DeepSeekCredentialHealth } from '../src/index.ts'

describe('DeepSeek credential health classifier', () => {
  it('uses cooldown only for rate limits and preserves retry-after', async () => {
    const ctx = new Context()
    await ctx.plugin(DeepSeekCredentialHealth)
    expect(ctx.credentialHealth.classify({ provider: 'deepseek-official', model: 'chat', status: 429, retryAfterMs: 5000 })).toEqual({ kind: 'cooldown', retryAfterMs: 5000 })
  })
  it('quarantines ambiguous authorization denial instead of removing credentials', async () => {
    const ctx = new Context()
    await ctx.plugin(DeepSeekCredentialHealth)
    expect(ctx.credentialHealth.classify({ provider: 'deepseek-official', model: 'chat', status: 403 })).toEqual({ kind: 'quarantine', reason: 'authorization denial requires provider-specific verification' })
  })
  it('removes only confirmed invalid credentials and excludes model-only denial', async () => {
    const ctx = new Context()
    await ctx.plugin(DeepSeekCredentialHealth)
    expect(ctx.credentialHealth.classify({ provider: 'deepseek-official', model: 'chat', status: 401 })).toEqual({ kind: 'remove', reason: 'invalid credential evidence' })
    expect(ctx.credentialHealth.classify({ provider: 'deepseek-official', model: 'unavailable', status: 404, providerCode: 'model_not_found' })).toEqual({ kind: 'model-exclude', model: 'unavailable' })
  })
})

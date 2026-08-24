import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import CompactionPolicy, {
  COMPACTION_POLICY_SETTINGS_NAMESPACE,
  MIN_SESSION_LIMIT_TOKENS,
} from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> { return Promise.resolve() }
}

describe('compaction policy', () => {
  it('registers a live Host threshold override and falls back when unset', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin(CompactionPolicy)
    await fiber.await()
    expect(ctx.compactionPolicy.thresholdRatio(0.7)).toBe(0.7)
    await ctx.settings.update(COMPACTION_POLICY_SETTINGS_NAMESPACE, { thresholdPercent: 25 })
    expect(ctx.compactionPolicy.thresholdRatio(0.7)).toBe(0.25)
    await expect(ctx.settings.update(COMPACTION_POLICY_SETTINGS_NAMESPACE, { thresholdPercent: 20 })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.get('compactionPolicy')).toBeUndefined()
  })

  it('reads a per-session absolute cap live and reports none while unset', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin(CompactionPolicy)
    await fiber.await()
    expect(ctx.compactionPolicy.limitTokens('session-a')).toBeUndefined()
    await ctx.settings.update(COMPACTION_POLICY_SETTINGS_NAMESPACE, {
      sessionLimits: [{ sessionId: 'session-a', limitTokens: 32768 }],
    })
    expect(ctx.compactionPolicy.limitTokens('session-a')).toBe(32768)
    expect(ctx.compactionPolicy.limitTokens('session-b')).toBeUndefined()
    // Replacing the section clears the previous session's cap: each session
    // keeps its own value across switches without touching the other.
    await ctx.settings.replace(COMPACTION_POLICY_SETTINGS_NAMESPACE, {
      sessionLimits: [
        { sessionId: 'session-b', limitTokens: 16384 },
        { sessionId: 'session-c', limitTokens: MIN_SESSION_LIMIT_TOKENS },
      ],
    })
    expect(ctx.compactionPolicy.limitTokens('session-a')).toBeUndefined()
    expect(ctx.compactionPolicy.limitTokens('session-b')).toBe(16384)
    await fiber.dispose()
  })

  it('rejects duplicate sessions and caps below the workable floor', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin(CompactionPolicy)
    await fiber.await()
    await expect(ctx.settings.update(COMPACTION_POLICY_SETTINGS_NAMESPACE, {
      sessionLimits: [
        { sessionId: 'session-a', limitTokens: 4096 },
        { sessionId: 'session-a', limitTokens: 8192 },
      ],
    })).rejects.toThrow('duplicate session limit')
    await expect(ctx.settings.update(COMPACTION_POLICY_SETTINGS_NAMESPACE, {
      sessionLimits: [{ sessionId: 'session-a', limitTokens: MIN_SESSION_LIMIT_TOKENS - 1 }],
    })).rejects.toThrow()
    await fiber.dispose()
  })
})

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import CompactionPolicy, { COMPACTION_POLICY_SETTINGS_NAMESPACE } from '../src/index.ts'

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
})

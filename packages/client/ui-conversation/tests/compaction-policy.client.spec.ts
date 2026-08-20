// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  CompactionPolicyController, DEFAULT_COMPACTION_THRESHOLD, type CompactionPolicySettings,
} from '../src/client/input/compaction-policy.ts'

beforeEach(() => { localStorage.clear() })

describe('CompactionPolicyController', () => {
  it('publishes a selection locally and persists it through the Host scope', () => {
    const host = stubSettingsScope<CompactionPolicySettings>()
    const policy = new CompactionPolicyController(host.scope)
    expect(policy.threshold.getSnapshot()).toBe(DEFAULT_COMPACTION_THRESHOLD)

    policy.setThreshold(25)

    expect(policy.threshold.getSnapshot()).toBe(25)
    expect(host.set).toHaveBeenCalledWith('thresholdPercent', 25)
  })

  it('adopts Host updates without writing them back', () => {
    const host = stubSettingsScope<CompactionPolicySettings>()
    const policy = new CompactionPolicyController(host.scope)

    host.publish({ status: 'ready', value: { thresholdPercent: 45 }, revision: 1, writable: true })

    expect(policy.threshold.getSnapshot()).toBe(45)
    expect(host.set).not.toHaveBeenCalled()
  })

  it('migrates the former local-only threshold after the Host section becomes ready', () => {
    localStorage.setItem('dsh.compaction.threshold-percent', '35')
    const host = stubSettingsScope<CompactionPolicySettings>()
    const policy = new CompactionPolicyController(host.scope)

    host.publish({ status: 'ready', value: {}, revision: 1, writable: true })

    expect(policy.threshold.getSnapshot()).toBe(35)
    expect(host.set).toHaveBeenCalledWith('thresholdPercent', 35)
  })
})

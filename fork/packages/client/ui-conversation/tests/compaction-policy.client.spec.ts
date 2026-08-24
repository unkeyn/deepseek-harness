// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import {
  CompactionPolicyController, DEFAULT_COMPACTION_THRESHOLD, HOST_WRITE_DEBOUNCE_MS,
  MIN_SESSION_LIMIT_TOKENS,
  type CompactionPolicySettings,
} from '../src/client/input/compaction-policy.ts'

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => { vi.useRealTimers() })

/** Flush the debounced Host write so assertions see the published value. */
function flushWrite(): void {
  vi.advanceTimersByTime(HOST_WRITE_DEBOUNCE_MS)
}

describe('CompactionPolicyController', () => {
  it('publishes a selection locally at once and persists it through the Host scope after the debounce', () => {
    const host = stubSettingsScope<CompactionPolicySettings>()
    const policy = new CompactionPolicyController(host.scope)
    expect(policy.threshold.getSnapshot()).toBe(DEFAULT_COMPACTION_THRESHOLD)

    policy.setThreshold(25)

    // The local echo is synchronous — the slider never waits for the wire.
    expect(policy.threshold.getSnapshot()).toBe(25)
    expect(host.set).not.toHaveBeenCalled()
    flushWrite()
    expect(host.set).toHaveBeenCalledWith('thresholdPercent', 25)
  })

  it('coalesces a drag into one Host write carrying the settled value', () => {
    const host = stubSettingsScope<CompactionPolicySettings>()
    const policy = new CompactionPolicyController(host.scope)

    policy.setThreshold(40)
    policy.setThreshold(55)
    policy.setThreshold(70)
    // Mid-window: nothing published yet, the local echo already current.
    vi.advanceTimersByTime(HOST_WRITE_DEBOUNCE_MS - 1)
    expect(host.set).not.toHaveBeenCalled()
    expect(policy.threshold.getSnapshot()).toBe(70)

    flushWrite()
    expect(host.set).toHaveBeenCalledTimes(1)
    expect(host.set).toHaveBeenCalledWith('thresholdPercent', 70)
  })

  it('adopts Host updates without writing them back', () => {
    const host = stubSettingsScope<CompactionPolicySettings>()
    const policy = new CompactionPolicyController(host.scope)

    host.publish({ status: 'ready', value: { thresholdPercent: 45 }, revision: 1, writable: true })
    flushWrite()

    expect(policy.threshold.getSnapshot()).toBe(45)
    expect(host.set).not.toHaveBeenCalled()
  })

  it('migrates the former local-only threshold after the Host section becomes ready', () => {
    localStorage.setItem('dsh.compaction.threshold-percent', '35')
    const host = stubSettingsScope<CompactionPolicySettings>()
    const policy = new CompactionPolicyController(host.scope)

    host.publish({ status: 'ready', value: {}, revision: 1, writable: true })
    flushWrite()

    expect(policy.threshold.getSnapshot()).toBe(35)
    expect(host.set).toHaveBeenCalledWith('thresholdPercent', 35)
  })

  it('keeps one independent cap per session and persists set and clear', () => {
    const host = stubSettingsScope<CompactionPolicySettings>()
    const policy = new CompactionPolicyController(host.scope)
    const a = policy.storeFor('session-a')
    const b = policy.storeFor('session-b')
    expect(a.getSnapshot()).toBeNull()
    expect(b.getSnapshot()).toBeNull()

    policy.setSessionLimit('session-a', 32_768)

    expect(a.getSnapshot()).toBe(32_768)
    expect(b.getSnapshot()).toBeNull()
    flushWrite()
    expect(host.set).toHaveBeenLastCalledWith('sessionLimits', [
      { sessionId: 'session-a', limitTokens: 32_768 },
    ])

    // Setting the second session keeps the first intact.
    policy.setSessionLimit('session-b', 8_192)
    flushWrite()
    expect(host.set).toHaveBeenLastCalledWith('sessionLimits', [
      { sessionId: 'session-a', limitTokens: 32_768 },
      { sessionId: 'session-b', limitTokens: 8_192 },
    ])

    // Clearing removes only that session's entry.
    policy.setSessionLimit('session-a', null)
    flushWrite()
    expect(a.getSnapshot()).toBeNull()
    expect(host.set).toHaveBeenLastCalledWith('sessionLimits', [
      { sessionId: 'session-b', limitTokens: 8_192 },
    ])
  })

  it('ignores caps the Host schema would reject instead of echoing them locally', () => {
    const host = stubSettingsScope<CompactionPolicySettings>()
    const policy = new CompactionPolicyController(host.scope)
    const store = policy.storeFor('session-a')

    policy.setSessionLimit('session-a', MIN_SESSION_LIMIT_TOKENS - 1)
    policy.setSessionLimit('session-a', 4096.5)
    flushWrite()

    expect(store.getSnapshot()).toBeNull()
    expect(host.set).not.toHaveBeenCalledWith(
      'sessionLimits',
      expect.arrayContaining([expect.objectContaining({ sessionId: 'session-a' })]),
    )
    // The floor itself is accepted.
    policy.setSessionLimit('session-a', MIN_SESSION_LIMIT_TOKENS)
    flushWrite()
    expect(store.getSnapshot()).toBe(MIN_SESSION_LIMIT_TOKENS)
  })

  it('re-binds existing session stores when the Host section changes', () => {
    const host = stubSettingsScope<CompactionPolicySettings>()
    const policy = new CompactionPolicyController(host.scope)
    const a = policy.storeFor('session-a')

    host.publish({
      status: 'ready',
      value: { sessionLimits: [{ sessionId: 'session-a', limitTokens: 16_384 }] },
      revision: 1,
      writable: true,
    })
    flushWrite()

    expect(a.getSnapshot()).toBe(16_384)
    // A later-created store seeds from the accepted Host state too.
    expect(policy.storeFor('session-a').getSnapshot()).toBe(16_384)
    expect(policy.storeFor('session-b').getSnapshot()).toBeNull()
  })
})

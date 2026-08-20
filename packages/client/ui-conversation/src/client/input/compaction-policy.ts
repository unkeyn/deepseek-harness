/** Browser controller for the Host-backed automatic compaction threshold. */

import {
  createSnapshotStore, type SettingsScope, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'

/** Host settings namespace owned by the compaction policy startup plugin. */
export const COMPACTION_POLICY_SETTINGS_NAMESPACE = 'compaction-policy'
/** Persisted settings field carrying the selected percentage. */
export const COMPACTION_THRESHOLD_FIELD = 'thresholdPercent'
/** Default displayed threshold when no user override exists. */
export const DEFAULT_COMPACTION_THRESHOLD = 80
const LEGACY_THRESHOLD_KEY = 'dsh.compaction.threshold-percent'

/** Browser view of the host compaction policy section. */
export interface CompactionPolicySettings {
  /** Context-window percentage that triggers compaction. */
  thresholdPercent?: number
}

/** Read one valid legacy local-only threshold for one-time migration. */
function legacyThreshold(): number | undefined {
  if (typeof localStorage === 'undefined') return undefined
  const value = Number(localStorage.getItem(LEGACY_THRESHOLD_KEY))
  return Number.isInteger(value) && value >= 25 && value <= 95 ? value : undefined
}

/** Keeps the meter and Host policy on one live threshold value. */
export class CompactionPolicyController {
  /** Reactive percentage consumed by the composer slot. */
  readonly threshold: SnapshotStore<number> = createSnapshotStore(DEFAULT_COMPACTION_THRESHOLD)
  private migrated = false

  /** @param host - bound Host settings scope for `compaction-policy`. */
  constructor(private readonly host: SettingsScope<CompactionPolicySettings>) {
    host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /**
   * Publish and persist one slider selection.
   * @param value - integer percentage accepted by the Host schema.
   */
  setThreshold(value: number): void {
    if (this.threshold.getSnapshot() !== value) this.threshold.set(value)
    void this.host.set(COMPACTION_THRESHOLD_FIELD, value)
  }

  /** Adopt accepted Host state and migrate the former local-only value once. */
  private adopt(): void {
    const snapshot = this.host.getSnapshot()
    const value = snapshot.value?.thresholdPercent
    if (value !== undefined) {
      if (this.threshold.getSnapshot() !== value) this.threshold.set(value)
      if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_THRESHOLD_KEY)
      return
    }
    if (snapshot.status !== 'ready' || this.migrated) return
    this.migrated = true
    const legacy = legacyThreshold()
    if (legacy === undefined) return
    this.threshold.set(legacy)
    void this.host.set(COMPACTION_THRESHOLD_FIELD, legacy)
  }
}

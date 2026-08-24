/** Browser controller for the Host-backed automatic compaction threshold and
 * per-session absolute context caps. */

import {
  createSnapshotStore, type SettingsScope, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'

/** Host settings namespace owned by the compaction policy startup plugin. */
export const COMPACTION_POLICY_SETTINGS_NAMESPACE = 'compaction-policy'
/** Persisted settings field carrying the selected percentage. */
export const COMPACTION_THRESHOLD_FIELD = 'thresholdPercent'
/** Persisted settings field carrying the per-session absolute caps. */
export const SESSION_LIMITS_FIELD = 'sessionLimits'
/** Smallest cap the Host schema accepts; smaller writes would be rejected server-side. */
export const MIN_SESSION_LIMIT_TOKENS = 1024
/** Default displayed threshold when no user override exists. */
export const DEFAULT_COMPACTION_THRESHOLD = 80
/** Trailing-debounce window coalescing Host writes: a slider drag fires many
 * updates per second and every round-trip re-enters `adopt()`, so the publish
 * carries only the settled value. The local echo stays synchronous. */
export const HOST_WRITE_DEBOUNCE_MS = 300
const LEGACY_THRESHOLD_KEY = 'dsh.compaction.threshold-percent'

/** One session's absolute context cap in tokens (mirrors the Host schema). */
export interface SessionLimitEntry {
  sessionId: string
  limitTokens: number
}

/** Browser view of the host compaction policy section. */
export interface CompactionPolicySettings {
  /** Context-window percentage that triggers compaction. */
  thresholdPercent?: number
  /** Per-session absolute caps; a session id appears at most once. */
  sessionLimits?: SessionLimitEntry[]
}

/** Read one valid legacy local-only threshold for one-time migration. */
function legacyThreshold(): number | undefined {
  if (typeof localStorage === 'undefined') return undefined
  const value = Number(localStorage.getItem(LEGACY_THRESHOLD_KEY))
  return Number.isInteger(value) && value >= 25 && value <= 95 ? value : undefined
}

/** Keeps the meter, Host policy, and per-session caps on one live value each. */
export class CompactionPolicyController {
  /** Reactive percentage consumed by the composer slot. */
  readonly threshold: SnapshotStore<number> = createSnapshotStore(DEFAULT_COMPACTION_THRESHOLD)
  private migrated = false
  private readonly sessionStores = new Map<string, SnapshotStore<number | null>>()
  /** Latest known per-session caps: the Host value once published, else this session's own writes. */
  private knownLimits: readonly SessionLimitEntry[] = []
  /** Pending debounced writes by settings field; the last value per field wins. */
  private readonly pendingWrites = new Map<string, unknown>()
  private writeTimer: ReturnType<typeof setTimeout> | null = null

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
    this.scheduleHostWrite(COMPACTION_THRESHOLD_FIELD, value)
  }

  /**
   * The per-session cap store for one session; created on demand and kept in
   * sync with the Host section, so switching sessions re-binds to that
   * session's own value.
   * @param sessionId - durable session id.
   * @returns the store holding the cap in tokens, or `null` when uncapped.
   */
  storeFor(sessionId: string): SnapshotStore<number | null> {
    let store = this.sessionStores.get(sessionId)
    if (store === undefined) {
      store = createSnapshotStore<number | null>(this.limitOf(sessionId))
      this.sessionStores.set(sessionId, store)
    }
    return store
  }

  /**
   * Publish and persist one session's cap.
   * @param sessionId - durable session id.
   * @param tokens - absolute cap in tokens, or `null` to clear it. Values the
   * Host schema would reject (below the floor, non-integers) are ignored so a
   * local echo never diverges from what the Host accepted.
   */
  setSessionLimit(sessionId: string, tokens: number | null): void {
    if (tokens !== null && (!Number.isInteger(tokens) || tokens < MIN_SESSION_LIMIT_TOKENS)) return
    const next = tokens === null
      ? this.knownLimits.filter(entry => entry.sessionId !== sessionId)
      : [...this.knownLimits.filter(entry => entry.sessionId !== sessionId), { sessionId, limitTokens: tokens }]
    this.knownLimits = next
    const store = this.storeFor(sessionId)
    if (store.getSnapshot() !== tokens) store.set(tokens)
    this.scheduleHostWrite(SESSION_LIMITS_FIELD, [...next])
  }

  /**
   * Coalesce Host writes: one trailing timer carries the latest value per
   * field, so a drag publishes once instead of once per tick.
   * @param field - settings field name.
   * @param value - accepted value for that field.
   */
  private scheduleHostWrite(field: string, value: unknown): void {
    this.pendingWrites.set(field, value)
    if (this.writeTimer !== null) clearTimeout(this.writeTimer)
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      for (const [pendingField, pendingValue] of this.pendingWrites) {
        void this.host.set(pendingField, pendingValue)
      }
      this.pendingWrites.clear()
    }, HOST_WRITE_DEBOUNCE_MS)
  }

  /** Adopt accepted Host state, migrate the former local-only value once, and refresh every live session store. */
  private adopt(): void {
    const snapshot = this.host.getSnapshot()
    const section = snapshot.value
    // An accepted Host section is authoritative once it carries the field at
    // all; before that (or when absent) this session's own writes stay visible.
    if (section?.sessionLimits !== undefined) this.knownLimits = section.sessionLimits
    const value = section?.thresholdPercent
    for (const [sessionId, store] of this.sessionStores) {
      const limit = this.limitOf(sessionId)
      if (store.getSnapshot() !== limit) store.set(limit)
    }
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

  /** Read one session's cap from the latest known section. */
  private limitOf(sessionId: string): number | null {
    return this.knownLimits.find(entry => entry.sessionId === sessionId)?.limitTokens ?? null
  }
}

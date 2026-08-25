/** Key-pool service face consumed by provider adapters and diagnostics. */
import { type Context, Service } from '@deepseek-ai/cordis'
import type { PoolSnapshot } from '@deepseek-ai/dsh-fork-credential-pool-store'

/** Bounded failover decision for one provider route. */
export interface KeyPoolFailoverPolicy {
  /** Total provider attempts, including the initial attempt. */
  readonly maxAttempts: number
  /** Failure codes that permit another credential attempt. */
  readonly retryableCodes: readonly string[]
}

/** Redacted status row for one pooled credential. */
export type KeyPoolStatusKey = {
  ref: string
  enabled: boolean
  eligible: boolean
  cooldownUntil?: number
  quarantineReason?: string
  lastFailure?: { disposition: string; code: string; at: number }
  lastSuccessAt?: number
}

/** Redacted status for one pool. */
export type KeyPoolStatusPool = {
  provider: string
  keys: KeyPoolStatusKey[]
}

/** Failure codes that permit falling over to another key. Auth and quota
 * failures are key-specific by nature; transport and server failures may be
 * shared, but trying the next key costs one bounded attempt. */
const FAILOVER_RETRYABLE_CODES = Object.freeze([
  'AUTH', 'MISSING_CREDENTIAL', 'QUOTA', 'RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT',
])

/** Runtime facts the face reads; replaced wholesale on settings changes. */
export interface KeyPoolRuntime {
  readonly pools: readonly { provider: string; refs: readonly string[] }[]
  readonly maxAttempts: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** User-managed API key pool policy face (`undefined` without the plugin). */
    keyPool: KeyPool
  }
}

/**
 * Policy and diagnostics face over the configured pools. Provider adapters ask
 * {@link KeyPool.failover} per stream call, so a pool added or emptied at
 * runtime reaches the very next request without re-composition.
 */
export class KeyPool extends Service {
  private readonly listeners = new Set<() => void>()

  constructor(
    ctx: Context,
    private readonly runtime: () => KeyPoolRuntime,
    private readonly snapshot: () => PoolSnapshot,
  ) {
    super(ctx, 'keyPool')
    ctx.effect(() => () => { this.listeners.clear() }, 'key pool face teardown')
  }

  /**
   * The bounded failover decision for one provider route.
   * @param provider - the provider route id.
   * @returns the policy, or `undefined` when the provider has no pooled keys
   * and requests must stream through the unwrapped adapter.
   */
  failover(provider: string): KeyPoolFailoverPolicy | undefined {
    const runtime = this.runtime()
    const pool = runtime.pools.find(candidate => candidate.provider === provider)
    if (pool === undefined || pool.refs.length === 0) return undefined
    return { maxAttempts: runtime.maxAttempts, retryableCodes: FAILOVER_RETRYABLE_CODES }
  }

  /** Redacted durable eligibility per key: enabled, not cooling, not quarantined.
   * @returns one row per configured pool and key.
   */
  status(): KeyPoolStatusPool[] {
    const now = Date.now()
    return this.runtime().pools.map(pool => ({
      provider: pool.provider,
      keys: pool.refs.map((ref) => {
        const record = this.snapshot().credentials.find(candidate => candidate.pool === pool.provider && candidate.reference === ref)
        const health = record?.health
        const eligible = record?.enabled === true
          && health?.quarantineReason === undefined
          && (health?.cooldownUntil ?? 0) <= now
        return {
          ref,
          enabled: record?.enabled ?? true,
          eligible,
          ...health?.cooldownUntil === undefined ? {} : { cooldownUntil: health.cooldownUntil },
          ...health?.quarantineReason === undefined ? {} : { quarantineReason: health.quarantineReason },
          ...health?.lastFailure === undefined ? {} : { lastFailure: health.lastFailure },
          ...health?.lastSuccessAt === undefined ? {} : { lastSuccessAt: health.lastSuccessAt },
        }
      }),
    }))
  }

  /** Subscribe to configuration changes until disposal.
   * @param listener - called after a settings change re-synced the pools.
   * @returns the disposer.
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Notify subscribers after a configuration sync. */
  emitChange(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

export default KeyPool

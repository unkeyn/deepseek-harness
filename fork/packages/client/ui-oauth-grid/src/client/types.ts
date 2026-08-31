/**
 * OAuth grid: per-provider account + usage-limit shapes.
 *
 * `UsageLimit`/`UsageReport` are the same shape oh-my-pi uses (see
 * `can1357/oh-my-pi` packages/ai/src/usage/{claude,google-antigravity}.ts):
 * a normalized `{ windowId, usedFraction, remainingFraction, resetsAt, status }`
 * payload with `exhausted | warning | ok | unknown` derived from the
 * utilization fraction, plus an optional `tier` for per-model-family caps.
 *
 * Hosts that support a probe fill `UsageReport` through `usage.fetch`; we
 * only consume the snapshot here and let the controller decide whether to
 * show it. Anonymous credentials never leak — only redacted metadata.
 */

export type UsageStatus = 'exhausted' | 'warning' | 'ok' | 'unknown'

export interface UsageAmount {
  /** 0–100 percentage when `unit: 'percent'`; USD units otherwise. */
  readonly used?: number
  readonly limit?: number
  readonly remaining?: number
  readonly usedFraction?: number
  readonly remainingFraction?: number
  readonly unit: 'percent' | 'usd'
}

export interface UsageWindow {
  readonly id: string
  readonly label: string
  readonly durationMs?: number
  /** Unix ms. Used by the ranking strategy. */
  readonly resetsAt?: number
}

export interface UsageScope {
  readonly provider: string
  readonly windowId: string
  /** Per-model-family caps (Anthropic `fable`/`mythos`/`opus`/`sonnet`,
   *  Antigravity `anthropic`/`google`/`openai`). Shared umbrella caps leave
   *  this unset. */
  readonly tier?: string
  /** Mark account-wide shared caps so reactive rotation skips per-tier rows. */
  readonly shared?: boolean
  /** Optional account identity for multi-tenant OAuth. */
  readonly accountId?: string
  readonly email?: string
}

export interface UsageLimit {
  readonly id: string
  readonly label: string
  readonly scope: UsageScope
  readonly window?: UsageWindow
  readonly amount: UsageAmount
  readonly status?: UsageStatus
}

export interface UsageReport {
  readonly provider: string
  readonly fetchedAt: number
  readonly limits: readonly UsageLimit[]
}

/** Wire-safe account metadata. The actual OAuth token never crosses this seam. */
export interface OAuthAccountView {
  /** Stable id within a provider (e.g. `${providerKey}#${accountUuid}`). */
  readonly id: string
  readonly providerKey: string
  readonly accountId: string
  readonly email?: string
  readonly status: 'active' | 'expired' | 'pending' | 'unknown'
  readonly label?: string
  /** Unix ms. */
  readonly lastUsedAt?: number
  readonly lastReport?: UsageReport
}

export interface OAuthAccountSnapshot {
  readonly loaded: boolean
  readonly accounts: readonly OAuthAccountView[]
  readonly errors: Readonly<Record<string, string>>
  /** Per-provider usage reports keyed by `${providerKey}#${accountId}`. */
  readonly reports: Readonly<Record<string, UsageReport>>
}

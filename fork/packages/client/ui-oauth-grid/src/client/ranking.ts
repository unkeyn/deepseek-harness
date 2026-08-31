/**
 * Usage-aware account ranking.
 *
 * Adapted from `can1357/oh-my-pi` (packages/ai/src/usage/claude.ts:355-462
 * and packages/ai/src/auth-storage.ts:81-87). We do not have a snapshot
 * cache on the client yet, so the strategy runs purely over the
 * `UsageReport`s already in the controller state — same arithmetic, same
 * thresholds, same `tier:fable`-style block scope semantics.
 */

import type { UsageLimit, UsageReport, UsageStatus } from './types.ts'

/**
 * Fraction of the primary (5h) window above which an account is considered
 * "hot" and demoted in the grid. Mirrors `PRIMARY_WINDOW_HOT_FRACTION` from
 * oh-my-pi.
 */
export const PRIMARY_WINDOW_HOT_FRACTION = 0.85

/** Resolves the used fraction on a `UsageLimit`, clamped to `[0, 1]`. */
export function resolveUsedFraction(limit: UsageLimit): number | undefined {
  const raw = limit.amount.usedFraction
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    // Antigravity exposes `remainingFraction`; flip it so the rest of the
    // strategy stays in `usedFraction` space.
    if (typeof limit.amount.remainingFraction === 'number' && Number.isFinite(limit.amount.remainingFraction)) {
      const flipped = 1 - limit.amount.remainingFraction
      return Math.min(Math.max(flipped, 0), 1)
    }
    return undefined
  }
  return Math.min(Math.max(raw, 0), 1)
}

/** Derives an `exhausted | warning | ok | unknown` status from a fraction. */
export function deriveStatus(usedFraction: number | undefined): UsageStatus | undefined {
  if (usedFraction === undefined) return undefined
  if (usedFraction >= 1) return 'exhausted'
  if (usedFraction >= 0.9) return 'warning'
  return 'ok'
}

/** Picks the most-pressured `UsageLimit` among a list using the primary window. */
export function pickPrimary(report: UsageReport | undefined): UsageLimit | undefined {
  if (report === undefined) return undefined
  // Prefer shared 5h buckets, fall back to first limit on the report.
  const shared = report.limits.find(limit => limit.scope.shared === true && limit.scope.windowId === '5h')
  if (shared !== undefined) return shared
  return report.limits.find(limit => limit.scope.windowId === '5h') ?? report.limits[0]
}

/** Returns whether the primary window of `report` is "hot". */
export function isHot(report: UsageReport | undefined): boolean {
  if (report === undefined) return false
  const primary = pickPrimary(report)
  if (primary === undefined) return false
  const fraction = resolveUsedFraction(primary)
  if (fraction === undefined) return false
  return fraction >= PRIMARY_WINDOW_HOT_FRACTION
}

/** Returns whether the report has an exhausted shared limit, blocking rotation. */
export function isExhausted(report: UsageReport | undefined): boolean {
  if (report === undefined) return false
  return report.limits.some(limit => {
    if (limit.scope.shared !== true) return false
    const fraction = resolveUsedFraction(limit)
    return fraction !== undefined && fraction >= 1
  })
}

/** Block-scope key matched against `tier:<kind>` in claude.ts. */
export function blockScopeFor(report: UsageReport | undefined, modelKind: string | undefined): string | undefined {
  if (report === undefined) return undefined
  if (modelKind === 'fable' || modelKind === 'mythos') {
    const hasTier = report.limits.some(limit => limit.scope.tier === modelKind)
    return hasTier ? `tier:${modelKind}` : undefined
  }
  if (modelKind === undefined) return undefined
  return `tier:${modelKind}`
}

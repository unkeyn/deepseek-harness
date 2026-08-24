import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Settings namespace shared with the Web context meter. */
export const COMPACTION_POLICY_SETTINGS_NAMESPACE = settingsNamespace('compaction-policy')

/** Smallest accepted per-session cap; below this, retention could not fit under the threshold. */
export const MIN_SESSION_LIMIT_TOKENS = 1024

/** One session's absolute context cap in tokens. */
export interface SessionLimitEntry {
  /** Durable session id the cap belongs to. */
  sessionId: string
  /** Absolute token cap for that session's context. */
  limitTokens: number
}

/** User-owned automatic compaction policy. */
export interface CompactionPolicySettings {
  thresholdPercent?: number
  /** Per-session absolute caps; a session id appears at most once. */
  sessionLimits?: SessionLimitEntry[]
}

/** Settings schema for the global compaction policy override. */
export const COMPACTION_POLICY_SETTINGS_SCHEMA: z<CompactionPolicySettings> = z.object({
  thresholdPercent: z.number().step(5).min(25).max(95),
  sessionLimits: z.array(z.object({
    sessionId: z.string().required(),
    limitTokens: z.number().step(1).min(MIN_SESSION_LIMIT_TOKENS),
  })),
})

declare module '@deepseek-ai/cordis' {
  interface Context { compactionPolicy: CompactionPolicy }
}

/**
 * Shared live policy read by isolated compaction backend instances.
 * Two independent knobs resolve together: the deployment-wide `thresholdPercent`
 * scales every model's window, while a per-session `sessionLimits` entry states
 * one absolute cap; the engine compacts at whichever constraint binds first.
 */
export class CompactionPolicy extends Service {
  private source: () => CompactionPolicySettings = () => ({})

  /** @param ctx - host context carrying the optional settings provider. */
  constructor(ctx: Context) {
    super(ctx, 'compactionPolicy')
    installSettingsSection(ctx, COMPACTION_POLICY_SETTINGS_NAMESPACE, COMPACTION_POLICY_SETTINGS_SCHEMA, {}, {
      setSource: (current) => { this.source = current },
      onChange: () => {},
      validate: validateSessionLimits,
    })
  }

  /**
   * Resolve the current user override over one backend policy.
   * @param fallback - backend-configured ratio for the routed model.
   * @returns user percentage as a ratio, or the backend value while unset.
   */
  thresholdRatio(fallback: number): number {
    const percent = this.source().thresholdPercent
    return percent === undefined ? fallback : percent / 100
  }

  /**
   * Read one session's absolute context cap.
   * @param sessionId - durable session id to look up.
   * @returns the cap in tokens, or `undefined` when that session has none.
   */
  limitTokens(sessionId: string): number | undefined {
    return this.source().sessionLimits?.find(entry => entry.sessionId === sessionId)?.limitTokens
  }
}

/** Reject duplicate session ids and entries below the workable floor. */
function validateSessionLimits(value: CompactionPolicySettings): void {
  const seen = new Set<string>()
  for (const entry of value.sessionLimits ?? []) {
    if (seen.has(entry.sessionId)) {
      throw new Error(`CompactionPolicySettings: duplicate session limit for "${entry.sessionId}"`)
    }
    seen.add(entry.sessionId)
  }
}

export default CompactionPolicy

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Settings namespace shared with the Web context meter. */
export const COMPACTION_POLICY_SETTINGS_NAMESPACE = settingsNamespace('compaction-policy')
/** User-owned automatic compaction policy. */
export interface CompactionPolicySettings { thresholdPercent?: number }
/** Settings schema for the global compaction policy override. */
export const COMPACTION_POLICY_SETTINGS_SCHEMA: z<CompactionPolicySettings> = z.object({
  thresholdPercent: z.number().step(5).min(25).max(95),
})

declare module '@deepseek-ai/cordis' {
  interface Context { compactionPolicy: CompactionPolicy }
}

/** Shared live policy read by isolated compaction backend instances. */
export class CompactionPolicy extends Service {
  private source: () => CompactionPolicySettings = () => ({})

  /** @param ctx - host context carrying the optional settings provider. */
  constructor(ctx: Context) {
    super(ctx, 'compactionPolicy')
    installSettingsSection(ctx, COMPACTION_POLICY_SETTINGS_NAMESPACE, COMPACTION_POLICY_SETTINGS_SCHEMA, {}, {
      setSource: (current) => { this.source = current },
      onChange: () => {},
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
}

export default CompactionPolicy

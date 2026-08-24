/**
 * Model-facing session budget awareness. When a session carries an absolute
 * context cap (the fork compaction-policy `sessionLimits` setting), this plugin
 * contributes a `SystemPrompt.context()` renderer that reports the remaining
 * budget in stable buckets once usage passes the configured onset, so the model
 * spends the scarce window deliberately instead of filling it mindlessly.
 *
 * The note lands through the standard runtime-context snapshot (a durable
 * `user/message`), and only when its bucketed text changes — identical buckets
 * append nothing.
 *
 * @module @deepseek-ai/dsh-fork-budget-context
 */

import type { Context } from '@deepseek-ai/cordis'
// The `scope.systemPrompt` read below rides the service's Context augmentation,
// and the `assemble.agent` read rides dsh-agent's `AssembleContext` augmentation;
// each loads only when that module's types are in the program.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import z from '@deepseek-ai/schemastery'
import { renderBudgetNote } from './render.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'budget-context'

/** Services required at load; every collaborator is optional at read time. */
export const inject: readonly string[] = []

/** Request-preparation advice tuning. Invalid values fail plugin load. */
export interface Config {
  /** Usage percent at or above which the note starts appearing. Defaults to `50`. */
  adviseFromPercent?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  adviseFromPercent: z.number().step(5).min(10).max(90),
})

/**
 * Installs the `session:budget` prompt context.
 * @param ctx - Cordis context; reads optional `compactionPolicy` and
 * `tokenMeter` services live so a deployment missing either renders nothing.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const adviseFromPercent = config.adviseFromPercent ?? 50
  ctx.inject(['systemPrompt'], (scope: Context) => {
    scope.systemPrompt.context({
      name: 'session:budget',
      order: 115,
      text: (assemble) => {
        const session = assemble.agent?.session
        if (session === undefined) return ''
        const policy = ctx.get('compactionPolicy')
        const limitTokens = policy?.limitTokens(String(session.id))
        if (limitTokens === undefined) return ''
        const meter = ctx.get('tokenMeter')
        if (meter === undefined) return ''
        return renderBudgetNote({
          usedTokens: meter.measure(session).totalTokens,
          limitTokens,
          adviseFromPercent,
        })
      },
    })
  })
}

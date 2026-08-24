/**
 * Pure renderer for the session context-budget note. The exact text is pinned:
 * it is model-visible runtime context whose bucketed wording keeps consecutive
 * snapshots identical between crossings, so the durable projection appends no
 * new message while usage drifts inside one bucket.
 *
 * @module @deepseek-ai/dsh-fork-budget-context/render
 */

/** Width of the reported usage buckets, in percent points. */
export const BUDGET_BUCKET_PERCENT = 10

/** Inputs the note is rendered from; all figures come from live services. */
export interface BudgetNoteInput {
  /** Metered tokens currently attributable to the session's surface. */
  usedTokens: number
  /** The session's absolute context cap in tokens. */
  limitTokens: number
  /** Usage percent below which no note is produced. */
  adviseFromPercent: number
}

/**
 * Render one budget-awareness note.
 * @param input - metered usage, the cap, and the advice onset.
 * @returns the pinned note text, or `''` when usage has not reached the onset
 * or rounds to nothing — an empty result contributes no runtime context.
 */
export function renderBudgetNote(input: BudgetNoteInput): string {
  const { usedTokens, limitTokens, adviseFromPercent } = input
  if (!Number.isFinite(usedTokens) || !Number.isFinite(limitTokens) || limitTokens <= 0) return ''
  const rawPercent = Math.floor((usedTokens / limitTokens) * 100)
  if (rawPercent < adviseFromPercent) return ''
  const bucket = Math.min(100, Math.floor(rawPercent / BUDGET_BUCKET_PERCENT) * BUDGET_BUCKET_PERCENT)
  if (bucket <= 0) return ''
  return 'Session context budget: about '
    + `${bucket}% of this session's ${limitTokens}-token cap is in use. `
    + 'As the cap approaches, older history is summarized automatically into a compact checkpoint. '
    + 'Work economically: keep tool outputs and prose short, avoid re-reading unchanged files, '
    + 'and do not repeat content that is already present in context.'
}

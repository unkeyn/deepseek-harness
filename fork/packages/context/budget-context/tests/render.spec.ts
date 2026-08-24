import { describe, expect, it } from 'vitest'
import { renderBudgetNote } from '../src/render.ts'

const CAP = 10_000

describe('budget note renderer', () => {
  it('stays silent before the configured onset', () => {
    expect(renderBudgetNote({ usedTokens: 0, limitTokens: CAP, adviseFromPercent: 50 })).toBe('')
    expect(renderBudgetNote({ usedTokens: 4_999, limitTokens: CAP, adviseFromPercent: 50 })).toBe('')
    expect(renderBudgetNote({ usedTokens: 5_000, limitTokens: CAP, adviseFromPercent: 50 }))
      .toContain('about 50%')
  })

  it('buckets usage so consecutive readings render identical text inside one bucket', () => {
    const low = renderBudgetNote({ usedTokens: 5_400, limitTokens: CAP, adviseFromPercent: 50 })
    const high = renderBudgetNote({ usedTokens: 5_900, limitTokens: CAP, adviseFromPercent: 50 })
    expect(low).toBe(high)
    expect(low).toContain('about 50%')
    // Crossing a bucket boundary changes the wording exactly once.
    const next = renderBudgetNote({ usedTokens: 6_100, limitTokens: CAP, adviseFromPercent: 50 })
    expect(next).toContain('about 60%')
    expect(next).not.toBe(low)
  })

  it('clamps saturation at the full bucket and states the cap figures', () => {
    const saturated = renderBudgetNote({
      usedTokens: 250_000,
      limitTokens: CAP,
      adviseFromPercent: 50,
    })
    expect(saturated).toContain('about 100%')
    expect(saturated).toContain(`${CAP}-token cap`)
  })

  it('renders nothing for unusable caps', () => {
    expect(renderBudgetNote({ usedTokens: 5_000, limitTokens: 0, adviseFromPercent: 50 })).toBe('')
    expect(renderBudgetNote({ usedTokens: Number.NaN, limitTokens: CAP, adviseFromPercent: 50 })).toBe('')
  })
})

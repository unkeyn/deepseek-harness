/** Composer context-occupancy meter: a ring beside the send button fed by the
 * `contextPressure` projection, with a click-open panel of the heuristic
 * `contextBreakdown` composition (system prompt, tools, conversation).
 * Renders nothing until a provider reports both pressure and a route
 * capacity. */

import { useEffect, useRef, useState } from 'react'
import type { UseProjection } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the `contextPressure` / `contextBreakdown` projection key merges.
import type {} from '@deepseek-ai/dsh-token-meter/client'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComposerBarProps } from '../contract/slots.ts'
import { contextOccupancy, formatTokens } from '../chat/StatsLine.tsx'
import css from './ContextMeter.module.css'

/** Ring geometry: 14px viewBox, 2px stroke. */
const RADIUS = 5.5
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * Marker the localized occupancy sentence is split on, so the panel headline
 * keeps the reading in its own tone while each locale still owns the word
 * order (`45% of context used` / `上下文已用 45%`).
 */
const READING_SLOT = '\u0000'

/** Panel legend rows, in bar-segment order; each color class carries the shared swatch/segment tint. */
const ROWS = [
  { key: 'systemTokens', label: 'context.system', color: css.colorSystem },
  { key: 'toolsTokens', label: 'context.tools', color: css.colorTools },
  { key: 'messageTokens', label: 'context.messages', color: css.colorMessages },
] as const

export interface ContextMeterProps {
  useProjection: UseProjection
  /** Run the session's manual compaction command. */
  compact?: () => Promise<boolean>
  /** Whether a turn or manual compaction already owns the session. */
  busy?: boolean
  /** The owning bar's locale seat, passed down as a plain prop. */
  t: ComposerBarProps['t']
}

const COMPACTION_THRESHOLD_KEY = 'dsh.compaction.threshold-percent'
const DEFAULT_COMPACTION_THRESHOLD = 80

function storedThreshold(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_COMPACTION_THRESHOLD
  const value = Number(localStorage.getItem(COMPACTION_THRESHOLD_KEY))
  return Number.isInteger(value) && value >= 25 && value <= 95 ? value : DEFAULT_COMPACTION_THRESHOLD
}

export function ContextMeter({ useProjection, compact, busy = false, t }: ContextMeterProps) {
  const pressure = useProjection('contextPressure')
  const breakdown = useProjection('contextBreakdown')
  const [open, setOpen] = useState(false)
  const [threshold, setThreshold] = useState(storedThreshold)
  const [compacting, setCompacting] = useState(false)
  const [pendingAutoCompact, setPendingAutoCompact] = useState(false)
  const autoArmed = useRef(true)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const context = contextOccupancy(pressure)
  const available = context !== null

  const runCompact = (): void => {
    if (compact === undefined || compacting || busy) return
    setCompacting(true)
    void compact().finally(() => { setCompacting(false) })
  }

  useEffect(() => {
    if (context === null || compact === undefined) return
    if (context.percent < threshold) {
      autoArmed.current = true
      setPendingAutoCompact(false)
      return
    }
    if (!autoArmed.current) return
    autoArmed.current = false
    setPendingAutoCompact(true)
  }, [compact, context?.percent, threshold])

  useEffect(() => {
    if (!pendingAutoCompact || compact === undefined || compacting || busy) return
    setPendingAutoCompact(false)
    setCompacting(true)
    void compact().finally(() => { setCompacting(false) })
  }, [busy, compact, compacting, pendingAutoCompact])

  // A model switch can temporarily remove capacity while this component stays
  // mounted. Close the now-unavailable panel instead of preserving stale UI.
  useEffect(() => {
    if (!available && open) setOpen(false)
  }, [available, open])

  // Outside click / Escape close, one document listener while open (Menu's pattern).
  useEffect(() => {
    if (!open || !available) return
    const onPointerDown = (e: PointerEvent): void => {
      if (e.target instanceof Node && rootRef.current?.contains(e.target) === true) return
      setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [available, open])

  if (context === null) return null
  const percent = context.percent
  const reading = `${percent}%`
  const [headBefore = '', headAfter = ''] = t('context.aria', { percent: READING_SLOT })
    .split(READING_SLOT)
    .map(part => part.trim())

  // The bar's overall length stays the provider-exact percent; the heuristic
  // breakdown only proportions its colored parts. A zero-width part is dropped
  // instead of rendered: `.segment`'s min-width keeps a hairline part visible,
  // which at 0% occupancy would draw a filled bar over an empty context.
  const breakdownTotal = breakdown === undefined
    ? 0
    : breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens
  const parts = breakdown === undefined || breakdownTotal === 0
    ? [{ key: 'total', color: undefined, width: percent }]
    : ROWS.map(row => ({ key: row.key, color: row.color, width: percent * breakdown[row.key] / breakdownTotal }))
  const segments = parts.filter(part => part.width > 0)

  return (
    <span ref={rootRef} className={css.root}>
      <Tooltip label={t('context.aria', { percent: reading })} side="top" delayMs={200} disabled={open}>
        <button
          type="button"
          className={css.trigger}
          aria-label={t('context.aria', { percent: reading })}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => { setOpen(!open) }}
        >
          <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
            <circle className={css.track} cx="7" cy="7" r={RADIUS} />
            <circle
              className={css.fill}
              cx="7"
              cy="7"
              r={RADIUS}
              strokeDasharray={`${CIRCUMFERENCE * percent / 100} ${CIRCUMFERENCE}`}
              transform="rotate(-90 7 7)"
            />
          </svg>
        </button>
      </Tooltip>
      {open && (
        <div className={css.panel} role="dialog" aria-label={t('context.used')}>
          <div className={css.header}>
            {/* Empty sides collapse through `.headline:empty` so the locale that
                needs no leading (or trailing) text spends no header gap. */}
            <span className={css.headline}>{headBefore}</span>
            <span className={css.percent}>{reading}</span>
            <span className={css.headline}>{headAfter}</span>
            <span className={css.figures}>
              {`~${formatTokens(context.usedTokens)} / ${formatTokens(context.contextWindow)}`}
            </span>
          </div>
          <div className={css.bar}>
            {segments.map(segment => (
              <div
                key={segment.key}
                className={segment.color === undefined ? css.segment : `${css.segment} ${segment.color}`}
                style={{ width: `${segment.width}%` }}
              />
            ))}
          </div>
          <div className={css.compactionControls}>
            <label className={css.thresholdLabel}>
              <span>{t('context.compactionThreshold')}</span>
              <strong>{`${threshold}% · ~${formatTokens(Math.floor(context.contextWindow * threshold / 100))}`}</strong>
              <input
                type="range"
                min="25"
                max="95"
                step="5"
                value={threshold}
                aria-label={t('context.compactionThreshold')}
                onChange={(event) => {
                  const value = Number(event.currentTarget.value)
                  setThreshold(value)
                  if (typeof localStorage !== 'undefined') localStorage.setItem(COMPACTION_THRESHOLD_KEY, String(value))
                }}
              />
            </label>
            <button
              type="button"
              className={css.compactButton}
              disabled={compact === undefined || compacting || busy}
              onClick={runCompact}
            >
              {t(compacting ? 'context.compacting' : 'context.compactNow')}
            </button>
          </div>
          {breakdown !== undefined && (
            <dl className={css.rows}>
              {ROWS.map(row => (
                <div key={row.key} className={css.row}>
                  <dt>
                    <span className={`${css.swatch} ${row.color}`} aria-hidden />
                    {t(row.label)}
                  </dt>
                  <dd>{`~${formatTokens(breakdown[row.key])}`}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </span>
  )
}

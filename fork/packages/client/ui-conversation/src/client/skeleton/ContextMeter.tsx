/** Session composer context-occupancy meter: a ring beside the send button
 * fed by the `contextPressure` projection and scaled to the
 * automatic-compaction threshold. Hovering the ring swaps the stats line's
 * billing group for the heuristic composition (system prompt, tools,
 * messages); clicking opens a panel above the composer — the reading with its
 * `~used / capacity` figures, a proportion bar and composition rows from the
 * heuristic `contextBreakdown`, then the per-session limit slider, the
 * compaction threshold, and `Compact now` — which retracts after five idle
 * seconds, an outside click, or Escape. Renders nothing until a provider
 * reports both pressure and a route capacity. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { UseProjection } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the `contextPressure` / `contextBreakdown` projection key merges.
import type {} from '@deepseek-ai/dsh-token-meter/client'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ComposerBarProps } from '../contract/slots.ts'
import { contextMeterHover } from '../chat/context-hover.ts'
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

/** Idle span before the open panel closes. */
const PANEL_IDLE_MS = 5_000
/** Floor and step of the per-session limit slider; the routed window is the top. */
const LIMIT_MIN = 8_192
const LIMIT_STEP = 8_192

/** Composition rows of the panel, in bar-segment order; each color class carries the shared swatch/segment tint. */
const ROWS = [
  { key: 'systemTokens', label: 'context.system', color: css.colorSystem },
  { key: 'toolsTokens', label: 'context.tools', color: css.colorTools },
  { key: 'messageTokens', label: 'context.messages', color: css.colorMessages },
] as const

export interface ContextMeterProps {
  useProjection: UseProjection
  /** Host-backed automatic compaction threshold percentage. */
  threshold: number
  /** Persist one new automatic compaction threshold percentage. */
  setThreshold: (value: number) => void
  /** This session's absolute context cap in tokens, or null when uncapped. */
  sessionLimit?: number | null
  /** Set or clear the session's absolute context cap; absent hides the control. */
  setSessionLimit?: (tokens: number | null) => void
  /** Run the session's manual compaction command. */
  compact?: () => Promise<boolean>
  /** Whether a turn or manual compaction already owns the session. */
  busy?: boolean
  /** The owning bar's locale seat, passed down as a plain prop. */
  t: ComposerBarProps['t']
}

export function ContextMeter({
  useProjection, threshold, setThreshold, sessionLimit = null, setSessionLimit,
  compact, busy = false, t,
}: ContextMeterProps) {
  const pressure = useProjection('contextPressure')
  const breakdown = useProjection('contextBreakdown')
  const [open, setOpen] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const idleRef = useRef<number | null>(null)
  const context = contextOccupancy(pressure)
  const available = context !== null

  const runCompact = (): void => {
    if (compact === undefined || compacting || busy) return
    setCompacting(true)
    void compact().finally(() => { setCompacting(false) })
  }

  // The open panel closes after five seconds without input over the meter;
  // every pointer/keyboard interaction inside the root reschedules the timer,
  // and a running manual compaction holds the panel so its feedback stays
  // readable.
  const armIdle = useCallback(() => {
    if (idleRef.current !== null) window.clearTimeout(idleRef.current)
    idleRef.current = window.setTimeout(() => { setOpen(false) }, PANEL_IDLE_MS)
  }, [])
  useEffect(() => {
    if (!open || compacting) return
    armIdle()
    return () => {
      if (idleRef.current !== null) {
        window.clearTimeout(idleRef.current)
        idleRef.current = null
      }
    }
  }, [open, compacting, armIdle])

  // A model switch can temporarily remove capacity while this component stays
  // mounted. Close the now-unavailable panel instead of preserving stale UI.
  useEffect(() => {
    if (!available && open) setOpen(false)
  }, [available, open])

  // Outside click / Escape close, one document listener while open (Menu's pattern).
  useEffect(() => {
    if (!open) return
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
  }, [open])

  // Hovering the ring swaps the stats line's billing group for the heuristic
  // composition; leaving hands the strip back.
  const swapStats = (hovered: boolean): void => {
    contextMeterHover.set(hovered)
  }
  useEffect(() => () => { contextMeterHover.set(false) }, [])

  if (context === null) return null
  // Without a session cap this meter keeps its original reading: absolute
  // occupancy against the routed window, ring completing at the selected
  // threshold. A session cap becomes the binding constraint instead — both the
  // headline percentage and the ring then measure against what triggers that
  // session's compaction.
  const capped = sessionLimit !== null
  const capTokens = capped ? Math.min(sessionLimit, context.contextWindow) : context.contextWindow
  const percent = capped
    ? Math.min(100, Math.round(context.usedTokens / capTokens * 100))
    : context.percent
  const ringPercent = capped ? percent : Math.min(100, context.percent / threshold * 100)
  const reading = `${percent}%`
  const figures = `~${formatTokens(context.usedTokens)} / ${formatTokens(capTokens)}`
  const hoverLabel = `${t('context.aria', { percent: reading })} · ${figures}`
  const [headBefore = '', headAfter = ''] = t('context.aria', { percent: READING_SLOT })
    .split(READING_SLOT)
    .map(part => part.trim())

  // The bar's overall length stays the occupancy percent; the heuristic
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
    <span
      ref={rootRef}
      className={css.root}
      onPointerDown={open ? armIdle : undefined}
      onPointerMove={open ? armIdle : undefined}
      onKeyDown={open ? armIdle : undefined}
    >
      <Tooltip label={hoverLabel} side="top" delayMs={200} disabled={open}>
        <button
          type="button"
          className={css.trigger}
          aria-label={t('context.aria', { percent: reading })}
          aria-haspopup="dialog"
          aria-expanded={open}
          onPointerEnter={() => { swapStats(true) }}
          onPointerLeave={() => { swapStats(false) }}
          onClick={() => { setOpen(!open) }}
        >
          <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden>
            <circle className={css.track} cx="7" cy="7" r={RADIUS} />
            <circle
              className={css.fill}
              cx="7"
              cy="7"
              r={RADIUS}
              strokeDasharray={`${CIRCUMFERENCE * ringPercent / 100} ${CIRCUMFERENCE}`}
              transform="rotate(-90 7 7)"
            />
          </svg>
        </button>
      </Tooltip>
      {open && (
        <div className={css.panel} role="dialog" aria-label={t('context.aria', { percent: reading })}>
          <div className={css.header}>
            {/* Empty sides collapse through `.headline:empty` so the locale that
                needs no leading (or trailing) text spends no header gap. */}
            <span className={css.headline}>{headBefore}</span>
            <span className={css.percent}>{reading}</span>
            <span className={css.headline}>{headAfter}</span>
            <span className={css.figures}>{figures}</span>
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
          {breakdown !== undefined && breakdownTotal > 0 && (
            <div className={css.composition}>
              {ROWS.map(row => (
                <span key={row.key} className={css.compositionItem}>
                  <span className={`${css.swatch} ${row.color}`} aria-hidden />
                  <span className={css.compositionLabel}>{t(row.label)}</span>
                  <span className={css.compositionValue}>{`~${formatTokens(breakdown[row.key])}`}</span>
                </span>
              ))}
            </div>
          )}
          <div className={css.compactionControls}>
            {setSessionLimit !== undefined && (
              <label className={css.controlRow}>
                <span>{t('context.sessionLimit')}</span>
                <strong>
                  {sessionLimit === null ? t('context.sessionLimitOff') : `~${formatTokens(sessionLimit)}`}
                  {capped && (
                    <button
                      type="button"
                      className={css.limitClear}
                      aria-label={t('context.sessionLimitClear')}
                      onClick={() => { setSessionLimit(null) }}
                    >
                      ✕
                    </button>
                  )}
                </strong>
                <input
                  type="range"
                  className={css.slider}
                  min={Math.min(LIMIT_MIN, context.contextWindow)}
                  max={context.contextWindow}
                  step={LIMIT_STEP}
                  value={sessionLimit ?? context.contextWindow}
                  aria-label={t('context.sessionLimit')}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value)
                    // The routed window itself is the uncapped state: a cap
                    // equal to it would never bind, so it writes a clearing.
                    setSessionLimit(value >= context.contextWindow ? null : value)
                  }}
                />
              </label>
            )}
            <label className={css.controlRow}>
              <span>{t('context.compactionThreshold')}</span>
              <strong>{`${threshold}% · ~${formatTokens(Math.floor(context.contextWindow * threshold / 100))}`}</strong>
              <input
                type="range"
                className={css.slider}
                min="25"
                max="95"
                step="5"
                value={threshold}
                aria-label={t('context.compactionThreshold')}
                onChange={(event) => {
                  setThreshold(Number(event.currentTarget.value))
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
        </div>
      )}
    </span>
  )
}

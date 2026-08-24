// @vitest-environment jsdom
// ContextMeter (composer trailing control): occupancy ring gating, the
// click-open controls panel with its idle retraction, the per-session limit
// slider, and the hover swap feeding the stats line.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as commonEn, zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/index.ts'
import { ContextMeter, type ContextMeterProps } from '../src/client/skeleton/ContextMeter.tsx'
import css from '../src/client/skeleton/ContextMeter.module.css'
import { contextMeterHover } from '../src/client/chat/context-hover.ts'
import { en, zh } from '../src/client/locales.ts'
import { useState } from 'react'

afterEach(() => {
  cleanup()
  contextMeterHover.set(false)
  vi.useRealTimers()
})

// Mirrors the real lookup chain (conversation namespace, then common).
const t = makeTranslate(zh, commonZh) as ContextMeterProps['t']
const tEn = makeTranslate(en, commonEn) as ContextMeterProps['t']

const PRESSURE = { pressureTokens: 32_000, contextWindow: 128_000 }
const BREAKDOWN = { systemTokens: 120, toolsTokens: 21_500, messageTokens: 477_000 }

function projections(values: Record<string, unknown>): ContextMeterProps['useProjection'] {
  return (key: string) => values[key]
}

const segmentClass = css.segment
if (segmentClass === undefined) throw new Error('segment class missing from ContextMeter.module.css')

function MeterHarness({
  values, translate, compact, busy, onThreshold, sessionLimit, onSessionLimit,
}: {
  values: Record<string, unknown>
  translate: ContextMeterProps['t']
  compact?: ContextMeterProps['compact']
  busy: boolean
  onThreshold?: (value: number) => void
  sessionLimit?: ContextMeterProps['sessionLimit']
  onSessionLimit?: (tokens: number | null) => void
}) {
  const [threshold, setThreshold] = useState(80)
  // The real controller keeps a local echo of its own writes; mirror that so
  // controlled range inputs see a moving value across successive changes.
  const [limit, setLimit] = useState(sessionLimit ?? null)
  return (
    <ContextMeter
      useProjection={projections(values)}
      threshold={threshold}
      setThreshold={(value) => {
        setThreshold(value)
        onThreshold?.(value)
      }}
      sessionLimit={limit}
      {...onSessionLimit === undefined
        ? {}
        : {
            setSessionLimit: (tokens: number | null) => {
              setLimit(tokens)
              onSessionLimit?.(tokens)
            },
          }}
      {...compact === undefined ? {} : { compact }}
      busy={busy}
      t={translate}
    />
  )
}

function meter(
  values: Record<string, unknown>,
  translate: ContextMeterProps['t'] = t,
  compact?: ContextMeterProps['compact'],
  busy = false,
  onThreshold?: (value: number) => void,
  sessionLimit?: ContextMeterProps['sessionLimit'],
  onSessionLimit?: (tokens: number | null) => void,
) {
  return render(
    <MeterHarness
      values={values}
      translate={translate}
      {...compact === undefined ? {} : { compact }}
      busy={busy}
      {...onThreshold === undefined ? {} : { onThreshold }}
      {...sessionLimit === undefined ? {} : { sessionLimit }}
      {...onSessionLimit === undefined ? {} : { onSessionLimit }}
    />,
  )
}

describe('ContextMeter', () => {
  it('renders nothing until both pressure and capacity are known', () => {
    expect(meter({}).container.textContent).toBe('')
    expect(meter({ contextPressure: { pressureTokens: 32_000 } }).container.textContent).toBe('')
    expect(meter({ contextPressure: { contextWindow: 128_000 } }).container.textContent).toBe('')
  })

  it('shows the occupancy ring and toggles the controls panel on click', () => {
    const view = meter({ contextPressure: PRESSURE, contextBreakdown: BREAKDOWN })
    const trigger = view.getByRole('button', { name: '上下文已用 25%' })
    expect(view.container.querySelector('[role="dialog"]')).toBeNull()
    // Nothing sits beside the ring: collapsed, the meter is the ring alone.
    fireEvent.click(trigger)
    const panel = view.getByRole('dialog', { name: '上下文已用 25%' })
    // The headline keeps the reading intuitive: the sentence brackets the
    // percent and the figures name the denominator it is taken of.
    expect(panel.textContent).toContain('上下文已用')
    expect(panel.textContent).toContain('25%')
    expect(panel.textContent).toContain('~32K / 128K')
    // The proportion bar splits into one colored segment per composition row.
    expect(panel.getElementsByClassName(segmentClass)).toHaveLength(3)
    expect(panel.textContent).toContain('系统提示词~120')
    expect(panel.textContent).toContain('工具~21.5K')
    expect(panel.textContent).toContain('对话消息~477K')
    expect(panel.textContent).toContain('自动压缩阈值')
    expect(panel.textContent).toContain('立即压缩')
    fireEvent.click(trigger)
    expect(view.container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('falls back to one plain segment and no composition rows without the breakdown', () => {
    const view = meter({ contextPressure: PRESSURE })
    fireEvent.click(view.getByRole('button', { name: '上下文已用 25%' }))
    const panel = view.container.querySelector('[role="dialog"]')!
    expect(panel.getElementsByClassName(segmentClass)).toHaveLength(1)
    expect(panel.textContent).not.toContain('系统提示词')
    // The headline and figures still read.
    expect(panel.textContent).toContain('~32K / 128K')
  })

  it('draws no bar segment at zero occupancy', () => {
    const view = meter({
      contextPressure: { pressureTokens: 0, contextWindow: 128_000 },
      contextBreakdown: BREAKDOWN,
    })
    fireEvent.click(view.getByRole('button', { name: '上下文已用 0%' }))
    const panel = view.container.querySelector('[role="dialog"]')!
    // `.segment` carries a min-width, so a zero-width part would still paint a
    // filled sliver over an empty context.
    expect(panel.getElementsByClassName(segmentClass)).toHaveLength(0)
    expect(panel.textContent).toContain('~0 / 128K')
  })

  it('persists the Host threshold, updates the ring, and keeps manual compaction explicit', async () => {
    const compact = vi.fn().mockResolvedValue(true)
    const persist = vi.fn()
    const view = meter({ contextPressure: PRESSURE }, tEn, compact, false, persist)
    const trigger = view.getByRole('button', { name: '25% of context used' })
    const ringFill = trigger.querySelectorAll('circle')[1]
    if (ringFill === undefined) throw new Error('context ring fill missing')
    const initialDash = Number(ringFill.getAttribute('stroke-dasharray')?.split(' ')[0])
    fireEvent.click(trigger)
    const slider = view.getByRole('slider', { name: 'Automatic compaction threshold' })
    expect((slider as HTMLInputElement).value).toBe('80')
    fireEvent.change(slider, { target: { value: '25' } })
    const thresholdDash = Number(ringFill.getAttribute('stroke-dasharray')?.split(' ')[0])
    expect(thresholdDash).toBeCloseTo(initialDash * 80 / 25)
    expect(persist).toHaveBeenCalledWith(25)
    expect(compact).not.toHaveBeenCalled()
    fireEvent.click(await view.findByRole('button', { name: 'Compact now' }))
    await vi.waitFor(() => { expect(compact).toHaveBeenCalledTimes(1) })
  })

  it('caps the ring at a full turn when occupancy exceeds the selected threshold', () => {
    const view = meter({ contextPressure: { pressureTokens: 64_000, contextWindow: 128_000 } }, tEn)
    const trigger = view.getByRole('button', { name: '50% of context used' })
    fireEvent.click(trigger)
    const slider = view.getByRole('slider', { name: 'Automatic compaction threshold' })
    fireEvent.change(slider, { target: { value: '25' } })
    const ringFill = trigger.querySelectorAll('circle')[1]
    if (ringFill === undefined) throw new Error('context ring fill missing')
    const dash = ringFill.getAttribute('stroke-dasharray')?.split(' ').map(Number)
    if (dash === undefined || dash.length < 2) throw new Error('context ring dasharray missing')
    expect(dash[0]).toBeCloseTo(dash[1]!)
  })

  it('keeps only the explicit manual action disabled while the agent is busy', () => {
    const compact = vi.fn().mockResolvedValue(true)
    const persist = vi.fn()
    const view = meter({ contextPressure: PRESSURE }, tEn, compact, true, persist)
    fireEvent.click(view.getByRole('button', { name: '25% of context used' }))
    fireEvent.change(view.getByRole('slider', { name: 'Automatic compaction threshold' }), { target: { value: '25' } })
    expect(persist).toHaveBeenCalledWith(25)
    expect(compact).not.toHaveBeenCalled()
    expect((view.getByRole('button', { name: 'Compact now' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('reads the ring from the projected figure so a compaction shows at once', () => {
    // Same provider sample, a surface a compaction just shrank: the ring must
    // follow the projection rather than the sample it is anchored to.
    const view = meter({
      contextPressure: { pressureTokens: 32_000, projectedTokens: 3_000, contextWindow: 128_000 },
    })
    view.getByRole('button', { name: '上下文已用 2%' })
  })

  it('closes when capacity disappears and stays closed when it returns', () => {
    let values: Record<string, unknown> = { contextPressure: PRESSURE }
    const view = render(
      <ContextMeter useProjection={(key: string) => values[key]} threshold={80} setThreshold={() => {}} t={t} />,
    )
    fireEvent.click(view.getByRole('button', { name: '上下文已用 25%' }))
    expect(view.container.querySelector('[role="dialog"]')).not.toBeNull()

    values = { contextPressure: { pressureTokens: 32_000 } }
    view.rerender(
      <ContextMeter useProjection={(key: string) => values[key]} threshold={80} setThreshold={() => {}} t={t} />,
    )
    expect(view.container.textContent).toBe('')

    values = { contextPressure: PRESSURE }
    view.rerender(
      <ContextMeter useProjection={(key: string) => values[key]} threshold={80} setThreshold={() => {}} t={t} />,
    )
    expect(view.getByRole('button', { name: '上下文已用 25%' }).getAttribute('aria-expanded')).toBe('false')
    expect(view.container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('closes on outside pointerdown and Escape — but not inside clicks', () => {
    const view = meter({ contextPressure: PRESSURE })
    const trigger = view.getByRole('button', { name: '上下文已用 25%' })
    const openPanel = () => {
      fireEvent.click(trigger)
      return view.container.querySelector('[role="dialog"]')!
    }
    // A pointerdown inside the panel keeps it open; outside closes it.
    const again = openPanel()
    fireEvent.pointerDown(again)
    expect(view.container.querySelector('[role="dialog"]')).not.toBeNull()
    fireEvent.pointerDown(document.body)
    expect(view.container.querySelector('[role="dialog"]')).toBeNull()
    // Escape.
    openPanel()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(view.container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('reads occupancy against an active session cap and keeps the threshold slider window-relative', () => {
    const setLimit = vi.fn()
    // 16K used of a 128K window is 13% absolutely, but the 32K session cap
    // binds first: the headline reads 50% and its denominator is the cap.
    const view = meter(
      { contextPressure: { pressureTokens: 16_000, projectedTokens: 16_384, contextWindow: 128_000 } },
      tEn,
      undefined,
      false,
      undefined,
      32_768,
      setLimit,
    )
    fireEvent.click(view.getByRole('button', { name: '50% of context used' }))
    expect(view.container.querySelector('[role="dialog"]')!.textContent).toContain('Automatic compaction threshold')

    // Without a cap (null) the meter keeps the absolute reading and still
    // offers the slider.
    view.unmount()
    const uncapped = meter(
      { contextPressure: { pressureTokens: 16_000, contextWindow: 128_000 } },
      tEn,
      undefined,
      false,
      undefined,
      null,
      setLimit,
    )
    expect(uncapped.getByRole('button', { name: '13% of context used' })).toBeTruthy()

    // No setter injected (no-session arm): no cap control at all.
    uncapped.unmount()
    const inert = meter({ contextPressure: { pressureTokens: 16_000, contextWindow: 128_000 } }, tEn)
    fireEvent.click(inert.getByRole('button', { name: '13% of context used' }))
    expect(inert.container.querySelector('[role="dialog"]')!.textContent)
      .not.toContain('Session context limit')
  })

  it('sets a cap from the limit slider and treats the routed window as the off state', () => {
    const setLimit = vi.fn()
    const view = meter(
      { contextPressure: { pressureTokens: 0, contextWindow: 65_536 } },
      tEn,
      undefined,
      false,
      undefined,
      null,
      setLimit,
    )
    fireEvent.click(view.getByRole('button', { name: '0% of context used' }))
    const slider = view.getByRole('slider', { name: 'Session context limit' }) as HTMLInputElement
    expect(slider.max).toBe('65536')
    // Uncapped: the thumb rests at the routed window.
    expect(slider.value).toBe('65536')
    expect(view.container.querySelector('[role="dialog"]')!.textContent).toContain('Off')

    fireEvent.change(slider, { target: { value: '16384' } })
    expect(setLimit).toHaveBeenLastCalledWith(16_384)

    // Dragging back to the routed window writes a clearing: a cap equal to it
    // would never bind.
    fireEvent.change(slider, { target: { value: '65536' } })
    expect(setLimit).toHaveBeenLastCalledWith(null)
  })

  it('shows a non-step cap as-is next to an explicit clear button', () => {
    const setLimit = vi.fn()
    // 20K sits between the slider steps (settings.yaml value): displayed
    // verbatim, never normalized.
    const view = meter(
      { contextPressure: { pressureTokens: 0, projectedTokens: 3_200, contextWindow: 128_000 } },
      tEn,
      undefined,
      false,
      undefined,
      20_000,
      setLimit,
    )
    fireEvent.click(view.getByRole('button', { name: '16% of context used' }))
    expect(view.container.querySelector('[role="dialog"]')!.textContent).toContain('~20K')
    fireEvent.click(view.getByRole('button', { name: 'Clear limit' }))
    expect(setLimit).toHaveBeenLastCalledWith(null)
  })

  it('closes the open panel after five idle seconds', () => {
    vi.useFakeTimers()
    // The retraction render must flush inside act: React schedules it on the
    // same faked task queue these advances drive.
    const advance = (ms: number): void => { act(() => { vi.advanceTimersByTime(ms) }) }
    const view = meter({ contextPressure: PRESSURE }, tEn)
    fireEvent.click(view.getByRole('button', { name: '25% of context used' }))
    const panel = () => view.container.querySelector('[role="dialog"]')
    expect(panel()).not.toBeNull()
    // Activity over the meter reschedules the retraction.
    advance(4_000)
    fireEvent.pointerMove(panel()!)
    advance(4_000)
    expect(panel()).not.toBeNull()
    advance(1_000)
    expect(panel()).toBeNull()
  })

  it('holds the panel open while a manual compaction is running', async () => {
    vi.useFakeTimers()
    const advance = (ms: number): void => { act(() => { vi.advanceTimersByTime(ms) }) }
    let settle!: (value: boolean) => void
    const compact = vi.fn().mockImplementation(() => new Promise<boolean>((resolve) => { settle = resolve }))
    const view = meter({ contextPressure: PRESSURE }, tEn, compact)
    fireEvent.click(view.getByRole('button', { name: '25% of context used' }))
    fireEvent.click(view.getByRole('button', { name: 'Compact now' }))
    expect(view.getByRole('button', { name: 'Compacting…' })).toBeTruthy()
    // Far beyond the idle span: the running compaction keeps the panel up.
    advance(30_000)
    expect(view.container.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => { settle(true) })
    // Settled: the idle retraction applies again from the next arm.
    advance(5_000)
    expect(view.container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('flips the shared hover store while the ring is hovered so the stats line can swap', () => {
    const view = meter({ contextPressure: PRESSURE })
    const trigger = view.getByRole('button', { name: '上下文已用 25%' })
    expect(contextMeterHover.getSnapshot()).toBe(false)
    fireEvent.pointerEnter(trigger)
    expect(contextMeterHover.getSnapshot()).toBe(true)
    fireEvent.pointerLeave(trigger)
    expect(contextMeterHover.getSnapshot()).toBe(false)
  })
})

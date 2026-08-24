/**
 * ThinkRow: the reasoning disclosure presenter registered into the
 * `conversation.chat.reasoning` seat (shadowing ui-conversation's built-in
 * fallback row). Differences from the fallback: the summary line and the
 * expanded body render real markdown (emphasis, inline code, links — a raw
 * `**` never reaches the user), streaming shows live progress dots beside the
 * followed summary tail, and expand/collapse rides a grid-rows height
 * transition with a rotating chevron instead of a hard mount swap.
 */

import { memo, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import {
  firstRawLine, IconChevronDownOutline14, latestRawLine, MarkdownInline, MarkdownText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReasoningOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './ThinkRow.module.css'

/**
 * Render one assistant reasoning block as the animated Think disclosure.
 * @param props - The reasoning seat's owner share: block text, streaming-tail
 * flag, and the chat view's locale seat for the running announcement.
 * @returns the Think disclosure row.
 */
export const ThinkRow = memo(function ThinkRow({ text, running, t }: ReasoningOwnerProps) {
  const [expanded, setExpanded] = useState(false)
  const summaryRef = useRef<HTMLSpanElement>(null)
  const summary = running ? latestRawLine(text) : firstRawLine(text)

  // Follow the streaming tail: while running, keep the summary's hidden
  // overflow pinned to its end so the newest tokens stay visible; the
  // settled row restores the scrolled-to-start first line.
  useEffect(() => {
    if (!running) {
      const element = summaryRef.current
      if (element !== null) element.scrollLeft = 0
      return
    }
    let queued = false
    const follow = () => {
      queued = false
      const element = summaryRef.current
      if (element !== null) element.scrollLeft = element.scrollWidth - element.clientWidth
    }
    follow()
    const schedule = () => {
      if (queued) return
      queued = true
      requestAnimationFrame(follow)
    }
    schedule()
  }, [running, summary])

  const toggle = () => { setExpanded(value => !value) }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    toggle()
  }

  return (
    <div className={css.root} data-state={running ? 'running' : 'ok'} data-open={expanded || undefined}>
      {running && <span className={css.visuallyHidden}>{t('row.running')}</span>}
      <div
        className={css.row}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={toggle}
        onKeyDown={onKeyDown}
      >
        <span className={css.leading} aria-hidden>
          <IconChevronDownOutline14 className={css.chevron} />
        </span>
        <span className={css.title}>Think</span>
        <span className={css.separator} aria-hidden />
        <span ref={summaryRef} className={css.summary} data-follow-end={running || undefined}>
          <MarkdownInline text={summary} />
        </span>
        {running && (
          <span className={css.dots} aria-hidden>
            <i /><i /><i />
          </span>
        )}
      </div>
      <div className={css.collapse}>
        <div className={css.collapseInner}>
          <div className={css.body}>
            <MarkdownText text={text} streaming={running} />
          </div>
        </div>
      </div>
    </div>
  )
})

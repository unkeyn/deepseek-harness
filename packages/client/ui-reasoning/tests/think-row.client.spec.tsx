// @vitest-environment jsdom
// ThinkRow: the reasoning-seat presenter. Pins markdown rendering in the
// summary and body (no literal ** reaches the user), the expand/collapse
// state machine with its keyboard path, and the streaming-tail summary
// behavior (latest line while running, first line settled).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { zh } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import { ThinkRow } from '../src/client/ThinkRow.tsx'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh)
const props = (over: { text?: string; running?: boolean } = {}) => ({
  text: over.text ?? 'Inspect the session\nCheck **persistence**',
  running: over.running ?? false,
  t,
})

describe('ThinkRow', () => {
  it('renders the settled summary and body as real markdown', () => {
    const view = render(<ThinkRow {...props()} />)
    expect(view.getByText('Inspect the session')).toBeTruthy()
    expect(view.container.querySelector('strong')?.textContent).toBe('persistence')
    expect(view.container.textContent).not.toContain('**')
  })

  it('expands and collapses from the header row, revealing the markdown body', () => {
    const view = render(<ThinkRow {...props()} />)
    const row = view.getByRole('button')
    expect(row.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText('persistence')).toBeTruthy()

    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('false')
  })

  it('toggles from the keyboard on Enter and Space and ignores other keys', () => {
    const view = render(<ThinkRow {...props()} />)
    const row = view.getByRole('button')

    fireEvent.keyDown(row, { key: 'Enter' })
    expect(row.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(row, { key: ' ' })
    expect(row.getAttribute('aria-expanded')).toBe('false')
    fireEvent.keyDown(row, { key: 'Escape' })
    expect(row.getAttribute('aria-expanded')).toBe('false')
  })

  it('while streaming, shows the latest line, the running announcement, and the live dots', () => {
    const view = render(<ThinkRow {...props({ text: 'First thought\nNewest tokens', running: true })} />)
    expect(view.getByText('Newest tokens')).toBeTruthy()
    expect(view.getByText('运行中')).toBeTruthy()
    expect(view.container.querySelectorAll('i')).toHaveLength(3)
  })

  it('restores the first line and drops the dots once the block settles', () => {
    const view = render(<ThinkRow {...props({ text: 'First thought\nNewest tokens', running: true })} />)
    view.rerender(<ThinkRow {...props({ text: 'First thought\nNewest tokens\n' })} />)
    expect(view.getByText('First thought')).toBeTruthy()
    expect(view.queryByText('Newest tokens')).toBeNull()
    expect(view.container.querySelectorAll('i')).toHaveLength(0)
  })

  it('pins the streaming summary scroll to its end and resets it when settled', () => {
    const scrollLeftSetter = vi.fn()
    const view = render(<ThinkRow {...props({ text: 'tail', running: true })} />)
    // The collapsed body also renders the text (kept mounted for the height
    // transition), so scope the query to the header row.
    const summary = within(view.getByRole('button')).getByText('tail') as HTMLElement
    Object.defineProperties(summary, {
      scrollWidth: { configurable: true, value: 300 },
      clientWidth: { configurable: true, value: 100 },
      scrollLeft: { configurable: true, get: () => 0, set: scrollLeftSetter },
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    })
    view.rerender(<ThinkRow {...props({ text: 'tail tokens', running: true })} />)
    expect(scrollLeftSetter).toHaveBeenCalledWith(200)

    view.rerender(<ThinkRow {...props({ text: 'tail tokens' })} />)
    expect(scrollLeftSetter).toHaveBeenCalledWith(0)
    vi.unstubAllGlobals()
  })
})

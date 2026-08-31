// @vitest-environment jsdom
/** What the CHECK panel shows: the button, the two lists, and the keys themselves. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { KeyCheckPanel, type KeyCheckPanelProps } from '../src/client/KeyCheckPanel.tsx'
import type { KeyCheckEntry, KeyCheckState } from '../src/client/key-check-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

/** A key that is easy to assert is on screen verbatim. */
const KEY_GOOD = 'nvapi-aaaaaaaaaaaaaaaaaaaaaaaa'
const KEY_BAD = 'nvapi-bbbbbbbbbbbbbbbbbbbbbbbb'

const t = (key: keyof typeof en) => en[key]

/** The collapsed panel, before the button is pressed. */
function panelState(overrides: Partial<KeyCheckState> = {}): KeyCheckState {
  return {
    open: false,
    input: '',
    providers: [{ provider: 'nvidia', displayName: 'NVIDIA' }],
    ready: true,
    entries: [],
    running: false,
    error: null,
    checkedAt: null,
    ...overrides,
  }
}

/** One pasted row, as the controller resolves it. */
function entry(overrides: Partial<KeyCheckEntry> = {}): KeyCheckEntry {
  return { id: 'row-0', provider: 'nvidia', apiKey: KEY_GOOD, known: true, valid: false, ...overrides }
}

function renderPanel(state: KeyCheckState, actions = { toggle: vi.fn(), hide: vi.fn(), setInput: vi.fn(), run: vi.fn(), clear: vi.fn() }) {
  const props = {
    t,
    useKeyCheck: bindSnapshotSelector(createSnapshotStore<KeyCheckState>(state)),
    ...actions,
  } as unknown as KeyCheckPanelProps
  render(<KeyCheckPanel {...props} />)
  return actions
}

describe('KeyCheckPanel', () => {
  it('offers one CHECK button, collapsed, before it is pressed', () => {
    renderPanel(panelState())
    const button = screen.getByRole('button', { name: 'CHECK' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByLabelText(en.inputLabel)).toBeNull()
    expect(screen.queryByText(en.resultsLabel)).toBeNull()
  })

  it('expands both lists once it is pressed', () => {
    const actions = renderPanel(panelState({ open: true }))
    expect(screen.getByRole('button', { name: 'CHECK' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByLabelText(en.inputLabel)).toBeTruthy()
    expect(screen.getByText(en.resultsLabel)).toBeTruthy()
    // The button is the only way in or out of the lists.
    fireEvent.click(screen.getByRole('button', { name: en.hide }))
    expect(actions.hide).toHaveBeenCalled()
  })

  it('shows the pasted keys in the first list, as plain text', () => {
    renderPanel(panelState({
      open: true,
      input: `nvidia\t${KEY_GOOD}`,
      entries: [entry({ apiKey: KEY_GOOD })],
    }))
    // Masking the key here would hide the only thing the panel exists to show.
    expect(screen.getByText(KEY_GOOD).tagName).toBe('CODE')
  })

  it('shows a working key in the second list with valid on the right', () => {
    renderPanel(panelState({
      open: true,
      entries: [entry({ valid: true })],
      checkedAt: 1,
    }))
    // The key is on screen twice — once as pasted, once as accepted — so the
    // results row is found by the verdict that marks it, not by its text.
    const row = screen.getByText(en.valid).closest('li')
    expect(row?.textContent).toContain('nvidia')
    expect(row?.textContent).toContain(KEY_GOOD)
    expect(screen.getByText(en.resultsCount.replace('{count}', '1').replace('{total}', '1'))).toBeTruthy()
  })

  it('leaves the second list empty until a key has actually worked', () => {
    renderPanel(panelState({ open: true, entries: [entry({ valid: false, error: 'the provider rejected the key (HTTP 403)' })] }))
    expect(screen.getByText(en.resultsEmpty)).toBeTruthy()
    expect(screen.getByText(en.resultsLabel)).toBeTruthy()
  })

  it('says a provider the host cannot probe is not available, and counts it out', () => {
    renderPanel(panelState({
      open: true,
      entries: [entry({ provider: 'not-a-provider', apiKey: KEY_BAD, known: false })],
    }))
    expect(screen.getAllByText(en.unavailable).length).toBeGreaterThan(0)
    expect(screen.getByText(en.filteredCount.replace('{count}', '1'))).toBeTruthy()
  })

  it('reports a run failure once, at the foot of the lists', () => {
    renderPanel(panelState({ open: true, error: 'host down' }))
    expect(screen.getByText('host down')).toBeTruthy()
  })

  it('says nothing is checkable before the directory has arrived', () => {
    renderPanel(panelState({ open: true, ready: false }))
    expect(screen.getByText(en.directoryPending)).toBeTruthy()
  })

  it('disables the button while a run is in flight', () => {
    renderPanel(panelState({ running: true }))
    expect(screen.getByRole('button', { name: en.checking }).hasAttribute('disabled')).toBe(true)
  })

  it('routes typing in the buffer to the controller', () => {
    const actions = renderPanel(panelState({ open: true }))
    fireEvent.change(screen.getByLabelText(en.inputLabel), { target: { value: `nvidia\t${KEY_GOOD}` } })
    expect(actions.setInput).toHaveBeenCalledWith(`nvidia\t${KEY_GOOD}`)
  })

  it('routes CHECK and Clear to the controller', () => {
    const actions = renderPanel(panelState({ open: true }))
    fireEvent.click(screen.getByRole('button', { name: 'CHECK' }))
    fireEvent.click(screen.getByRole('button', { name: en.clear }))
    expect(actions.toggle).toHaveBeenCalled()
    expect(actions.clear).toHaveBeenCalled()
  })
})

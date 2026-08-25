// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModeSelect } from '../src/client/ModeSelect.tsx'
import type { ModeSelectProps } from '../src/client/ModeSelect.tsx'
import type { ModeAssignments } from '../src/client/ModeSelect.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

type ModeValue = { selected: string; angel: boolean } | undefined

const t = ((key: keyof typeof en, params?: Record<string, string>) => {
  let text: string = en[key]
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, value)
  }
  return text
}) as unknown as ModeSelectProps['t']

interface Harness {
  container: HTMLElement
  assignments: ReturnType<typeof vi.fn>
  assignModel: ReturnType<typeof vi.fn>
  clearModel: ReturnType<typeof vi.fn>
  setInstruction: ReturnType<typeof vi.fn>
  savePreset: ReturnType<typeof vi.fn>
  applyPreset: ReturnType<typeof vi.fn>
  deletePreset: ReturnType<typeof vi.fn>
  loadCatalog: ReturnType<typeof vi.fn>
  setAngel: ReturnType<typeof vi.fn>
}

function renderSelect(mode: ModeValue, options: {
  removed?: boolean
  assignments?: ModeAssignments
} = {}): Harness {
  const harness = {
    assignments: vi.fn(() => Promise.resolve(options.assignments ?? { models: {}, instructions: {}, presets: {} })),
    assignModel: vi.fn(() => Promise.resolve(null)),
    clearModel: vi.fn(() => Promise.resolve(null)),
    setInstruction: vi.fn(() => Promise.resolve(null)),
    savePreset: vi.fn(() => Promise.resolve(null)),
    applyPreset: vi.fn(() => Promise.resolve(null)),
    deletePreset: vi.fn(() => Promise.resolve(null)),
    loadCatalog: vi.fn(() => Promise.resolve([
      {
        provider: 'deepseek-official',
        name: 'DeepSeek',
        models: [
          { id: 'deepseek-chat', name: 'DeepSeek Chat' },
          { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', efforts: [{ id: 'off', name: 'Off' }, { id: 'high', name: 'High' }] },
        ],
      },
    ])),
    setAngel: vi.fn(() => Promise.resolve(null)),
  }
  const props = {
    session: { removed: options.removed ?? false },
    useProjection: (() => mode) as unknown as ModeSelectProps['useProjection'],
    ...harness,
    t,
  }
  const view = render(<ModeSelect {...props} /> as unknown as ModeSelectProps)
  return { container: view.container, ...harness }
}

async function openMenu(harness: Harness): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Agent mode, current: Default' }))
  await screen.findByRole('menu')
}

describe('ModeSelect', () => {
  it('render nothing while the agentMode projection is absent', () => {
    const { container } = renderSelect(undefined)
    expect(container.childElementCount).toBe(0)
  })

  it('show the effective mode on the trigger', () => {
    renderSelect({ selected: 'default', angel: false })
    expect(screen.getByRole('button', { name: 'Agent mode, current: Default' }).textContent).toContain('Default')
  })

  it('lock the trigger on a removed session', () => {
    renderSelect({ selected: 'default', angel: false }, { removed: true })
    expect((screen.getByRole('button', { name: 'Agent mode, current: Default' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('ModeMenu', () => {
  it('list the routed roster and the angel toggle without smol, big, or code', async () => {
    const h = renderSelect({ selected: 'default', angel: false })
    await openMenu(h)
    const rows = screen.getAllByRole('menuitem').map(item => item.textContent)
    expect(rows.some(text => text.startsWith('Default'))).toBe(true)
    expect(rows.some(text => text.startsWith('Agents'))).toBe(true)
    expect(rows.some(text => text.startsWith('Design'))).toBe(true)
    expect(rows.some(text => text.startsWith('Revisor'))).toBe(true)
    expect(rows.some(text => text.startsWith('Scout'))).toBe(true)
    expect(screen.getByRole('menuitemcheckbox', { name: 'Angel' })).toBeTruthy()
    expect(rows.some(text => text.includes('smol'))).toBe(false)
    expect(rows.some(text => text.includes('big'))).toBe(false)
    expect(rows.some(text => text.includes('Code'))).toBe(false)
  })

  it('show the assigned model dimmed beside the mode name', async () => {
    const h = renderSelect({ selected: 'default', angel: false }, {
      assignments: { models: { design: { provider: 'p', model: 'design-m' } }, instructions: {} },
    })
    await openMenu(h)
    await waitFor(() => expect(screen.getByText('design-m')).toBeTruthy())
  })

  it('mark the effective mode as checked', async () => {
    const h = renderSelect({ selected: 'scout', angel: false })
    fireEvent.click(screen.getByRole('button', { name: 'Agent mode, current: Scout' }))
    await screen.findByRole('menu')
    const scoutRow = screen.getAllByRole('menuitem').find(item => item.textContent?.startsWith('Scout'))
    expect(scoutRow?.querySelector('svg')).toBeTruthy()
  })

  it('open the animated catalog pane beside a hovered mode and assign a model on pick', async () => {
    const h = renderSelect({ selected: 'default', angel: false })
    await openMenu(h)
    const designRow = screen.getAllByRole('menuitem').find(item => item.textContent?.startsWith('Design'))
    fireEvent.mouseEnter(designRow!)
    await screen.findByText('DeepSeek')
    fireEvent.click(screen.getByRole('button', { name: 'DeepSeek Chat' }))
    await waitFor(() => expect(h.assignModel).toHaveBeenCalledWith('design', { provider: 'deepseek-official', model: 'deepseek-chat' }))
  })

  it('expand reasoning efforts under a model and assign the picked effort', async () => {
    const h = renderSelect({ selected: 'default', angel: false })
    await openMenu(h)
    const designRow = screen.getAllByRole('menuitem').find(item => item.textContent?.startsWith('Design'))
    fireEvent.mouseEnter(designRow!)
    fireEvent.click(await screen.findByRole('button', { name: 'DeepSeek Reasoner' }))
    fireEvent.click(await screen.findByRole('button', { name: 'High' }))
    await waitFor(() => expect(h.assignModel).toHaveBeenCalledWith('design', { provider: 'deepseek-official', model: 'deepseek-reasoner', reasoningEffort: 'high' }))
  })

  it('never activate a mode: hovering rows issues no command', async () => {
    const h = renderSelect({ selected: 'default', angel: false })
    await openMenu(h)
    const scoutRow = screen.getAllByRole('menuitem').find(item => item.textContent?.startsWith('Scout'))
    fireEvent.mouseEnter(scoutRow!)
    fireEvent.click(scoutRow!)
    await waitFor(() => expect(screen.getByText('DeepSeek')).toBeTruthy())
    expect(h.assignModel).not.toHaveBeenCalled()
    expect(h.setAngel).not.toHaveBeenCalled()
  })

  it('open the instruction editor from the pencil and save through the settings face', async () => {
    const h = renderSelect({ selected: 'default', angel: false }, {
      assignments: { models: {}, instructions: { scout: 'Look carefully.' }, presets: {} },
    })
    await openMenu(h)
    await waitFor(() => expect(h.assignments).toHaveBeenCalled())
    const scoutRow = screen.getAllByRole('menuitem').find(item => item.textContent?.startsWith('Scout'))
    const scoutPencil = scoutRow?.querySelector('button[title="Custom instruction"]')
    expect(scoutPencil).toBeTruthy()
    fireEvent.click(scoutPencil!)
    const area = await screen.findByDisplayValue('Look carefully.') as HTMLTextAreaElement
    fireEvent.change(area, { target: { value: 'Look even more carefully.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(h.setInstruction).toHaveBeenCalledWith('scout', 'Look even more carefully.'))
  })

  it('toggle the editor closed with a second pencil click', async () => {
    const h = renderSelect({ selected: 'default', angel: false })
    await openMenu(h)
    const scoutRow = screen.getAllByRole('menuitem').find(item => item.textContent?.startsWith('Scout'))
    const pencil = scoutRow?.querySelector('button[title="Custom instruction"]')
    fireEvent.click(pencil!)
    expect(await screen.findByPlaceholderText('Empty = built-in instruction')).toBeTruthy()
    fireEvent.click(scoutRow!.querySelector('button[title="Custom instruction"]')!)
    await waitFor(() => expect(screen.queryByPlaceholderText('Empty = built-in instruction')).toBeNull())
  })

  it('block hover-open of the catalog while the editor is pinned, and resume after closing', async () => {
    const h = renderSelect({ selected: 'default', angel: false })
    await openMenu(h)
    const rows = screen.getAllByRole('menuitem')
    const scoutRow = rows.find(item => item.textContent?.startsWith('Scout'))
    const designRow = rows.find(item => item.textContent?.startsWith('Design'))
    fireEvent.click(scoutRow!.querySelector('button[title="Custom instruction"]')!)
    await screen.findByPlaceholderText('Empty = built-in instruction')
    fireEvent.mouseEnter(designRow!)
    expect(screen.queryByText('DeepSeek')).toBeNull()
    fireEvent.click(scoutRow!.querySelector('button[title="Custom instruction"]')!)
    await waitFor(() => expect(screen.queryByPlaceholderText('Empty = built-in instruction')).toBeNull())
    fireEvent.mouseEnter(designRow!)
    await screen.findByText('DeepSeek')
  })

  it('mark the pencil of a mode with a saved custom instruction', async () => {
    const h = renderSelect({ selected: 'default', angel: false }, {
      assignments: { models: {}, instructions: { scout: 'custom words' }, presets: {} },
    })
    await openMenu(h)
    await waitFor(() => expect(h.assignments).toHaveBeenCalled())
    const scoutRow = screen.getAllByRole('menuitem').find(item => item.textContent?.startsWith('Scout'))
    expect(scoutRow?.querySelector('button[title="Custom instruction"]')?.className).toContain('pencilCustom')
    const defaultRow = screen.getAllByRole('menuitem').find(item => item.textContent?.startsWith('Default'))
    expect(defaultRow?.querySelector('button[title="Custom instruction"]')?.className).not.toContain('pencilCustom')
  })

  it('save, apply, and delete presets through the presets pane', async () => {
    const h = renderSelect({ selected: 'default', angel: false }, {
      assignments: {
        models: { design: { provider: 'p', model: 'm' } },
        instructions: { scout: 'words' },
        presets: { saved: { models: { design: { provider: 'p2', model: 'm2' } }, instructions: {} } },
      },
    })
    await openMenu(h)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Presets' }))
    const input = await screen.findByPlaceholderText('Preset name')
    fireEvent.change(input, { target: { value: 'my preset' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(h.savePreset).toHaveBeenCalledWith('my preset'))
    fireEvent.click(screen.getByRole('button', { name: 'apply' }))
    await waitFor(() => expect(h.applyPreset).toHaveBeenCalledWith('saved'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete saved' }))
    await waitFor(() => expect(h.deletePreset).toHaveBeenCalledWith('saved'))
  })

  it('toggle angel through the checkbox row', async () => {
    const h = renderSelect({ selected: 'default', angel: false })
    await openMenu(h)
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Angel' }))
    await waitFor(() => expect(h.setAngel).toHaveBeenCalledWith(true))
  })
})

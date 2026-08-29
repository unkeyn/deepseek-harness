// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  filterCandidateCategories,
  matchesModelCategory,
  ModelListEditor,
  type ModelCategoryFilters,
} from '../src/client/ModelListEditor.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const candidates = [
  { id: 'openai/gpt-4o' },
  { id: 'openai/gpt-4o-free' },
  { id: 'mystery/stealth-preview' },
  { id: 'anthropic/claude-3.7-sonnet' },
  { id: 'deepseek/deepseek-chat' },
  { id: 'mistral/mistral-large' },
]

const filters = (overrides: Partial<ModelCategoryFilters>): ModelCategoryFilters => ({
  free: 'neutral',
  gpt: 'neutral',
  claude: 'neutral',
  china: 'neutral',
  ...overrides,
})

function visibleIds(state: ModelCategoryFilters): string[] {
  return filterCandidateCategories(candidates, state).map(candidate => candidate.id)
}

function mountPicker() {
  const discoverModels = vi.fn(() => Promise.resolve({
    rpcId: 'category-filter' as never,
    result: { ok: true as const, value: { models: candidates } },
  }))
  render(
    <ModelListEditor
      models={[]}
      onChange={vi.fn()}
      probe={{ settingsNs: 'llm-pi-ai', provider: 'custom' }}
      api={{ llm: { discoverModels } } as never}
      t={key => en[key]}
      disabled={false}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: en.fetchModels }))
  return { discoverModels }
}

describe('fetched model category filters', () => {
  it('keeps Free and stealth together, ORs includes, and subtracts exclusions', () => {
    expect(matchesModelCategory({ id: 'promo', name: 'Stealth Free Preview' }, 'free')).toBe(true)
    expect(matchesModelCategory({ id: 'openrouter/qwen-3.5' }, 'china')).toBe(true)
    expect(visibleIds(filters({ free: 'include' }))).toEqual([
      'openai/gpt-4o-free',
      'mystery/stealth-preview',
    ])
    expect(visibleIds(filters({ gpt: 'include', claude: 'include' }))).toEqual([
      'openai/gpt-4o',
      'openai/gpt-4o-free',
      'anthropic/claude-3.7-sonnet',
    ])
    expect(visibleIds(filters({ china: 'exclude' }))).not.toContain('deepseek/deepseek-chat')
    expect(visibleIds(filters({ free: 'include', gpt: 'exclude' }))).toEqual([
      'mystery/stealth-preview',
    ])
  })

  it('uses left click for a check and right click for an exclusion cross', async () => {
    mountPicker()
    await waitFor(() => { expect(screen.getByText('6 / 6')).toBeTruthy() })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Free: off' }))
    expect(screen.getByRole('checkbox', { name: 'Free: included' }).textContent).toContain('✓')
    expect(screen.getByText('2 / 6')).toBeTruthy()
    expect(screen.getByText('openai/gpt-4o-free')).toBeTruthy()
    expect(screen.getByText('mystery/stealth-preview')).toBeTruthy()
    expect(screen.queryByText('openai/gpt-4o')).toBeNull()

    fireEvent.contextMenu(screen.getByRole('checkbox', { name: 'GPT: off' }))
    expect(screen.getByRole('checkbox', { name: 'GPT: excluded' }).textContent).toContain('×')
    expect(screen.getByText('1 / 6')).toBeTruthy()
    expect(screen.queryByText('openai/gpt-4o-free')).toBeNull()
    expect(screen.getByText('mystery/stealth-preview')).toBeTruthy()

    fireEvent.contextMenu(screen.getByRole('checkbox', { name: 'GPT: excluded' }))
    expect(screen.getByText('2 / 6')).toBeTruthy()

    fireEvent.contextMenu(screen.getByRole('checkbox', { name: 'Free: included' }))
    expect(screen.getByRole('checkbox', { name: 'Free: excluded' }).textContent).toContain('×')
    expect(screen.getByText('4 / 6')).toBeTruthy()
  })
})

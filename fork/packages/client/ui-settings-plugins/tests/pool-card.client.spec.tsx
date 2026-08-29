// @vitest-environment jsdom
/** What the search-providers panel shows: rows, the expanded editor, and the check state. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { CustomWebSearchPoolCard } from '../src/client/CustomWebSearchPoolCard.tsx'
import type { CustomWebSearchPoolCardProps } from '../src/client/CustomWebSearchPoolCard.tsx'
import type { PoolCardState } from '../src/client/custom-web-search-pool-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

function poolState(overrides: Partial<PoolCardState> = {}): PoolCardState {
  return {
    available: true,
    writable: true,
    dirty: false,
    saving: false,
    failed: false,
    error: null,
    invalid: false,
    providers: [{
      id: 'firecrawl', name: 'Firecrawl', priority: 0, endpoint: 'https://api.firecrawl.dev/v2/search', method: 'POST',
      queryParam: 'query', requestBody: 'query', authMode: 'bearer', authName: 'authorization',
      responseResultsPath: 'data.web', resultUrlPath: 'url', resultTitlePath: 'title', resultSnippetPath: 'description',
      resultDatePath: 'publishedAt',
      keys: [
        { id: 'firecrawl-key-1', ref: 'FIRECRAWL_API_KEY', enabled: true, priority: 0, maxConcurrent: 1, secret: '', originalRef: 'FIRECRAWL_API_KEY', configured: true },
      ],
      enabled: true,
    }],
    availablePresets: ['brave', 'exa'],
    maxAttempts: '3',
    cooldownMs: '30000',
    checking: null,
    ...overrides,
  }
}

function face() {
  return {
    addProvider: vi.fn(), removeProvider: vi.fn(), addKey: vi.fn(), removeKey: vi.fn(),
    editKey: vi.fn(), editGlobal: vi.fn(), check: vi.fn(), save: vi.fn(), discard: vi.fn(),
    refresh: vi.fn(), refreshCredential: vi.fn(),
  }
}

function renderCard(state: PoolCardState, actions = face()) {
  const props = {
    t,
    useWebSearchPool: bindSnapshotSelector(createSnapshotStore<PoolCardState>(state)),
    ...actions,
  } as unknown as CustomWebSearchPoolCardProps
  render(<CustomWebSearchPoolCard {...props} />)
  return actions
}

describe('CustomWebSearchPoolCard', () => {
  it('renders one row per provider with its key count and credential dot', () => {
    renderCard(poolState())
    expect(screen.getByText('Firecrawl')).toBeDefined()
    expect(screen.getByText('1 key')).toBeDefined()
    expect(screen.getByRole('img', { name: 'Ready' })).toBeDefined()
  })

  it('renders nothing while the namespace is unavailable', () => {
    renderCard(poolState({ available: false }))
    expect(screen.queryByText('Firecrawl')).toBeNull()
  })

  it('expands the key editor with the endpoint caption and a check action', () => {
    renderCard(poolState())
    fireEvent.click(screen.getByRole('button', { name: 'Edit: Firecrawl' }))
    expect(screen.getByText('https://api.firecrawl.dev/v2/search')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Check keys' })).toBeDefined()
    expect(screen.getByText('API key 1')).toBeDefined()
  })

  it('shows a valid check result with remaining credits', () => {
    const state = poolState()
    state.providers[0]!.keys[0]!.check = { valid: true, status: 200, remaining: 490, limit: 500 }
    renderCard(state)
    fireEvent.click(screen.getByRole('button', { name: 'Edit: Firecrawl' }))
    expect(screen.getByText('Valid · 490/500 credits')).toBeDefined()
  })

  it('shows an invalid check result and its redacted reason', () => {
    const state = poolState()
    state.providers[0]!.keys[0]!.check = { valid: false, status: 401, error: 'key rejected (HTTP 401)' }
    renderCard(state)
    fireEvent.click(screen.getByRole('button', { name: 'Edit: Firecrawl' }))
    expect(screen.getByText('Invalid')).toBeDefined()
    expect(screen.getByText('key rejected (HTTP 401)')).toBeDefined()
  })

  it('asks the controller to check the provider and gates on unsaved edits', () => {
    const actions = renderCard(poolState())
    fireEvent.click(screen.getByRole('button', { name: 'Edit: Firecrawl' }))
    const check = screen.getByRole('button', { name: 'Check keys' }) as HTMLButtonElement
    expect(check.disabled).toBe(false)
    fireEvent.click(check)
    expect(actions.check).toHaveBeenCalledWith('firecrawl')
    const dirty = poolState({ dirty: true })
    cleanup()
    renderCard(dirty)
    fireEvent.click(screen.getByRole('button', { name: 'Edit: Firecrawl' }))
    expect((screen.getByRole('button', { name: 'Check keys' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers the add-provider flow through the dashed button and select', () => {
    const actions = renderCard(poolState())
    fireEvent.click(screen.getByRole('button', { name: 'Add provider' }))
    const select = screen.getByLabelText('Add provider') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'brave' } })
    expect(actions.addProvider).toHaveBeenCalledWith('brave')
  })

  it('saves and discards through the shared footer', () => {
    const actions = renderCard(poolState({ dirty: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(actions.save).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(actions.discard).toHaveBeenCalled()
  })
})

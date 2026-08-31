// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { OAuthGridCard } from '../src/client/OAuthGridCard.tsx'
import type { OAuthGridCardProps } from '../src/client/OAuthGridCard.tsx'
import type { AuthorizationAttemptView, AuthorizationFlowView } from '@deepseek-ai/dsh-fork-authorization-controller/types'
import type { OAuthGridCardState } from '../src/client/authorization-grid-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const anthropic: AuthorizationFlowView = {
  key: 'llm-pi-ai/anthropic',
  label: 'Anthropic',
  methods: [{ id: 'oauth', label: 'Sign in with Anthropic' }],
  inFlight: false,
}

const openAi: AuthorizationFlowView = {
  key: 'llm-pi-ai/openai-codex',
  label: 'OpenAI Codex',
  methods: [{ id: 'oauth', label: 'Sign in with OpenAI' }],
  inFlight: false,
}

const attempt: AuthorizationAttemptView = {
  attemptId: 'attempt-1',
  key: anthropic.key,
  label: anthropic.label,
  method: 'oauth',
  status: 'authorized',
  revision: 1,
}

describe('OAuthGridCard', () => {
  const t = (key: keyof typeof en) => en[key]

  function renderGrid(flows: readonly AuthorizationFlowView[] = [anthropic, openAi]) {
    const actions = {
      start: vi.fn(),
      answer: vi.fn(),
      cancel: vi.fn(),
      refreshAccounts: vi.fn(async () => {}),
      removeAccount: vi.fn(async () => {}),
      fetchLimits: vi.fn(async () => {}),
    }
    const state: OAuthGridCardState = {
      loaded: true,
      loading: false,
      flows,
      attempts: { [attempt.attemptId]: attempt },
      errors: {},
      accounts: {
        loaded: true,
        accounts: [],
        errors: {},
        reports: {},
      },
    }
    const props = {
      t,
      useAuthorization: bindSnapshotSelector(createSnapshotStore(state)),
      ...actions,
    } as unknown as OAuthGridCardProps
    render(createElement(OAuthGridCard, props))
    return actions
  }

  it('renders one cell per provider and no drawer by default', () => {
    renderGrid()
    expect(screen.getByRole('button', { name: /Anthropic/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /OpenAI Codex/ })).toBeDefined()
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('opens the horizontal drawer when a provider card is clicked', () => {
    renderGrid()
    fireClick(screen.getByRole('button', { name: /Anthropic/ }))
    const region = screen.getByRole('region', { name: /Anthropic/ })
    expect(region).toBeDefined()
    expect(region.querySelector('[role="list"]')).toBeDefined()
  })

  it('lists accounts and reloads them when the drawer toggles', () => {
    const stateWithAccounts: OAuthGridCardState = {
      loaded: true,
      loading: false,
      flows: [anthropic],
      attempts: {},
      errors: {},
      accounts: {
        loaded: true,
        accounts: [{
          id: `${anthropic.key}#acct-1`,
          providerKey: anthropic.key,
          accountId: 'acct-1',
          email: 'adie@anthropic.example',
          status: 'active',
        }],
        errors: {},
        reports: {},
      },
    }
    const actions = {
      start: vi.fn(),
      answer: vi.fn(),
      cancel: vi.fn(),
      refreshAccounts: vi.fn(async () => {}),
      removeAccount: vi.fn(async () => {}),
      fetchLimits: vi.fn(async () => {}),
    }
    const props = {
      t,
      useAuthorization: bindSnapshotSelector(createSnapshotStore(stateWithAccounts)),
      ...actions,
    } as unknown as OAuthGridCardProps
    render(createElement(OAuthGridCard, props))
    fireClick(screen.getByRole('button', { name: /Anthropic/ }))
    expect(actions.refreshAccounts).toHaveBeenCalledWith(anthropic.key)
    expect(screen.getByText('adie@anthropic.example')).toBeDefined()
    expect(screen.getByRole('button', { name: /Refresh limits/ })).toBeDefined()
    expect(screen.getByRole('button', { name: /Remove/ })).toBeDefined()
  })
})

function fireClick(target: HTMLElement): void {
  const event = new window.MouseEvent('click', { bubbles: true, cancelable: true })
  target.dispatchEvent(event)
}

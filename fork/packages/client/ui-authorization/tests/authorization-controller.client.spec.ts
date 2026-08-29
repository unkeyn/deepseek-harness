// @vitest-environment jsdom

import { createElement } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { AuthorizationCard } from '../src/client/AuthorizationCard.tsx'
import type { AuthorizationCardProps } from '../src/client/AuthorizationCard.tsx'
import { AuthorizationCardController } from '../src/client/authorization-controller.ts'
import type { AuthorizationFlowView, AuthorizationAttemptView } from '@deepseek-ai/dsh-fork-authorization-controller/types'
import type { AuthorizationCardState } from '../src/client/authorization-controller.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const flow: AuthorizationFlowView = {
  key: 'llm-pi-ai/openai-codex',
  label: 'ChatGPT (Codex)',
  methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
  inFlight: false,
}

const attempt: AuthorizationAttemptView = {
  attemptId: 'attempt-1',
  key: flow.key,
  label: flow.label,
  method: 'oauth',
  status: 'authorized',
  revision: 1,
}

describe('AuthorizationCardController', () => {
  it('loads flows, starts an attempt, and releases it on terminal state', async () => {
    const api = {
      list: vi.fn(async () => ({ ok: true as const, value: [flow] })),
      start: vi.fn(async () => ({ ok: true as const, value: { attemptId: attempt.attemptId } })),
      state: vi.fn(async () => ({ ok: true as const, value: attempt })),
      answer: vi.fn(),
      cancel: vi.fn(),
    }
    const controller = new AuthorizationCardController(api)

    await vi.waitFor(() => expect(controller.store.getSnapshot().flows).toEqual([flow]))
    controller.start(flow, 'oauth')
    await vi.waitFor(() => expect(api.start).toHaveBeenCalledWith(flow.key, 'oauth'))
    await vi.waitFor(() => expect(api.state).toHaveBeenCalledWith(attempt.attemptId))
    await vi.waitFor(() => expect(controller.store.getSnapshot().attempts[attempt.attemptId]).toEqual(attempt))

    controller.dispose()
    expect(controller.store.getSnapshot().attempts[attempt.attemptId]).toEqual(attempt)
  })
})

describe('AuthorizationCard', () => {
  const t = (key: keyof typeof en) => en[key]

  function renderCard(flows: readonly AuthorizationFlowView[] = [flow, {
    key: 'llm-pi-ai/anthropic',
    label: 'Anthropic',
    methods: [{ id: 'oauth', label: 'Sign in with Anthropic' }],
    inFlight: false,
  }]) {
    const actions = { start: vi.fn(), answer: vi.fn(), cancel: vi.fn() }
    const state: AuthorizationCardState = { loaded: true, loading: false, flows, attempts: {}, errors: {} }
    const props = {
      t,
      useAuthorization: bindSnapshotSelector(createSnapshotStore(state)),
      ...actions,
    } as unknown as AuthorizationCardProps
    render(createElement(AuthorizationCard, props))
    return actions
  }

  it('starts compact with one collapsed row per OAuth flow', () => {
    renderCard()
    const first = screen.getByRole('button', { name: /ChatGPT \(Codex\)/ })
    const second = screen.getByRole('button', { name: /Anthropic/ })
    expect(first.getAttribute('aria-expanded')).toBe('false')
    expect(second.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()
  })

  it('opens the selected flow and starts OAuth from its expanded details', () => {
    const actions = renderCard()
    fireEvent.click(screen.getByRole('button', { name: /ChatGPT \(Codex\)/ }))
    expect(screen.getByText('Sign in with ChatGPT')).toBeDefined()
    const start = screen.getByRole('button', { name: 'Sign in' })
    fireEvent.click(start)
    expect(actions.start).toHaveBeenCalledWith(flow, 'oauth')
  })

  it('keeps only one OAuth flow expanded at a time', () => {
    renderCard()
    const first = screen.getByRole('button', { name: /ChatGPT \(Codex\)/ })
    const second = screen.getByRole('button', { name: /Anthropic/ })
    fireEvent.click(first)
    expect(first.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(second)
    expect(first.getAttribute('aria-expanded')).toBe('false')
    expect(second.getAttribute('aria-expanded')).toBe('true')
  })
})

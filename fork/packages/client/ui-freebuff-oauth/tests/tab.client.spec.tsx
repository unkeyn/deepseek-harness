// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { FreebuffOAuthTab } from '../src/client/FreebuffOAuthTab.tsx'
import type { FreebuffOAuthTabProps } from '../src/client/FreebuffOAuthTab.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en) => en[key]

function renderTab(state: Parameters<typeof createSnapshotStore>[0]) {
  const store = createSnapshotStore(state)
  render(<FreebuffOAuthTab
    t={t}
    useOauth={bindSnapshotSelector(store)}
    beginLogin={vi.fn()}
    completeLogin={vi.fn()}
    logout={vi.fn()}
    refresh={vi.fn()}
    openDesktop={vi.fn()}
  /> as unknown as FreebuffOAuthTabProps)
}

describe('FreebuffOAuthTab', () => {
  it('renders the local Harness Desktop launcher', () => {
    renderTab({ status: 'signed-out' })

    expect(screen.getByRole('button', { name: en.openDesktop })).toBeTruthy()
  })

  it('renders connected account actions', () => {
    renderTab({ status: 'connected', account: { accountId: 'account-1', displayName: 'Freebuff User', status: 'active' } })

    expect(screen.getByText('Freebuff User')).toBeTruthy()
    expect(screen.getByText(en.connected)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.logout })).toBeTruthy()
  })

  it('renders the pending login link and completion action', () => {
    renderTab({ status: 'pending', loginUrl: 'https://freebuff.com/login/device' })

    expect(screen.getByRole('link', { name: en.openFreebuff }).getAttribute('href')).toBe('https://freebuff.com/login/device')
    expect(screen.getByRole('button', { name: en.completeLogin })).toBeTruthy()
  })
})

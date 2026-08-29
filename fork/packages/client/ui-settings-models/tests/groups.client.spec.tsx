// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ModelsSettingsTabs } from '../src/client/ModelsGroups.tsx'

afterEach(cleanup)

const tabs = [
  { id: 'api', title: 'API', description: 'API keys', render: () => <p>API body</p> },
  { id: 'bearer', title: 'Bearer', description: 'Bearer tokens', render: () => <p>Bearer body</p> },
  { id: 'oauth', title: 'OAuth', description: 'Browser accounts', render: () => <p>OAuth body</p> },
  { id: 'search', title: 'Search', description: 'Web search', render: () => <p>Search body</p> },
]

describe('ModelsSettingsTabs', () => {
  it('renders the four Plugins-style tabs and shows only the active panel', () => {
    render(<ModelsSettingsTabs tabs={tabs} initialActiveId="api" unavailableText="Unavailable" ariaLabel="Model categories" />)
    const api = screen.getByRole('tab', { name: 'API' })
    const bearer = screen.getByRole('tab', { name: 'Bearer' })
    const oauth = screen.getByRole('tab', { name: 'OAuth' })
    const search = screen.getByRole('tab', { name: 'Search' })

    expect(api.getAttribute('aria-selected')).toBe('true')
    expect(bearer.getAttribute('aria-selected')).toBe('false')
    expect(oauth.getAttribute('aria-selected')).toBe('false')
    expect(search.getAttribute('aria-selected')).toBe('false')
    expect(screen.getByText('API body')).toBeTruthy()
    expect(screen.queryByText('OAuth body')).toBeNull()

    fireEvent.click(oauth)
    expect(api.getAttribute('aria-selected')).toBe('false')
    expect(oauth.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByText('OAuth body')).toBeTruthy()

    fireEvent.click(search)
    expect(oauth.getAttribute('aria-selected')).toBe('false')
    expect(search.getAttribute('aria-selected')).toBe('true')
  })

  it('shows a deployment message for an unavailable group after it is opened', () => {
    render(<ModelsSettingsTabs tabs={[{ id: 'bearer', title: 'Bearer', description: 'Bearer tokens' }]} unavailableText="Unavailable" ariaLabel="Model categories" />)
    expect(screen.getByText('Unavailable')).toBeTruthy()
  })
})

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CustomProviderCard } from '../src/client/CustomProviderCard.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = (key: keyof typeof en): string => en[key]

function ok<T>(value: T) {
  return { rpcId: 'bearer-form' as never, result: { ok: true as const, value } }
}

function mountBearerCard() {
  const mutate = vi.fn(() => Promise.resolve(ok({})))
  const set = vi.fn(() => Promise.resolve(ok({})))
  const onClose = vi.fn()
  const api = {
    settings: { mutate },
    credentials: { set },
    llm: { discoverModels: vi.fn(() => Promise.resolve(ok({ models: [] }))) },
  }
  render(
    <CustomProviderCard
      taken={[]}
      protocols={['bearer-chat']}
      authorization="bearer"
      namespace="llm-bearer"
      revision={7}
      api={api as never}
      t={t}
      readOnly={false}
      onClose={onClose}
    />,
  )
  return { mutate, set, onClose }
}

describe('Bearer provider form', () => {
  it('makes generic cookie import primary and keeps manual fields hidden initially', () => {
    mountBearerCard()

    expect(screen.getByLabelText(en.cookieImport)).toBeTruthy()
    expect(screen.getByLabelText(en.chatEndpoint)).toBeTruthy()
    expect(screen.getByLabelText(en.modelsEndpoint)).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>(`${en.modelId} 1`).value).toBe('auto')
    expect(screen.queryByLabelText(en.bearerInput)).toBeNull()
    expect(screen.queryByLabelText(en.refreshInput)).toBeNull()
    expect(screen.queryByLabelText(en.refreshApiKey)).toBeNull()
    expect(document.body.textContent?.toLowerCase()).not.toContain('twinmind')

    fireEvent.click(screen.getByRole('button', { name: en.manualCredentials }))
    expect(screen.getByLabelText(en.bearerInput)).toBeTruthy()
    expect(screen.getByLabelText(en.autoRefresh)).toBeTruthy()
  })

  it('creates a route from a provider-neutral cookie export and exact endpoints', async () => {
    const { mutate, set, onClose } = mountBearerCard()

    fireEvent.change(screen.getByLabelText(en.customRoute), { target: { value: 'acme' } })
    fireEvent.change(screen.getByLabelText(en.chatEndpoint), { target: { value: 'https://chat.acme.example/v3/stream/' } })
    fireEvent.change(screen.getByLabelText(en.modelsEndpoint), { target: { value: 'https://chat.acme.example/v3/models/' } })
    fireEvent.change(screen.getByLabelText(en.cookieImport), {
      target: { value: JSON.stringify([{ name: 'access_token', value: 'cookie-access', domain: 'acme.example' }]) },
    })
    fireEvent.click(screen.getByRole('button', { name: en.cookieImportAction }))
    await waitFor(() => expect(screen.getByText(en.create)).toBeTruthy())
    fireEvent.click(screen.getByText(en.create))

    await waitFor(() => { expect(onClose).toHaveBeenCalledWith(true) })
    expect(mutate).toHaveBeenCalledWith({
      ns: 'llm-bearer',
      ops: [{
        op: 'set',
        path: ['providers', 'acme'],
        value: {
          auth: { type: 'bearer', accessTokenEnv: 'ACME_BEARER_TOKEN' },
          api: 'bearer-chat',
          chatURL: 'https://chat.acme.example/v3/stream/',
          modelsURL: 'https://chat.acme.example/v3/models/',
          models: [{ id: 'auto' }],
        },
      }],
      expectedRevision: 7,
    })
    expect(set).toHaveBeenCalledWith({ ref: 'ACME_BEARER_TOKEN', value: 'cookie-access' })
  })

  it('reveals refresh configuration only when an imported cookie needs it', async () => {
    const { mutate, set, onClose } = mountBearerCard()

    fireEvent.change(screen.getByLabelText(en.customRoute), { target: { value: 'refreshing' } })
    fireEvent.change(screen.getByLabelText(en.chatEndpoint), { target: { value: 'https://chat.example/stream' } })
    fireEvent.change(screen.getByLabelText(en.cookieImport), {
      target: { value: JSON.stringify([
        { name: 'session', value: 'access-value' },
        { name: 'refresh_token', value: 'refresh-value' },
      ]) },
    })
    fireEvent.click(screen.getByRole('button', { name: en.cookieImportAction }))

    await waitFor(() => expect(screen.getByLabelText(en.refreshEndpoint)).toBeTruthy())
    expect(screen.getByLabelText(en.refreshInput)).toBeTruthy()
    expect(screen.getByLabelText(en.refreshApiKey)).toBeTruthy()
    expect(screen.getByText(en.create).closest('button')?.disabled).toBe(true)

    fireEvent.change(screen.getByLabelText(en.refreshEndpoint), { target: { value: 'https://auth.example/token' } })
    fireEvent.change(screen.getByLabelText(en.refreshApiKey), { target: { value: 'public-key' } })
    fireEvent.click(screen.getByText(en.create))

    await waitFor(() => { expect(onClose).toHaveBeenCalledWith(true) })
    expect(mutate.mock.calls[0]?.[0]).toMatchObject({
      ops: [{ value: { auth: { refresh: {
        endpoint: 'https://auth.example/token',
        refreshTokenEnv: 'REFRESHING_REFRESH_TOKEN',
        apiKey: 'public-key',
      } } } }],
    })
    expect(set).toHaveBeenCalledWith({ ref: 'REFRESHING_BEARER_TOKEN', value: 'access-value' })
    expect(set).toHaveBeenCalledWith({ ref: 'REFRESHING_REFRESH_TOKEN', value: 'refresh-value' })
  })

  it('refreshes a recognized Firebase session cookie before storing it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id_token: 'fresh-id-token',
      refresh_token: 'rotated-refresh-token',
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    mountBearerCard()

    fireEvent.change(screen.getByLabelText(en.cookieImport), {
      target: { value: JSON.stringify([
        { name: 'session', value: 'session-value', domain: 'app.twinmind.com' },
        { name: 'firebase_refresh_token', value: 'refresh-value', domain: 'app.twinmind.com' },
      ]) },
    })
    fireEvent.click(screen.getByRole('button', { name: en.cookieImportAction }))

    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>(en.refreshEndpoint).value)
      .toBe('https://securetoken.googleapis.com/v1/token'))
    expect(screen.getByLabelText<HTMLInputElement>(en.refreshApiKey).value)
      .toBe('AIzaSyD2Sd_NP3vA4rwvoroKqDefpXZeCMDXcIQ')
    expect(screen.getByLabelText<HTMLInputElement>(en.bearerInput).value).toBe('fresh-id-token')
    expect(screen.getByLabelText<HTMLInputElement>(en.refreshInput).value).toBe('rotated-refresh-token')
    expect(globalThis.fetch).toHaveBeenCalledOnce()
  })

  it('stores the provider-neutral MCP bridge opt-in and its endpoint', async () => {
    const { mutate, onClose } = mountBearerCard()

    fireEvent.change(screen.getByLabelText(en.customRoute), { target: { value: 'twinmind' } })
    fireEvent.change(screen.getByLabelText(en.chatEndpoint), { target: { value: 'https://api2.twinmind.com/api/v3/chat' } })
    fireEvent.click(screen.getByLabelText(en.mcpBridge))

    expect(screen.getByLabelText<HTMLInputElement>(en.mcpBridgeEndpoint).value)
      .toBe('https://api.twinmind.com/mcp/v1')
    fireEvent.change(screen.getByLabelText(en.cookieImport), {
      target: { value: JSON.stringify([{ name: 'access_token', value: 'bridge-access' }]) },
    })
    fireEvent.click(screen.getByRole('button', { name: en.cookieImportAction }))
    await waitFor(() => expect(screen.getByText(en.create)).toBeTruthy())
    fireEvent.click(screen.getByText(en.create))

    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true))
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      ops: [{ op: 'set', path: ['providers', 'twinmind'], value: expect.objectContaining({
        mcpBridge: {
          enabled: true,
          endpoint: 'https://api.twinmind.com/mcp/v1',
          tokenExchange: true,
        },
      }) }],
    }))
  })
})

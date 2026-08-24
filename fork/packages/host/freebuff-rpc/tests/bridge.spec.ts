import { describe, expect, it, vi } from 'vitest'
import type { ApiProxy } from '@deepseek-ai/dsh-fork-host-apiproxy/api'
import type { Context } from '@deepseek-ai/cordis'
import { apply, createFreebuffFetchHandler } from '../src/index.ts'

describe('host-freebuff-rpc', () => {
  it('mounts the fork-owned channel without replacing the official API route', () => {
    let route: { path: string; kind: string } | undefined
    const register = vi.fn((value: { path: string; kind: string }) => {
      route = value
      return () => undefined
    })
    const webServer = { register }
    const api = { freebuff: {} } as unknown as ApiProxy
    const ctx = {
      get: (key: string) => key === 'apiProxy' ? api : webServer,
      webServer,
      effect: (callback: () => unknown) => callback(),
    } as unknown as Context

    apply(ctx)

    expect(route).toMatchObject({ kind: 'prefix', path: '/freebuff' })
    expect(register).toHaveBeenCalledOnce()
  })

  it('routes only the Freebuff endpoint family to ApiProxy', async () => {
    const status = vi.fn().mockResolvedValue({
      rpcId: 'status',
      result: { ok: true, value: { accounts: [] } },
    })
    const api = { freebuff: { status } } as unknown as ApiProxy
    const handler = createFreebuffFetchHandler(api)
    const response = await handler.fetch(new Request('http://dsh.test/freebuff/freebuff.status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'status', method: 'freebuff.status', payload: {} }),
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      type: 'server-response',
      rpcId: 'status',
      result: { ok: true, value: { accounts: [] } },
    })
    expect(status).toHaveBeenCalledOnce()

    const missing = await handler.fetch(new Request('http://dsh.test/freebuff/session.models', { method: 'POST' }))
    expect(missing.status).toBe(404)
  })
})

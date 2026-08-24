/** Fork-only bridge for Freebuff methods on a dedicated Connection channel. */

import { toFetchHandler } from '@deepseek-ai/dsh-fork-host-apiproxy'
import type { ApiProxy } from '@deepseek-ai/dsh-fork-host-apiproxy/api'
import type { Context } from '@deepseek-ai/cordis'
import { bridge } from '@deepseek-ai/dsh-client-connection/src/http-bridge.ts'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

/** Stable Cordis plugin name. */
export const name = 'host-freebuff-rpc'

/** Services required by the bridge. */
export const inject = ['apiProxy', 'webServer']

const FREEBUFF_ENDPOINTS = new Set([
  'freebuff.status',
  'freebuff.beginLogin',
  'freebuff.completeLogin',
  'freebuff.logout',
  'freebuff.openDesktop',
])

/** Mount the Freebuff endpoint family on its fork-owned Connection channel. */
export function apply(ctx: Context): void {
  const api = ctx.get('apiProxy') as ApiProxy
  const route: WebRoute = {
    kind: 'prefix',
    path: '/freebuff',
    handler: async (req, res) => {
      if (!isLoopbackRequest(req.headers.host, req.socket.remoteAddress)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      await bridge(req, res, createFreebuffFetchHandler(api))
    },
  }
  ctx.effect(() => ctx.webServer.register(route), 'host-freebuff-rpc: /freebuff route')
}

/** Convert Freebuff connection requests into the existing ApiProxy carrier. */
export function createFreebuffFetchHandler(api: ApiProxy): { fetch(request: Request): Promise<Response> } {
  const apiHandler = toFetchHandler(api)
  return {
    async fetch(request) {
      const url = new URL(request.url)
      const endpoint = url.pathname.startsWith('/freebuff/')
        ? url.pathname.slice('/freebuff/'.length)
        : undefined
      if (endpoint === undefined || !FREEBUFF_ENDPOINTS.has(endpoint)) {
        return new Response('not found', { status: 404 })
      }
      const body = request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await request.arrayBuffer()
      url.pathname = `/api/${endpoint}`
      return apiHandler.fetch(new Request(url, {
        method: request.method,
        headers: request.headers,
        ...body === undefined ? {} : { body },
        signal: request.signal,
      }))
    },
  }
}

function isLoopbackRequest(hostHeader: string | undefined, remoteAddress: string | undefined): boolean {
  const host = hostHeader?.replace(/^\[/, '').replace(/\](:\d+)?$/, '').replace(/:\d+$/, '')
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
    || remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1'
}

export default apply

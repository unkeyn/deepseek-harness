/**
 * The `/web-search-pool` Connection channel: the browser's key-check calls,
 * answered from the pool's own runtime config without exposing key material.
 * The wire envelope matches the shared Connection RPC (`client-request` in,
 * `server-response` out) so the browser caller is the generic one.
 * @module @deepseek-ai/dsh-fork-web-search-pool/route
 */

import { bridge, type FetchHandler } from '@deepseek-ai/dsh-client-connection/src/http-bridge.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { PoolKeyCheckResult } from './check.ts'

/** The one endpoint this channel serves. */
const CHECK_ENDPOINT = 'webSearchPool.check'

/** Loopback guard for the local GUI-only provider check channel. */
function isLoopbackRequest(hostHeader: string | undefined, remoteAddress: string | undefined): boolean {
  const host = hostHeader?.replace(/^\[/, '').replace(/\](:\d+)?$/, '').replace(/:\d+$/, '')
  return host === '127.0.0.1' || host === 'localhost' || host === '::1'
    || remoteAddress === '127.0.0.1' || remoteAddress === '::1' || remoteAddress === '::ffff:127.0.0.1'
}

/**
 * Mount the key-check channel. Registration is an effect of the calling
 * plugin's fiber; a deployment without the web carrier simply has no check
 * route and every other pool function keeps working.
 * @param ctx - the pool plugin's context.
 * @param checkProvider - runs one provider's key check against the live config.
 */
export function installCheckRoute(ctx: Context, checkProvider: (providerId: string) => Promise<PoolKeyCheckResult[]>): void {
  // The registration waits for the web carrier through ctx.inject — loader
  // entries start in parallel, so a synchronous ctx.get at apply time races
  // the carrier and silently loses. A deployment without the carrier leaves
  // this fiber waiting and every other pool function keeps working.
  ctx.inject(['webServer'], (wctx) => {
    const route: WebRoute = {
      kind: 'prefix',
      path: '/web-search-pool',
      handler: async (req, res) => {
        if (!isLoopbackRequest(req.headers.host, req.socket.remoteAddress)) {
          res.writeHead(403)
          res.end('forbidden')
          return
        }
        await bridge(req, res, createCheckHandler(checkProvider))
      },
    }
    wctx.webServer.register(route)
  })
}

/** Build the fetch-shaped handler answering `webSearchPool.check` requests. */
export function createCheckHandler(checkProvider: (providerId: string) => Promise<PoolKeyCheckResult[]>): FetchHandler {
  return {
    async fetch(request) {
      const contentType = request.headers.get('content-type') ?? ''
      if (request.method !== 'POST' || !contentType.includes('application/json')) {
        return jsonResponse(415, 'unsupported media type')
      }
      let message: { type?: unknown; rpcId?: unknown; method?: unknown; payload?: unknown }
      try {
        message = await request.json() as typeof message
      } catch {
        return jsonResponse(400, 'malformed JSON body')
      }
      if (message.type !== 'client-request' || typeof message.rpcId !== 'string' || message.rpcId.length === 0) {
        return jsonResponse(400, 'not a client-request envelope')
      }
      const rpcId = message.rpcId
      const respond = (result: unknown): Response =>
        new Response(JSON.stringify({ type: 'server-response', rpcId, result }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      if (message.method !== CHECK_ENDPOINT) {
        return respond({ ok: false, error: { code: 'internal', message: `unknown endpoint ${JSON.stringify(String(message.method))}`, details: {} } })
      }
      const payload = message.payload as { providerId?: unknown } | undefined
      if (payload === undefined || typeof payload !== 'object' || typeof payload.providerId !== 'string'
        || payload.providerId.length === 0) {
        return respond({ ok: false, error: { code: 'bad-request', message: 'providerId is required', details: { issues: [] } } })
      }
      try {
        const keys = await checkProvider(payload.providerId)
        return respond({ ok: true, value: { keys } })
      } catch (error: unknown) {
        return respond({
          ok: false,
          error: {
            code: 'internal',
            message: error instanceof Error ? error.message : String(error),
            details: {},
          },
        })
      }
    },
  }
}

/** One plain-text HTTP error answer (transport failures, not business results). */
function jsonResponse(status: number, message: string): Response {
  return new Response(message, { status, headers: { 'content-type': 'text/plain' } })
}

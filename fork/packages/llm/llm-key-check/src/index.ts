/**
 * Host half of the API-key check: a Connection channel the Models page asks
 * whether a pasted key works.
 *
 * The host owns the whole question. The browser never learns a provider's
 * address — it names a provider id, and this host is the only side that knows
 * what to ask and where — and it never sends a key it wants back. That split
 * is what keeps a pasted secret from becoming a URL a page can point anywhere:
 * the directory is built here, from the installed catalog and the local
 * settings document, and a provider id no source describes is answered as
 * unknown rather than guessed at.
 *
 * @module @deepseek-ai/dsh-fork-llm-key-check
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { checkKeys, DEFAULT_CONCURRENCY, DEFAULT_TIMEOUT_MS, findRoute, MAX_KEYS_PER_CALL } from './check.ts'
import { createKeyCheckHandler } from './route.ts'
import { keyCheckRoutes } from './providers.ts'

export const name = 'llm-key-check'
export const inject = ['connection']

/** The Connection channel this host serves. */
export const KEY_CHECK_CHANNEL = '/llm-key-check'

export { checkKeys, DEFAULT_CONCURRENCY, DEFAULT_TIMEOUT_MS, findRoute, MAX_KEYS_PER_CALL }
export type { KeyCheckDeps, KeyCheckOutcome, KeyCheckTarget } from './check.ts'
export { keyCheckRoutes, providerDirectory, usesBearerAuth } from './providers.ts'
export type { KeyCheckProviderInfo, KeyCheckRoute, SettingsReader } from './providers.ts'
export { CHECK_ENDPOINT, createKeyCheckHandler, PROVIDERS_ENDPOINT } from './route.ts'
export type { CheckValue, ProvidersValue } from './route.ts'

/** Runtime limits for one check run. */
export interface Config {
  /** Per-request deadline in milliseconds. */
  timeoutMs?: number
  /** Probes in flight at once. */
  concurrency?: number
}

export const Config: z<Config> = z.object({
  timeoutMs: z.number().default(DEFAULT_TIMEOUT_MS),
  concurrency: z.number().default(DEFAULT_CONCURRENCY),
})

/**
 * Mount the key-check channel.
 *
 * The directory is read per call rather than once at startup: a provider the
 * user declares in settings is checkable on the next click, with no restart
 * and no rebuild of anything held here.
 * @param ctx - Cordis context carrying the Connection service.
 * @param config - the runtime limits.
 */
export function apply(ctx: Context, config: Config): void {
  // A provider directory is only as fresh as the settings document behind it,
  // and the settings service mounts after this plugin — reading it at call
  // time rather than at apply time is what lets a newly declared route answer.
  const routes = (): ReturnType<typeof keyCheckRoutes> => keyCheckRoutes(ctx.get('settings'))
  ctx.connection.rpc.handle(KEY_CHECK_CHANNEL, createKeyCheckHandler(routes, {
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.concurrency === undefined ? {} : { concurrency: config.concurrency }),
  }))
}

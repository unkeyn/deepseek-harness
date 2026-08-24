/**
 * `@deepseek-ai/dsh-fork-web-search-brave`: registers a Brave-backed
 * `WebSearchProvider` with `ctx.web`. A function/namespace plugin (NOT a
 * default-export service): it registers INTO the seam's provider registry, like
 * `@deepseek-ai/dsh-fork-llm-deepseek` registers an adapter into `ctx.llm`.
 *
 * @module @deepseek-ai/dsh-fork-web-search-brave
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-fork-web'
import {
  BraveSearchProvider,
  BRAVE_DEFAULT_BASE_URL,
  BRAVE_DEFAULT_MODEL,
} from './provider.ts'

export {
  BRAVE_DEFAULT_BASE_URL,
  BRAVE_DEFAULT_MODEL,
  BraveSearchProvider,
  BRAVE_PROVIDER_ID,
} from './provider.ts'
export type { BraveSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-brave'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Brave API key. Falls back to `$BRAVE_API_KEY`. Empty → unavailable. */
  apiKey?: string
  /** Endpoint base; `/search` is appended. Defaults to the public API. */
  baseURL?: string
  /** Search model name. Defaults to `brave-search`. */
  model?: string
}

/** Settings namespace carrying this provider's endpoint, model, and key reference. */
export const BRAVE_SEARCH_SETTINGS_NAMESPACE = settingsNamespace('web-search-brave')

export const Config: z<Config> = z.object({
  apiKey: z.string(),
  baseURL: z.string(),
  model: z.string().default(BRAVE_DEFAULT_MODEL),
})

/** Register the Brave search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new BraveSearchProvider({
    // Every environment layer may name this key: the product trusts the
    // project it is launched in, and the managed store is not involved here.
    apiKey: config.apiKey ?? launchEnvironmentOf(ctx).get('BRAVE_API_KEY')?.value ?? '',
    baseURL: config.baseURL ?? BRAVE_DEFAULT_BASE_URL,
    model: config.model ?? BRAVE_DEFAULT_MODEL,
  }))
}

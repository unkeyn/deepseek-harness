/**
 * `@deepseek-ai/dsh-web-search-firecrawl`: registers a Firecrawl-backed
 * `WebSearchProvider` with `ctx.web`. A function/namespace plugin (NOT a
 * default-export service): it registers INTO the seam's provider registry, like
 * `@deepseek-ai/dsh-llm-deepseek` registers an adapter into `ctx.llm`.
 *
 * @module @deepseek-ai/dsh-web-search-firecrawl
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-web'
import {
  FirecrawlSearchProvider,
  FIRECRAWL_DEFAULT_BASE_URL,
} from './provider.ts'

export {
  FIRECRAWL_DEFAULT_BASE_URL,
  FirecrawlSearchProvider,
  FIRECRAWL_PROVIDER_ID,
} from './provider.ts'
export type { FirecrawlSearchProviderOptions } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-firecrawl'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config (all optional — `apply` fills env-var and constant defaults). */
export interface Config {
  /** Firecrawl API key. Falls back to `$FIRECRAWL_API_KEY`. Empty → unavailable. */
  apiKey?: string
  /** Endpoint base; `/search` is appended. Defaults to the public API. */
  baseURL?: string
}

/** Settings namespace carrying this provider's endpoint and key reference. */
export const FIRECRAWL_SEARCH_SETTINGS_NAMESPACE = settingsNamespace('web-search-firecrawl')

export const Config: z<Config> = z.object({
  apiKey: z.string(),
  baseURL: z.string(),
})

/** Register the Firecrawl search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  ctx.web.registerSearchProvider(new FirecrawlSearchProvider({
    // Every environment layer may name this key: the product trusts the
    // project it is launched in, and the managed store is not involved here.
    apiKey: config.apiKey ?? launchEnvironmentOf(ctx).get('FIRECRAWL_API_KEY')?.value ?? '',
    baseURL: config.baseURL ?? FIRECRAWL_DEFAULT_BASE_URL,
  }))
}

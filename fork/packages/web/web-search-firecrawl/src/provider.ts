/**
 * `FirecrawlSearchProvider`: a `WebSearchProvider` backed by the Firecrawl API.
 * Firecrawl provides web scraping and crawling capabilities. This provider
 * integrates with Firecrawl's search functionality.
 * @module @deepseek-ai/dsh-fork-web-search-firecrawl/provider
 */

import { WebError } from '@deepseek-ai/dsh-fork-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-fork-web'

/** Stable id this provider registers under. */
export const FIRECRAWL_PROVIDER_ID = 'firecrawl'

/** Default Firecrawl API endpoint for search. */
export const FIRECRAWL_DEFAULT_BASE_URL = 'https://api.firecrawl.ai/v1/search'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
export interface FirecrawlSearchProviderOptions {
  /** Firecrawl API key. Empty/absent makes the provider unavailable. */
  apiKey: string
  /** Endpoint base; `/search` is appended. */
  baseURL: string
}

/**
 * Map a Firecrawl result to a normalized source, or `undefined` when it carries no
 * portable snippet.
 *
 * @param result - one entry of Firecrawl's results.
 * @returns the normalized source, or `undefined` when the entry has no
 *   non-blank snippet.
 */
export function mapFirecrawlResult(result: {
  url: string
  title?: string | null
  description?: string | null
}): WebSearchSource | undefined {
  const snippet = result.description ?? undefined
  if (snippet === undefined || snippet.trim().length === 0) return undefined
  return {
    url: result.url,
    ...result.title != null && result.title.length > 0 ? { title: result.title } : {},
    snippet,
  }
}

/**
 * Map a Firecrawl response envelope to a normalized search result.
 *
 * @param response - the parsed Firecrawl search response body.
 * @returns the normalized result; snippet-less entries are dropped.
 */
export function mapFirecrawlResponse(response: {
  results?: Array<{
    url: string
    title?: string | null
    description?: string | null
  }>
}): WebSearchResult {
  const sources = (response.results ?? [])
    .map(mapFirecrawlResult)
    .filter((source): source is WebSearchSource => source !== undefined)
  return { sources, truncated: false }
}

/** The Firecrawl-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class FirecrawlSearchProvider implements WebSearchProvider {
  readonly id = FIRECRAWL_PROVIDER_ID

  constructor(private readonly options: FirecrawlSearchProviderOptions) {}

  available(): boolean {
    return this.options.apiKey.length > 0
      && isValidBaseUrl(this.options.baseURL)
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const endpoint = `${this.options.baseURL}?query=${encodeURIComponent(request.query)}`
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'GET',
        redirect: 'error',
        headers: {
          'x-api-key': this.options.apiKey,
          'user-agent': USER_AGENT,
          'accept': 'application/json',
        },
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Firecrawl search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Firecrawl search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Firecrawl API error (HTTP ${status})`
      try {
        const parsed = await response.json() as { error?: string; message?: string }
        const detail = parsed.error ?? parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        if (isAbortError(error)) throw new WebError('Firecrawl search aborted', 'WEB_ABORTED', { cause: error })
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as {
        results?: Array<{
          url: string
          title?: string | null
          description?: string | null
        }>
      }
      return mapFirecrawlResponse(payload)
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Firecrawl search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Firecrawl returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }
}

/** True when `baseURL` parses as an absolute URL (a cheap local config check). */
function isValidBaseUrl(baseURL: string): boolean {
  return URL.canParse(baseURL)
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

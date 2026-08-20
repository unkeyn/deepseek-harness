/**
 * `BraveSearchProvider`: a `WebSearchProvider` backed by the Brave Search API.
 * @module @deepseek-ai/dsh-web-search-brave/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'

/** Stable id this provider registers under. */
export const BRAVE_PROVIDER_ID = 'brave'

/** Default Brave Search API endpoint. */
export const BRAVE_DEFAULT_BASE_URL = 'https://api.search.brave.com/research/v1/web/search'

/** Default search model name. */
export const BRAVE_DEFAULT_MODEL = 'brave-search'

/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
export interface BraveSearchProviderOptions {
  /** Brave API key. Empty/absent makes the provider unavailable. */
  apiKey: string
  /** Endpoint base; `/search` is appended. */
  baseURL: string
  /** Search model name. */
  model: string
}

/**
 * Map a Brave result to a normalized source, or `undefined` when it carries no
 * portable snippet.
 *
 * @param result - one entry of Brave's `results[]`.
 * @returns the normalized source, or `undefined` when the entry has no
 *   non-blank snippet.
 */
export function mapBraveResult(result: {
  url: string
  title?: string | null
  description?: string | null
  age?: string | null
  rank?: number
}): WebSearchSource | undefined {
  const snippet = result.description ?? undefined
  if (snippet === undefined || snippet.trim().length === 0) return undefined
  return {
    url: result.url,
    ...result.title != null && result.title.length > 0 ? { title: result.title } : {},
    snippet,
    ...result.age != null && result.age.length > 0 ? { publishedAt: result.age } : {},
  }
}

/**
 * Map a Brave response envelope to a normalized search result.
 *
 * @param response - the parsed Brave search response body.
 * @returns the normalized result; snippet-less entries are dropped.
 */
export function mapBraveResponse(response: {
  results?: Array<{
    url: string
    title?: string | null
    description?: string | null
    age?: string | null
    rank?: number
  }>
}): WebSearchResult {
  const sources = (response.results ?? [])
    .map(mapBraveResult)
    .filter((source): source is WebSearchSource => source !== undefined)
  return { sources, truncated: false }
}

/** The Brave-backed search provider; HTTP redirects fail as `WEB_PROVIDER_ERROR`. */
export class BraveSearchProvider implements WebSearchProvider {
  readonly id = BRAVE_PROVIDER_ID

  constructor(private readonly options: BraveSearchProviderOptions) {}

  available(): boolean {
    return this.options.apiKey.length > 0
      && isValidBaseUrl(this.options.baseURL)
      && this.options.model.length > 0
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const endpoint = `${this.options.baseURL}?q=${encodeURIComponent(request.query)}`
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
      if (isAbortError(error)) throw new WebError('Brave search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Brave search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `Brave API error (HTTP ${status})`
      try {
        const parsed = await response.json() as { error?: string; message?: string }
        const detail = parsed.error ?? parsed.message
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        if (isAbortError(error)) throw new WebError('Brave search aborted', 'WEB_ABORTED', { cause: error })
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const payload = await response.json() as {
        results?: Array<{ url: string; title?: string | null; description?: string | null; age?: string | null; rank?: number }>
      }
      return mapBraveResponse(payload)
    } catch (error: unknown) {
      if (isAbortError(error)) throw new WebError('Brave search aborted', 'WEB_ABORTED', { cause: error })
      throw new WebError(`Brave returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
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

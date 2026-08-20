/**
 * Wire types for the Firecrawl API response. Types only — no runtime code.
 *
 * @module @deepseek-ai/dsh-web-search-firecrawl/types
 */

/** One entry of Firecrawl's results. */
export interface FirecrawlResult {
  url: string
  title?: string | null
  description?: string | null
}

/** Firecrawl's search response envelope. */
export interface FirecrawlSearchResponse {
  results?: FirecrawlResult[]
}

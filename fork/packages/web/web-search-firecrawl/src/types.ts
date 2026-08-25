/**
 * Wire types for the Firecrawl v2 search response. Types only — no runtime code.
 *
 * @module @deepseek-ai/dsh-fork-web-search-firecrawl/types
 */

/** One entry of Firecrawl's `data.web` results. */
export interface FirecrawlResult {
  url: string
  title?: string | null
  description?: string | null
}

/** Firecrawl v2 search response envelope. */
export interface FirecrawlSearchResponse {
  data?: {
    web?: FirecrawlResult[]
  }
}

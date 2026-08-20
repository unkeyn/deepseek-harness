/**
 * Wire types for the Brave Search API response. Types only — no runtime code.
 *
 * @module @deepseek-ai/dsh-web-search-brave/types
 */

/** One entry of Brave's `results[]`. */
export interface BraveResult {
  url: string
  title?: string | null
  description?: string | null
  age?: string | null
  rank?: number
}

/** Brave's search response envelope. */
export interface BraveSearchResponse {
  results?: BraveResult[]
}

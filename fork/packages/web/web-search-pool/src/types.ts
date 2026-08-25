/**
 * Wire and runtime data types of the custom web search pool. Types only — no
 * runtime code.
 * @module @deepseek-ai/dsh-fork-web-search-pool/types
 */

/** One non-secret key reference and its persisted health metadata. */
export interface PoolKey {
  id: string
  ref: string
  enabled: boolean
  priority: number
  maxConcurrent: number
  cooldownUntil?: number
  quarantineUntil?: number
  lastError?: string
  lastStatus?: number
}

/** Where a provider's account state can be read, for the UI's key check. */
export interface PoolCheckSpec {
  /** Absolute HTTPS account/credit endpoint answered with the provider's auth. */
  endpoint: string
  /** HTTP verb; defaults to GET. */
  method?: 'GET' | 'POST'
  /** Dot path of the credits-spent number in the response. */
  usagePath?: string
  /** Dot path of the plan-limit number in the response. */
  limitPath?: string
  /** Dot path of the remaining-credits number in the response. */
  remainingPath?: string
}

/** One generic HTTP search provider and its key pool. */
export interface PoolProvider {
  id: string
  name: string
  priority: number
  endpoint: string
  method: 'GET' | 'POST'
  queryParam: string
  requestBody?: 'query' | 'exa'
  authMode: 'header' | 'bearer' | 'query'
  authName: string
  responseResultsPath: string
  resultUrlPath: string
  resultTitlePath: string
  resultSnippetPath: string
  resultDatePath: string
  keys: PoolKey[]
  enabled: boolean
  /** Account endpoint the UI's key check reads; absence falls back to a minimal query ping. */
  check?: PoolCheckSpec
}

/** User-managed provider pool configuration (the stored document section). */
export interface PoolConfig {
  providers?: PoolProvider[]
  maxAttempts?: number
  cooldownMs?: number
}

/** Resolved runtime configuration (defaults applied). */
export interface RuntimeConfig {
  providers: PoolProvider[]
  maxAttempts: number
  cooldownMs: number
}

/** A live health patch applied to one key. */
export type KeyHealthPatch = Partial<PoolKey> & {
  clearCooldown?: boolean
  clearQuarantine?: boolean
  clearError?: boolean
  clearStatus?: boolean
}

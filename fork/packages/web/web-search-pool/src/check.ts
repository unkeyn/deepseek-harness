/**
 * Per-key provider checks: one account/credit lookup when the provider ships a
 * check spec, one minimal real query otherwise. Results are redacted — a key's
 * secret never appears in a result, only its pool id, reference name, and what
 * the provider answered.
 * @module @deepseek-ai/dsh-fork-web-search-pool/check
 */

import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { WebError } from '@deepseek-ai/dsh-fork-web'
import type { PoolCheckSpec, PoolProvider, RuntimeConfig } from './types.ts'

/** Redacted outcome of checking one pool key (a type alias: tool outputs must assign to lossless JSON). */
export type PoolKeyCheckResult = {
  /** Pool key id the result belongs to. */
  keyId: string
  /** Credential reference the key resolves through. */
  ref: string
  /** The provider accepted the key. */
  valid: boolean
  /** HTTP status the provider answered with, when a response arrived. */
  status?: number
  /** Credits still available, when the account endpoint reports one. */
  remaining?: number
  /** Total plan credits, when the account endpoint reports one. */
  limit?: number
  /** Credits spent in the current period, when the account endpoint reports one. */
  used?: number
  /** Why validity could not be confirmed; carries no request material. */
  error?: string
}

/** The store and runtime snapshot one check runs against. */
export interface CheckDeps {
  resolveCredential(ref: ReturnType<typeof credentialRef>): Promise<{ value: string } | undefined>
  config: RuntimeConfig
}

/** Bound timeout for one check request; a check must never hang a UI action. */
const CHECK_TIMEOUT_MS = 20_000

/** The neutral minimal query a validation ping searches for. */
const PING_QUERY = 'dsh key check'

/**
 * Check every enabled key of one provider.
 * @param deps - credential store access and the current runtime config.
 * @param providerId - the pool provider whose keys to check.
 * @returns one redacted result per enabled key, in pool order.
 */
export async function checkProviderKeys(deps: CheckDeps, providerId: string): Promise<PoolKeyCheckResult[]> {
  const provider = deps.config.providers.find(candidate => candidate.id === providerId)
  if (provider === undefined) {
    throw new Error(`web-search-pool provider '${providerId}' was not found`)
  }
  return Promise.all(provider.keys.filter(key => key.enabled).map(key => checkKey(deps, provider, key)))
}

/** Check one key: the account endpoint when the provider ships one, a minimal query otherwise. */
async function checkKey(deps: CheckDeps, provider: PoolProvider, key: PoolProvider['keys'][number]): Promise<PoolKeyCheckResult> {
  const result: PoolKeyCheckResult = { keyId: key.id, ref: key.ref, valid: false }
  let value: string
  try {
    const resolved = await deps.resolveCredential(credentialRef(key.ref))
    if (resolved === undefined) {
      return { ...result, error: `credential '${key.ref}' is not configured` }
    }
    value = resolved.value
  } catch (error: unknown) {
    return { ...result, error: `credential '${key.ref}' could not be resolved: ${messageOf(error)}` }
  }
  const signal = AbortSignal.timeout(CHECK_TIMEOUT_MS)
  try {
    if (provider.check === undefined) {
      return await pingKey(provider, value, signal, result)
    }
    return await queryAccount(provider.check, provider, value, signal, result)
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return { ...result, error: 'check timed out' }
    }
    return { ...result, error: `check request failed: ${messageOf(error)}` }
  }
}

/** Ask the provider's account endpoint; 200 plus parseable numbers confirms validity. */
async function queryAccount(
  spec: PoolCheckSpec,
  provider: PoolProvider,
  value: string,
  signal: AbortSignal,
  result: PoolKeyCheckResult,
): Promise<PoolKeyCheckResult> {
  const response = await fetch(spec.endpoint, {
    method: spec.method ?? 'GET',
    redirect: 'error',
    headers: authHeaders(provider, value),
    signal,
  })
  if (response.status === 401 || response.status === 403) {
    return { ...result, status: response.status, valid: false, error: `key rejected (HTTP ${String(response.status)})` }
  }
  if (response.status === 402) {
    return { ...result, status: response.status, valid: false, error: 'out of credits (HTTP 402)' }
  }
  if (!response.ok) {
    return { ...result, status: response.status, error: `check endpoint answered HTTP ${String(response.status)}` }
  }
  const payload = await response.json() as unknown
  const remaining = readNumber(payload, spec.remainingPath)
  const limit = readNumber(payload, spec.limitPath)
  const used = readNumber(payload, spec.usagePath)
  return {
    ...result,
    status: response.status,
    valid: true,
    ...(remaining === undefined ? {} : { remaining }),
    ...(limit === undefined ? {} : { limit }),
    ...(used === undefined ? {} : { used }),
  }
}

/** Run one minimal real search; any authenticated answer confirms validity. */
async function pingKey(
  provider: PoolProvider,
  value: string,
  signal: AbortSignal,
  result: PoolKeyCheckResult,
): Promise<PoolKeyCheckResult> {
  const url = provider.method === 'GET'
    ? `${provider.endpoint}?${encodeURIComponent(provider.queryParam)}=${encodeURIComponent(PING_QUERY)}`
    : provider.endpoint
  const response = await fetch(url, {
    method: provider.method,
    redirect: 'error',
    headers: provider.method === 'POST'
      ? { ...authHeaders(provider, value), 'content-type': 'application/json' }
      : authHeaders(provider, value),
    ...(provider.method === 'POST' ? { body: JSON.stringify({ [provider.queryParam]: PING_QUERY }) } : {}),
    signal,
  })
  if (response.status === 401 || response.status === 403) {
    return { ...result, status: response.status, valid: false, error: `key rejected (HTTP ${String(response.status)})` }
  }
  if (response.status === 402) {
    return { ...result, status: response.status, valid: false, error: 'out of credits (HTTP 402)' }
  }
  // Any other answer — success, validation refusal, or rate limit — proves the
  // key itself was accepted; draining the body keeps the socket reusable.
  try {
    await response.arrayBuffer()
  } catch {
    // A mid-body failure cannot change the validity verdict the status made.
  }
  return { ...result, status: response.status, valid: true }
}

/** The credential-bearing headers one provider expects; redirects are never followed. */
function authHeaders(provider: PoolProvider, value: string): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (provider.authMode === 'header') headers[provider.authName] = value
  if (provider.authMode === 'bearer') headers.authorization = `Bearer ${value}`
  return headers
}

/** Read one finite number at a dot path, or undefined when absent or non-numeric. */
function readNumber(payload: unknown, path: string | undefined): number | undefined {
  if (path === undefined) return undefined
  let current: unknown = payload
  for (const part of path.split('.').filter(Boolean)) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'number' && Number.isFinite(current) ? current : undefined
}

function messageOf(error: unknown): string {
  if (isWebError(error)) return error.code
  return error instanceof Error ? error.message : String(error)
}

/** WebError narrows to its stable code so check failures never quote request material. */
function isWebError(error: unknown): error is WebError {
  return typeof error === 'object' && error !== null && 'code' in error
    && typeof (error as { code?: unknown }).code === 'string'
    && (error as { name?: unknown }).name === 'WebError'
}

/**
 * Probing one pasted API key against the provider it claims to belong to.
 *
 * A key is only proven by a request the provider actually authenticates, and
 * not every provider authenticates the same request. The OpenAI-compatible
 * listing — `GET /models` — is open on some gateways: NVIDIA answers `200` and
 * a full model list to a key that does not exist, so a listing that answers is
 * not evidence of anything. A completion is: the same gateway answers `403
 * Authorization failed` for a key it does not know, and `404 ... not found for
 * account` for one it does.
 *
 * So the probe asks twice, cheapest question first only when the honest one is
 * unavailable:
 *
 * 1. **A completion**, one token against one word, on the route's own endpoint
 *    with a model id the route's own catalog supplies. `401`/`403` is a
 *    rejection; anything else that got past the gateway's auth — including
 *    `400` on the body or `404` on a model the account no longer carries — is
 *    an acceptance.
 * 2. **The listing**, for a route that names no model, or whose completion
 *    endpoint answered with a server error or never answered at all. A listing
 *    is weaker evidence and is only ever consulted when the completion said
 *    nothing.
 *
 * Only the verdict crosses back: a key is never echoed, and a failure carries
 * the HTTP status and one short reason, never a response body.
 *
 * @module @deepseek-ai/dsh-fork-llm-key-check/check
 */

import { normalizeApiKey } from '@deepseek-ai/dsh-fork-llm'
import type { KeyCheckRoute } from './providers.ts'
import { completionBody, usesBearerAuth } from './providers.ts'

/** One key a caller asks about. */
export interface KeyCheckTarget {
  /** Caller-supplied correlation id, echoed back untouched. */
  id: string
  /** Provider route id. */
  provider: string
  /** The pasted key, probed and then discarded. */
  apiKey: string
}

/** The verdict on one key. */
export interface KeyCheckOutcome {
  /** The caller's correlation id. */
  id: string
  /** Provider route id, as resolved. */
  provider: string
  /** Whether the provider accepted the key. */
  valid: boolean
  /** HTTP status of the deciding probe, once one came back. */
  status?: number | undefined
  /**
   * Which probe decided the verdict — a completion the provider authenticated,
   * or the listing a completion could not be asked for.
   */
  via?: 'completion' | 'listing' | undefined
  /** Why the key was not accepted, when it was not. */
  error?: string | undefined
}

/** Everything a probe run needs. */
export interface KeyCheckDeps {
  /** The route directory, read per run so a settings edit reaches the next call. */
  routes: () => readonly KeyCheckRoute[]
  /** Network entry point; the global `fetch` unless a test supplies one. */
  fetch?: typeof fetch
  /** Per-request deadline in milliseconds. @default 15000 */
  timeoutMs?: number
  /** Probes in flight at once. @default 6 */
  concurrency?: number
}

/** Default per-request deadline. */
export const DEFAULT_TIMEOUT_MS = 15_000
/** Default number of probes in flight at once. */
export const DEFAULT_CONCURRENCY = 6
/** Most keys one call may probe: one page's worth of pasted lines, with headroom. */
export const MAX_KEYS_PER_CALL = 200

/** User agent identifying the probe; a provider's logs should say who knocked. */
const USER_AGENT = 'deepseek-harness/key-check'

/** One probe's raw answer: a status, or the reason no status came back. */
interface ProbeResult {
  status?: number | undefined
  error?: string | undefined
}

/**
 * Find the route one pasted line names. Matching is case-insensitive because a
 * provider id is a label the user typed into a text field, never a selector
 * they chose, and nothing else on the page is case-sensitive either.
 * @param routes - the route directory.
 * @param provider - the route id as pasted.
 * @returns the route, or `undefined` when no source describes it.
 */
export function findRoute(routes: readonly KeyCheckRoute[], provider: string): KeyCheckRoute | undefined {
  const needle = provider.trim().toLowerCase()
  return routes.find(route => route.provider.toLowerCase() === needle)
}

/** One-line text for a transport rejection. */
function errorText(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'timed out'
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Issue one request and return only its status.
 *
 * The body is never read: a response that answers is the whole answer, and
 * draining one would spend the bandwidth the probe exists to avoid.
 * @param url - the exact endpoint.
 * @param init - method, headers, and body.
 * @param deps - the fetch entry point and the deadline.
 * @returns the status, or the reason none came back.
 */
async function request(
  url: string,
  init: { method: string; body?: string },
  headers: Record<string, string>,
  deps: { fetchImpl: typeof fetch; timeoutMs: number },
): Promise<ProbeResult> {
  let response: Response
  try {
    response = await deps.fetchImpl(url, {
      method: init.method,
      redirect: 'error',
      headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...headers },
      ...(init.body === undefined ? {} : { body: init.body }),
      signal: AbortSignal.timeout(deps.timeoutMs),
    })
  } catch (error: unknown) {
    return { error: `the provider could not be reached (${errorText(error)})` }
  }
  await response.body?.cancel().catch(() => {
    // A cancelled body is best-effort cleanup after a verdict is already held.
  })
  return { status: response.status }
}

/** The auth headers one route's protocol asks for. */
function authHeaders(route: KeyCheckRoute, apiKey: string): Record<string, string> {
  if (usesBearerAuth(route.api)) return { authorization: `Bearer ${apiKey}` }
  return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
}

/**
 * HTTP statuses a completion probe reads as an acceptance.
 *
 * Each is a complaint the gateway raises *after* it has resolved the caller:
 * `400` is a body the protocol rejects, `404` a model the account no longer
 * carries, `422` a field combination it will not serve, `409` an account or
 * region it will not serve, and `429` a quota already spent. None is a
 * statement about the credential, and every one of them is exactly what a
 * provider answers for a good key with an unlucky request.
 */
const ACCEPTED_AFTER_AUTH: ReadonlySet<number> = new Set([400, 404, 409, 422, 429])

/**
 * Read one completion status as a verdict.
 * @param status - the HTTP status.
 * @returns the verdict, or `undefined` when the status says nothing about the
 *   key — a server-side failure is a provider's problem, not an answer.
 */
function readCompletion(status: number): { valid: boolean; error?: string | undefined } | undefined {
  if (status >= 200 && status < 300) return { valid: true }
  if (status === 401 || status === 403) {
    return { valid: false, error: `the provider rejected the key (HTTP ${status})` }
  }
  if (ACCEPTED_AFTER_AUTH.has(status)) return { valid: true }
  return undefined
}

/** Read one listing status as a verdict. The listing is the weaker witness. */
function readListing(status: number): { valid: boolean; error?: string | undefined } {
  if (status >= 200 && status < 300) return { valid: true }
  if (status === 401 || status === 403) {
    return { valid: false, error: `the provider rejected the key (HTTP ${status})` }
  }
  return { valid: false, error: `the provider answered HTTP ${status}` }
}

/**
 * Probe one key against one route: the completion first, and the listing only
 * when the completion was not asked or said nothing.
 * @param route - the route and its exact endpoints.
 * @param apiKey - the pasted key.
 * @param deps - the fetch entry point and the deadline.
 * @returns the verdict, its status, and which probe decided it.
 */
async function probe(
  route: KeyCheckRoute,
  apiKey: string,
  deps: { fetchImpl: typeof fetch; timeoutMs: number },
): Promise<KeyCheckOutcome & { id: string }> {
  const empty: KeyCheckOutcome & { id: string } = { id: '', provider: route.provider, valid: false }
  const checked = normalizeApiKey(apiKey)
  if (!checked.ok) {
    return {
      ...empty,
      error: checked.reason === 'empty'
        ? 'the key is empty'
        : 'the key contains characters no HTTP header can carry',
    }
  }
  const headers = { ...authHeaders(route, checked.value), 'content-type': 'application/json' }

  // 1. The completion: the only question a provider authenticates everywhere.
  if (route.completionsUrl !== undefined && route.probeModel !== undefined) {
    const result = await request(
      route.completionsUrl,
      { method: 'POST', body: completionBody(route.api, route.probeModel) },
      headers,
      deps,
    )
    if (result.status !== undefined) {
      const verdict = readCompletion(result.status)
      if (verdict !== undefined) {
        return { ...empty, status: result.status, via: 'completion', ...verdict }
      }
    }
    if (result.error !== undefined) return { ...empty, error: result.error }
    // A status the completion could not answer: ask the listing instead.
  }

  // 2. The listing: asked for routes that name no model, and for completions
  //    whose server answered with a failure of its own.
  const listing = await request(route.modelsUrl, { method: 'GET' }, headers, deps)
  if (listing.status === undefined) return { ...empty, error: listing.error }
  return { ...empty, status: listing.status, via: 'listing', ...readListing(listing.status) }
}

/**
 * Probe every pasted key against the provider it names.
 *
 * Unknown providers and unusable keys are answered without a request: a route
 * no source describes is not a route this host may address, and a key no HTTP
 * header can carry is refused locally rather than reported as a provider's
 * rejection. Everything else runs through a bounded pool so a page of pasted
 * lines finishes in a few round trips instead of one long tail of sockets.
 * @param deps - the route directory, network entry point, and limits.
 * @param targets - the keys to probe.
 * @returns one verdict per target, in the order asked.
 */
export async function checkKeys(deps: KeyCheckDeps, targets: readonly KeyCheckTarget[]): Promise<KeyCheckOutcome[]> {
  const fetchImpl = deps.fetch ?? fetch
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const routes = deps.routes()
  const asked = targets.slice(0, MAX_KEYS_PER_CALL)
  const outcomes: KeyCheckOutcome[] = asked.map(target => ({
    id: target.id,
    provider: target.provider,
    valid: false,
  }))
  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor
      cursor += 1
      const target = asked[index]
      const outcome = outcomes[index]
      if (target === undefined || outcome === undefined) return
      const route = findRoute(routes, target.provider)
      if (route === undefined) {
        outcome.error = 'this provider is not available here'
        continue
      }
      const verdict = await probe(route, target.apiKey, { fetchImpl, timeoutMs })
      outcome.valid = verdict.valid
      outcome.provider = route.provider
      if (verdict.status !== undefined) outcome.status = verdict.status
      if (verdict.via !== undefined) outcome.via = verdict.via
      if (verdict.error !== undefined) outcome.error = verdict.error
    }
  }
  const width = Math.max(1, Math.min(deps.concurrency ?? DEFAULT_CONCURRENCY, asked.length || 1))
  await Promise.all(Array.from({ length: width }, () => worker()))
  return outcomes
}

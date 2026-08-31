/**
 * The checkable-provider directory: which routes a pasted API key may be
 * probed against, and the exact URLs one probe addresses.
 *
 * A probe is a network request to a provider the user named, so the directory
 * is the whole security boundary: **every address here is derived host-side**
 * from either the installed pi-ai catalog or a route the local settings
 * document already declares. A route id arriving over the channel is only
 * ever a lookup key — a caller cannot supply a URL, and an id no source
 * describes is answered as unknown rather than guessed at.
 *
 * @module @deepseek-ai/dsh-fork-llm-key-check/providers
 */

import { catalogProviderIds, catalogProviderTakesApiKey, catalogRouteEndpoint } from '@deepseek-ai/dsh-fork-llm-pi-ai'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** The settings namespace the pi-ai adapter owns; its profiles name declared routes. */
const PI_AI_SETTINGS_NAMESPACE = settingsNamespace('llm-pi-ai')
/** The settings namespace the Bearer adapter owns; its profiles name exact endpoints. */
const BEARER_SETTINGS_NAMESPACE = settingsNamespace('llm-bearer')

/**
 * The protocol a route with no usable protocol of its own is asked as: the
 * shape every gateway speaks, and the same default the pi-ai adapter applies.
 */
const GATEWAY_DEFAULT_API = 'openai-completions'

/** A URL whose path ends in an API version segment, e.g. `https://gw.example/v1`. */
const VERSION_SUFFIX = /\/v\d+$/
/** The trailing listing path a request base is joined with, or stripped of. */
const LISTING_PATH = '/models'

/** One route a pasted key may be probed against. */
export interface KeyCheckRoute {
  /** Provider route id — the only thing a caller may name. */
  provider: string
  /** Selector label; falls back to the route id. */
  displayName: string
  /** Wire protocol, which decides the probe's auth header and body shape. */
  api: string
  /** The exact URL the listing probe requests. */
  modelsUrl: string
  /**
   * The exact URL the completion probe posts to, when a request base could be
   * derived. Absent, the route falls back to the listing alone.
   */
  completionsUrl?: string
  /**
   * A model id the completion probe may name. A completion that must name a
   * model is only asked when the source supplies an id: naming a guessed one
   * would turn "model unknown" into "key unknown".
   */
  probeModel?: string | undefined
  /** Whether this route came from the installed catalog or the settings document. */
  source: 'catalog' | 'settings'
}

/** The subset of the settings service this directory reads. */
export interface SettingsReader {
  /** Read one namespace's resolved value. */
  get(ns: string): unknown
}

/** The route directory as announced over the channel: identity only. */
export interface KeyCheckProviderInfo {
  /** Provider route id. */
  provider: string
  /** Selector label. */
  displayName: string
}

/**
 * Read one settings namespace's provider profiles without importing another
 * adapter's schema. The document is a plain object by the time it resolves,
 * and this package needs two string fields per route — pulling a whole
 * schemastery runtime in to re-validate what the owning adapter already
 * validated would only duplicate that adapter's rules here.
 * @param settings - the settings service, when one is mounted.
 * @param ns - the namespace to read.
 * @returns the profile records keyed by route id.
 */
function profilesOf(settings: SettingsReader | undefined, ns: string): ReadonlyMap<string, Record<string, unknown>> {
  const value = settings?.get(ns)
  if (typeof value !== 'object' || value === null) return new Map()
  const providers = (value as { providers?: unknown }).providers
  if (typeof providers !== 'object' || providers === null) return new Map()
  const entries = new Map<string, Record<string, unknown>>()
  for (const [provider, profile] of Object.entries(providers as Record<string, unknown>)) {
    if (typeof profile === 'object' && profile !== null && provider.length > 0) {
      entries.set(provider, profile as Record<string, unknown>)
    }
  }
  return entries
}

/** Read one non-empty trimmed string field of a profile record. */
function text(profile: Record<string, unknown>, key: string): string | undefined {
  const value = profile[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** Join a request base with one path segment. */
function join(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

/** Strip a trailing listing path from an endpoint, recovering its request base. */
function baseOf(url: string): string {
  const trimmed = url.replace(/\/+$/, '')
  return trimmed.endsWith(LISTING_PATH) ? trimmed.slice(0, -LISTING_PATH.length) : trimmed
}

/**
 * Whether one protocol's probe carries the key in the `authorization` header.
 * Anthropic's own API authenticates with `x-api-key`, so it is the one
 * protocol excluded from the Bearer default.
 * @param api - the wire protocol.
 * @returns whether the probe sends `Authorization: Bearer`.
 */
export function usesBearerAuth(api: string): boolean {
  return !api.includes('anthropic')
}

/** Which protocol's completion route is the Responses endpoint rather than Chat Completions. */
function usesResponsesApi(api: string): boolean {
  return api.includes('responses')
}

/**
 * The completion endpoint a request base serves, per the protocol the route
 * resolves to.
 *
 * The OpenAI-compatible protocols take the base verbatim, version segment
 * included, so their path is appended as given. The Anthropic client adds its
 * own version segment, so a base recorded without one gains it here — the same
 * division the pi-ai adapter's verbatim-base set records.
 * @param baseUrl - the route's request base.
 * @param api - the wire protocol.
 * @returns the exact URL a completion probe posts to.
 */
export function completionsUrlFor(baseUrl: string, api: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  if (usesBearerAuth(api)) return join(base, usesResponsesApi(api) ? '/responses' : '/chat/completions')
  return join(VERSION_SUFFIX.test(base) ? base : `${base}/v1`, '/messages')
}

/**
 * The smallest completion body a route accepts, per protocol — one token of
 * output against one word of input, so a check costs the least a provider can
 * bill and returns as soon as the first token exists.
 * @param api - the wire protocol.
 * @param model - the model id to name.
 * @returns the JSON request body.
 */
export function completionBody(api: string, model: string): string {
  if (usesBearerAuth(api)) {
    return usesResponsesApi(api)
      ? JSON.stringify({ model, input: 'hi', max_output_tokens: 1 })
      : JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })
  }
  return JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })
}

/**
 * Every route a pasted key may be probed against, catalog routes first in
 * catalog order and declared routes after, in settings order.
 *
 * Three sources, in precedence order per route:
 * - the installed pi-ai catalog, for every route it ships that authenticates
 *   with a key (an OAuth-only provider has nothing to paste);
 * - a pi-ai settings profile naming a `baseURL`, which covers a hand-declared
 *   gateway the catalog has never heard of;
 * - a Bearer settings profile naming a `modelsURL`, whose listing endpoint is
 *   exact and needs no derivation.
 *
 * A catalog route the settings document overrides keeps one entry, and the
 * override wins: the user's own endpoint is the address the adapter itself
 * would call.
 * @param settings - the settings service, when one is mounted.
 * @returns the route directory.
 */
export function keyCheckRoutes(settings?: SettingsReader): readonly KeyCheckRoute[] {
  const routes = new Map<string, KeyCheckRoute>()
  for (const provider of catalogProviderIds()) {
    if (!catalogProviderTakesApiKey(provider)) continue
    const endpoint = catalogRouteEndpoint(provider)
    if (endpoint === undefined) continue
    routes.set(provider, {
      provider,
      displayName: provider,
      api: endpoint.api,
      modelsUrl: join(endpoint.baseUrl, LISTING_PATH),
      completionsUrl: completionsUrlFor(endpoint.baseUrl, endpoint.api),
      probeModel: endpoint.probeModel,
      source: 'catalog',
    })
  }
  for (const [provider, profile] of profilesOf(settings, PI_AI_SETTINGS_NAMESPACE)) {
    const baseUrl = text(profile, 'baseURL')
    if (baseUrl === undefined) continue
    const api = text(profile, 'api') ?? GATEWAY_DEFAULT_API
    routes.set(provider, {
      provider,
      displayName: text(profile, 'displayName') ?? provider,
      api,
      modelsUrl: join(baseUrl, LISTING_PATH),
      completionsUrl: completionsUrlFor(baseUrl, api),
      // A hand-declared gateway names no model of its own, so its probe is the
      // listing: guessing a model id here would be guessing at a catalog the
      // user deliberately routed around.
      source: 'settings',
    })
  }
  for (const [provider, profile] of profilesOf(settings, BEARER_SETTINGS_NAMESPACE)) {
    // A Bearer profile's modelsURL is exact — this adapter never derives one —
    // so a route that states no listing endpoint has nothing to probe.
    const modelsUrl = text(profile, 'modelsURL')
    if (modelsUrl === undefined) continue
    const api = text(profile, 'api') ?? GATEWAY_DEFAULT_API
    routes.set(provider, {
      provider,
      displayName: text(profile, 'displayName') ?? provider,
      api,
      modelsUrl,
      completionsUrl: completionsUrlFor(baseOf(modelsUrl), api),
      source: 'settings',
    })
  }
  return [...routes.values()]
}

/** Project the route directory to the identity pair the channel announces. */
export function providerDirectory(routes: readonly KeyCheckRoute[]): readonly KeyCheckProviderInfo[] {
  return routes.map(({ provider, displayName }) => ({ provider, displayName }))
}

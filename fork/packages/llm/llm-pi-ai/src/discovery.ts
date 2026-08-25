/**
 * Answering "which models can this provider serve?" for the configuration
 * surface's "fetch available models" action.
 *
 * A route the installed pi-ai catalog ships is answered **from that catalog
 * first**: its entries are authoritative for their own providers and carry the
 * capacities a listing endpoint would not disclose. When the draft also names
 * an endpoint this build can interrogate, the live listing is merged so ids
 * newer than the installed catalog still surface; a failed merge degrades to
 * the catalog answer. Only a route no catalog describes is interrogated over
 * the wire alone.
 *
 * Neither path is a catalog refresh. Nothing here is stored: the request
 * carries a draft the user is still editing, and the reply is candidate
 * metadata the surface offers for adoption. `settings.yaml` remains the only
 * thing that decides what a route serves.
 *
 * Only OpenAI-compatible protocols are interrogated. Their listing is the one
 * shape a gateway, a self-hosted server, and the official endpoints all agree
 * on, which is the case this action exists for; every other protocol reports
 * that it cannot be interrogated so the surface falls back to hand-entry
 * rather than guessing a response shape.
 *
 * @module dsh-llm-pi-ai/discovery
 */

import { INVALID_CREDENTIAL_CODE, LlmError, normalizeApiKey } from '@deepseek-ai/dsh-fork-llm'
import type { LlmDiscoveredModel, LlmModelDiscoveryRequest, ModelModality } from '@deepseek-ai/dsh-fork-llm'
import { attributionHeaders } from '@deepseek-ai/dsh-fork-llm'
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { ModelCatalog } from '@deepseek-ai/dsh-fork-model-catalog'
import { catalogModels, routeCatalogBaseUrl } from './catalog.ts'

/**
 * Protocols whose model listing this module can read: the two that speak
 * OpenAI's `GET /models` shape with bearer auth. Azure is absent despite its
 * OpenAI lineage — it authenticates with an `api-key` header and requires an
 * `api-version` query — and Codex authenticates through OAuth; guessing at
 * either would report an authentication failure as a provider with no models.
 * pi-ai's remaining protocols are absent for the same reason.
 */
const LISTABLE_PROTOCOLS: ReadonlySet<string> = new Set([
  'openai-completions',
  'openai-responses',
])

/**
 * Endpoint replies larger than this are refused. The endpoint is whatever URL
 * the user typed, so the ceiling holds on the bytes actually read rather than
 * on the length the server claims — the same two-stage shape `dsh-web-fetch`
 * uses for its own caller-supplied URLs, except that a truncated model listing
 * is not parseable, so overflow rejects instead of truncating.
 */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

/** One entry of an OpenAI-compatible `GET /models` reply. */
interface ListingEntry {
  id?: unknown
  /** Common gateway extensions; absent from the official listings. */
  name?: unknown
  display_name?: unknown
  context_window?: unknown
  context_length?: unknown
  max_tokens?: unknown
  max_output_tokens?: unknown
}

/** A positive integer field of a listing entry, or `undefined` when absent or unusable. */
function capacity(...candidates: readonly unknown[]): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0) return candidate
  }
  return undefined
}

/** A non-empty string field of a listing entry, or `undefined`. */
function label(...candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return undefined
}

/**
 * The listing URLs one draft endpoint is asked, most specific first. A base
 * that already names a version segment has one canonical listing path; any
 * other base also tries the `/v1/models` convention, because several
 * OpenAI-compatible providers mount their API one version segment below the
 * base their catalog publishes (`https://opencode.ai/zen/go` serves
 * `/zen/go/v1/models`) and answer a bare `/models` with 404.
 * @param baseURL - the endpoint base the draft names.
 * @returns the candidate listing URLs in probe order.
 */
function listingCandidates(baseURL: string): readonly string[] {
  const base = baseURL.replace(/\/+$/, '')
  const primary = `${base}/models`
  return /\/v\d+$/.test(base) ? [primary] : [primary, `${base}/v1/models`]
}

/**
 * Read a reply body, refusing one that outgrows the ceiling. A declared length
 * is checked first so an honest server is turned away without transferring
 * anything; the accumulated total is what actually enforces the bound, because
 * a server that under-declares (or streams) tells us nothing up front.
 */
async function readBounded(response: Response, url: string): Promise<string> {
  const oversized = (): LlmError =>
    new LlmError(`${url} answered with more than ${MAX_RESPONSE_BYTES} bytes`, 'DISCOVERY_FAILED')
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw oversized()
  }
  /* v8 ignore next -- fetch always exposes a body stream on a 2xx Response; the null guard is defensive. */
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw oversized()
      chunks.push(value)
    }
  } finally {
    /* v8 ignore next 4 -- cancel() after a completed or abandoned read settles without rejecting; unobserved best-effort cleanup. */
    await reader.cancel().catch(() => {
      // Cancel after a drained read, or after this function walked away from
      // an oversized one, is cleanup; the reply is already decided either way.
    })
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

/**
 * Read one OpenAI-compatible listing reply. Entries without a usable id are
 * skipped rather than failing the whole interrogation: a single malformed row
 * should not deny the user the rest of a working endpoint's catalog.
 */
function readListing(body: unknown): LlmDiscoveredModel[] {
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) {
    throw new LlmError(
      'the endpoint\'s model listing has no "data" array; enter this provider\'s models by hand',
      'DISCOVERY_FAILED',
    )
  }
  const models: LlmDiscoveredModel[] = []
  for (const raw of data) {
    const entry = raw as ListingEntry | null
    const id = label(entry?.id)
    if (id === undefined) continue
    const name = label(entry?.name, entry?.display_name)
    const contextWindow = capacity(entry?.context_window, entry?.context_length)
    const maxTokens = capacity(entry?.max_output_tokens, entry?.max_tokens)
    models.push({
      id,
      ...name === undefined ? {} : { name },
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
    })
  }
  return models
}

/**
 * Capability facts one listing entry gains from a reference catalog. The
 * endpoint's own listing shape carries none of these — an OpenAI-compatible
 * `/models` reply is ids and, on generous gateways, capacities — so every
 * field here is answered by the installed pi-ai catalog first and the shared
 * identity catalog second. Absence states "no reference knows this id", which
 * is its own useful answer for a surface deciding what an adopted row needs.
 */
interface ModelCapabilities {
  /** Accepted input modalities; text-only when the catalogs say nothing. */
  inputModalities?: readonly ModelModality[]
  /** Reasoning effort levels in escalation order; absent for unknown or non-reasoning models. */
  reasoningLevels?: readonly string[]
  /** Combined context capacity per the reference catalog, when it sizes one. */
  contextWindow?: number
  /** Output capability per the reference catalog, when it sizes one. */
  maxTokens?: number
  /** Whether any reference catalog described the exact id. */
  catalogMatched: boolean
}

/**
 * Answer one listing entry's capabilities from the two reference catalogs.
 * The installed pi-ai catalog wins: it is keyed by provider route, so its
 * entry describes what THIS endpoint's siblings speak, not merely what the
 * model is elsewhere. The identity catalog fills the rest by model id.
 * @param provider - the route being interrogated, when known.
 * @param id - the advertised model id.
 * @param identityCatalog - optional shared identity-catalog service.
 * @returns the capabilities both catalogs supply, or the unmatched marker.
 */
function capabilitiesFor(
  provider: string | undefined,
  id: string,
  identityCatalog: ModelCatalog | undefined,
): ModelCapabilities {
  if (provider !== undefined) {
    const installed = catalogModels(provider)
    const base = installed.get(id)
    if (base !== undefined) {
      return {
        ...base.input === undefined ? {} : { inputModalities: [...base.input] },
        ...base.reasoning ? { reasoningLevels: [...getSupportedThinkingLevels(base)] } : {},
        catalogMatched: true,
      }
    }
  }
  const reference = identityCatalog?.resolveFor(provider ?? '', id) ?? identityCatalog?.resolve(id)
  if (reference !== undefined) {
    const efforts = reference.thinking?.efforts ?? []
    return {
      ...reference.input.length === 0 ? {} : { inputModalities: [...reference.input] as readonly ModelModality[] },
      ...reference.reasoning && efforts.length > 0 ? { reasoningLevels: [...efforts] } : {},
      ...reference.contextWindow === undefined ? {} : { contextWindow: reference.contextWindow },
      ...reference.maxTokens === undefined ? {} : { maxTokens: reference.maxTokens },
      catalogMatched: true,
    }
  }
  return { catalogMatched: false }
}

/** The catalog-route answer: every installed entry, enriched where catalogs know it. */
function catalogAnswer(
  provider: string | undefined,
  installed: ReadonlyMap<string, Model<Api>>,
  identityCatalog: ModelCatalog | undefined,
): readonly LlmDiscoveredModel[] {
  return [...installed.values()].map((model) => {
    const entry: LlmDiscoveredModel = {
      id: model.id,
      name: model.name,
      ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
    }
    return withCapabilities(entry, capabilitiesFor(provider, model.id, identityCatalog))
  })
}

/**
 * Attach reference-catalog capabilities to one listing. The listing's own
 * fields win where they overlap — an endpoint disclosing a context window
 * knows its gateway better than a cross-provider reference does — so the
 * reference only fills what the listing left unsaid.
 * @param entry - one parsed listing row.
 * @param capabilities - what the reference catalogs answered.
 * @returns the enriched discovered-model row.
 */
function withCapabilities(entry: LlmDiscoveredModel, capabilities: ModelCapabilities): LlmDiscoveredModel {
  return {
    ...entry,
    ...entry.contextWindow === undefined && capabilities.contextWindow !== undefined
      ? { contextWindow: capabilities.contextWindow }
      : {},
    ...entry.maxTokens === undefined && capabilities.maxTokens !== undefined
      ? { maxTokens: capabilities.maxTokens }
      : {},
    ...capabilities.inputModalities === undefined ? {} : { inputModalities: capabilities.inputModalities },
    ...capabilities.reasoningLevels === undefined ? {} : { reasoningLevels: capabilities.reasoningLevels },
    catalogMatched: capabilities.catalogMatched,
  }
}

/**
 * Accept one probe key, or refuse it before the header is built. Without this
 * the `fetch` below would throw a ByteString `TypeError` that this function's
 * catch reports as `could not reach <url>` — blaming the network for a local,
 * deterministic fault.
 * @param raw - the key typed into the form or read from storage.
 * @returns the trimmed, usable key.
 */
function usableProbeKey(raw: string): string {
  const checked = normalizeApiKey(raw)
  if (checked.ok) return checked.value
  throw new LlmError(
    checked.reason === 'empty'
      ? 'this provider\'s API key is blank; enter it on the Models page, or clear it to probe unauthenticated'
      : 'this provider\'s API key contains characters no HTTP header can carry; paste the raw key only',
    INVALID_CREDENTIAL_CODE,
  )
}

/**
 * Interrogate one endpoint for the models it advertises, over the wire.
 * @param request - the endpoint, protocol, and one-shot credential to use.
 * @param storedApiKey - the credential the named route already stored, asked
 *   for only when the draft carries none. A configuration surface never holds
 *   a stored secret — it edits a redacted descriptor — so without this an
 *   already-configured route would be interrogated unauthenticated and answer 401.
 * @param provider - route key enriching entries from the installed catalog,
 *   when the interrogation serves a known route.
 * @param identityCatalog - optional shared identity catalog consulted for the
 *   capabilities (`input`, reasoning levels, capacities) a listing endpoint
 *   never reports, so an unlisted model can still be adopted with correct metadata.
 * @returns the advertised models in endpoint order, each carrying whatever
 *   capability facts the reference catalogs add.
 * @throws LlmError when the protocol has no readable listing, the endpoint
 *   refuses or fails the request, or the reply is not a model listing.
 */
async function probeListing(
  request: LlmModelDiscoveryRequest,
  storedApiKey?: () => Promise<string | undefined>,
  provider?: string,
  identityCatalog?: ModelCatalog,
): Promise<readonly LlmDiscoveredModel[]> {
  // A draft that has not chosen a protocol yet is asked as OpenAI Chat
  // Completions: it is the shape a gateway is overwhelmingly likely to speak,
  // and the alternative — refusing until the field is filled — would withhold
  // the action from the case it exists for. The cost is a misdirected message
  // when the endpoint speaks something else (an Anthropic gateway answers 401,
  // which reads as a credential problem), and hand-entry remains the way out.
  const api = request.api ?? 'openai-completions'
  if (!LISTABLE_PROTOCOLS.has(api)) {
    throw new LlmError(
      `pi-ai protocol "${api}" has no model listing this build can read; enter this provider's models by hand`,
      'DISCOVERY_UNSUPPORTED',
    )
  }
  const candidates = listingCandidates(request.baseURL as string)
  // A key typed into the form wins: it is the one the user is testing, and it
  // may be the replacement for exactly the stored key that is failing.
  // A probe carrying no key stays unauthenticated, which is how a route that
  // relies on the provider's own ambient discovery is meant to be asked.
  const supplied = request.apiKey ?? await storedApiKey?.()
  const apiKey = supplied === undefined ? undefined : usableProbeKey(supplied)
  // Candidates are asked in order. A 404 from a non-final candidate is "wrong
  // path, try the next"; every other outcome — success, another status, or a
  // 404 with nothing left to try — is the answer about this endpoint, and the
  // reply being reported is the last one received.
  let response: Response | undefined
  let url = candidates[candidates.length - 1] as string
  for (const candidate of candidates) {
    url = candidate
    try {
      response = await fetch(candidate, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          ...apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` },
          ...attributionHeaders(),
        },
        ...request.signal === undefined ? {} : { signal: request.signal },
      })
    } catch (error: unknown) {
      if (request.signal?.aborted) {
        throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
      }
      throw new LlmError(`could not reach ${candidate}`, 'DISCOVERY_FAILED', { cause: error })
    }
    if (response.ok) break
    if (response.status === 404 && candidate !== candidates[candidates.length - 1]) continue
    break
  }
  response = response as Response
  if (!response.ok) {
    throw new LlmError(
      `${url} answered ${response.status}${response.status === 401 || response.status === 403 ? '; check the API key' : ''}`,
      'DISCOVERY_FAILED',
    )
  }
  let text: string
  try {
    text = await readBounded(response, url)
  } catch (error: unknown) {
    // Cancellation during the body read rejects with the abort reason, which
    // may be any value; the caller gets the same coded failure it would have
    // for a cancellation before the request went out.
    if (request.signal?.aborted) {
      throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    throw error
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch (error: unknown) {
    throw new LlmError(`${url} did not answer with JSON`, 'DISCOVERY_FAILED', { cause: error })
  }
  return readListing(body).map(entry => withCapabilities(entry, capabilitiesFor(provider, entry.id, identityCatalog)))
}

/**
 * Answer "which models can this provider serve?" for one draft route.
 *
 * A route the installed pi-ai catalog ships is answered **from that catalog
 * first**: its entries carry capacities and capability facts no listing
 * endpoint reports. When the draft also names an endpoint this build can
 * interrogate, the live listing is merged in so ids newer than the installed
 * catalog — a provider's newest release — still surface; a live listing that
 * fails degrades silently to the catalog answer rather than failing an action
 * whose primary source already succeeded. A draft naming a catalog route with
 * no endpoint at all is interrogated at the route's own catalog endpoint,
 * because that is the same origin its configured siblings serve and the case
 * worth serving — a provider configured by key alone. Only a route no catalog
 * describes is answered by the wire alone.
 *
 * Neither path is a catalog refresh. Nothing here is stored: the request
 * carries a draft the user is still editing, and the reply is candidate
 * metadata the surface offers for adoption. `settings.yaml` remains the only
 * thing that decides what a route serves.
 * @param request - the provider key, endpoint, protocol, and one-shot credential.
 * @param storedApiKey - accessor for the named route's stored credential, used
 *   only on paths that reach the network.
 * @param identityCatalog - optional shared identity catalog enriching entries
 *   both catalogs are asked about.
 * @returns the advertised models — installed entries first, then endpoint-only
 *   ids in endpoint order — each carrying whatever the reference catalogs add.
 * @throws LlmError when neither a catalog nor a usable endpoint answers, the
 *   protocol has no readable listing, or a sole wire answer fails.
 */
export async function discoverModels(
  request: LlmModelDiscoveryRequest,
  storedApiKey?: () => Promise<string | undefined>,
  identityCatalog?: ModelCatalog,
): Promise<readonly LlmDiscoveredModel[]> {
  const installed = request.provider !== undefined ? catalogModels(request.provider) : undefined
  const hasEndpoint = request.baseURL !== undefined && request.baseURL.length > 0
  if (installed !== undefined && installed.size > 0) {
    const answer = catalogAnswer(request.provider, installed, identityCatalog)
    // Merge conditions mirror probeListing's own gates: only a protocol whose
    // listing shape this build reads is worth a round trip.
    const listable = LISTABLE_PROTOCOLS.has(request.api ?? 'openai-completions')
    if (!listable) return answer
    // A draft that names the route but no endpoint is still asked live — at
    // the endpoint the catalog itself serves. Without this, a provider
    // configured by key alone would answer with the installed snapshot forever,
    // and its newest models would stay invisible until a dependency upgrade.
    const endpoint = hasEndpoint ? request.baseURL : routeCatalogBaseUrl(request.provider as string, installed)
    if (endpoint === undefined) return answer
    try {
      const live = await probeListing(
        { ...request, baseURL: endpoint },
        storedApiKey,
        request.provider,
        identityCatalog,
      )
      return [...answer, ...live.filter(model => !installed.has(model.id))]
    } catch (error: unknown) {
      // The catalog already answered; enrichment that cannot be reached must
      // not fail the action. Cancellation is the one fault that propagates —
      // the user closed the dialog or navigated away.
      if (error instanceof LlmError && error.code === 'ABORTED') throw error
      return answer
    }
  }
  if (!hasEndpoint) {
    throw new LlmError(
      `pi-ai ships no catalog for provider "${request.provider ?? ''}", so its models can only come from its`
      + " endpoint; set a baseURL, or enter this provider's models by hand",
      'DISCOVERY_FAILED',
    )
  }
  return probeListing(request, storedApiKey, request.provider, identityCatalog)
}

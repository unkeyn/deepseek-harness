/**
 * Service Definition for the web access capability seam (`ctx.web`): registries and provider-selecting execution for search and
 * fetch. Duplicate ids are rejected. At execution time, a configured provider must exist and
 * be usable; without one, exactly one usable provider is required, so selection never depends
 * on registration order.
 * @module @deepseek-ai/dsh-fork-web
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
} from './types.ts'
import { WebError } from './types.ts'

export {
  WebError,
} from './types.ts'
export type {
  WebFetchBody,
  WebFetchProvider,
  WebFetchRequest,
  WebFetchResult,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    web: WebRuntime
  }
}

/** Selection inputs for execution-time provider resolution. */
interface Selection<P> {
  /** The configured provider id for this capability, if any. */
  readonly configuredId?: string
  /** Providers registered for this capability kind. */
  readonly providers: ReadonlyMap<string, P>
}

/** Ordered routes used by search execution. */
export interface WebSearchRoutingConfig {
  /** Ordered fallback provider ids for the default route. */
  readonly searchProviders?: readonly string[]
}

/**
 * Config for the web seam. An explicit search route tries providers in order;
 * an omitted route requires exactly one usable provider.
 */
export interface WebRuntimeConfig extends WebSearchRoutingConfig {
  /** Explicit search provider id retained as a one-entry route. */
  readonly searchProvider?: string
  /** Explicit fetch provider id. */
  readonly fetchProvider?: string
}

/**
 * The web access service. Registered as `ctx.web` (one instance per context).
 *
 * Selection semantics (resolved at execution time, never order-dependent):
 * - A configured id that is registered and `available()` → that provider.
 * - A configured id not registered → `WEB_PROVIDER_CONFIGURED_MISSING`.
 * - A configured id registered but unavailable →
 *   `WEB_PROVIDER_CONFIGURED_UNAVAILABLE`.
 * - No id configured, exactly one registered usable provider → that provider.
 * - No id configured, multiple usable providers → `WEB_PROVIDER_AMBIGUOUS`.
 * - No id configured, no usable provider → `WEB_PROVIDER_UNAVAILABLE`.
 */
export class WebRuntime extends Service {
  /**
   * Provider selection config. Operational env overrides feed the SAME fields:
   * `$DSH_WEB_SEARCH_PROVIDER` / `$DSH_WEB_FETCH_PROVIDER` are equivalent to
   * `searchProvider` / `fetchProvider` and are NOT a hidden priority chain.
   */
  static Config: z<WebRuntimeConfig> = z.object({
    searchProviders: z.array(z.string()),
    searchProvider: z.string(),
    fetchProvider: z.string(),
  }) as z<WebRuntimeConfig>

  private searchProviders = new Map<string, WebSearchProvider>()
  private fetchProviders = new Map<string, WebFetchProvider>()
  private readonly searchRoute: readonly string[] | undefined
  private readonly fetchProviderId: string | undefined

  constructor(ctx: Context, config: WebRuntimeConfig = {}) {
    super(ctx, 'web')
    this.searchRoute = resolveSearchProviderIds(config)
    this.fetchProviderId = config.fetchProvider ?? process.env.DSH_WEB_FETCH_PROVIDER
  }

  /**
   * Contribute the capability's research-methodology guidance once the service
   * mounts. The text is provider-agnostic and assumes the fork composition
   * exposes both `web_search` and `web_fetch`; compositions that drop one of
   * the tools own replacing or removing this section.
   */
  protected [Service.init](): void {
    const systemPrompt = this.ctx.get('systemPrompt')
    if (systemPrompt === undefined) return
    systemPrompt.section({
      name: 'web:research',
      order: 112,
      text: 'Research current topics with web_search, then verify before trusting: result snippets and summary answers are discovery aids, not evidence. Open the decisive sources with web_fetch and confirm each page actually supports the claim before citing it. Prefer primary sources such as official documentation, specifications, papers, and primary reporting over aggregators; corroborate important claims across independent sources, and say so when sources disagree. Never use web_search for a URL you already know; fetch it directly. When results miss, narrow or re-angle the query instead of repeating a similar one. State publication dates when recency affects the answer, and mark anything you could not verify as unverified.',
    })
  }

  /**
   * Register a search provider. Throws {@link WebError} `WEB_DUPLICATE_PROVIDER`
   * if its id is already registered for search. Returns a disposer; disposed
   * with the calling fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerSearchProvider(provider: WebSearchProvider): () => void {
    return this.registerProvider(this.searchProviders, provider)
  }

  /**
   * Register a fetch provider. Throws {@link WebError} `WEB_DUPLICATE_PROVIDER`
   * if its id is already registered for fetch. Returns a disposer; disposed
   * with the calling fiber.
   * @param provider - the provider; its `id` is the registry key.
   * @returns the disposer that unregisters the provider.
   */
  registerFetchProvider(provider: WebFetchProvider): () => void {
    return this.registerProvider(this.fetchProviders, provider)
  }

  private registerProvider<P extends { readonly id: string }>(store: Map<string, P>, provider: P): () => void {
    if (store.has(provider.id)) {
      throw new WebError(`a web provider with id "${provider.id}" is already registered`, 'WEB_DUPLICATE_PROVIDER')
    }
    const dispose = this.ctx.effect(function* () {
      store.set(provider.id, provider)
      yield () => store.delete(provider.id)
    }, 'web.registerProvider()')
    // ctx.effect's disposer returns Promise<void>; our disposer API is
    // synchronous fire-and-forget — discard the (always-resolved) promise.
    return () => void dispose()
  }

  /**
   * Run one search through the selected route. An explicit route tries usable
   * providers in order; without one, strict single-provider selection applies.
   * Cancellation stops the route and is never converted into fallback.
   * @param request - query and optional result limit.
   * @param signal - cancellation forwarded to each attempted provider.
   * @returns the first successful result, capped to `request.maxResults`.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    throwIfAborted(signal)
    if (this.searchRoute === undefined) {
      const provider = resolveProvider({ providers: this.searchProviders })
      return capSources(await provider.search(request, signal), request.maxResults)
    }

    const providers = resolveSearchRoute(this.searchRoute, this.searchProviders)
    if (providers.length === 1) {
      const [provider] = providers
      /* v8 ignore next -- resolveSearchRoute guarantees one provider for this branch. */
      if (provider === undefined) throw new WebError('configured search provider is unavailable', 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
      return capSources(await provider.search(request, signal), request.maxResults)
    }
    const failures: Array<{ readonly id: string; readonly error: unknown }> = []
    for (const provider of providers) {
      throwIfAborted(signal)
      try {
        return capSources(await provider.search(request, signal), request.maxResults)
      } catch (error: unknown) {
        if (isCancellation(error, signal)) throw normalizeAbort(error, signal)
        failures.push({ id: provider.id, error })
      }
    }
    throw new WebError(
      `all configured search providers failed (${failures.map(item => `${item.id}: ${errorSummary(item.error)}`).join('; ')})`,
      'WEB_PROVIDER_CHAIN_FAILED',
    )
  }

  /**
   * Retrieve one URL through the selected provider. Resolves the provider at
   * call time with the selection rules above; throws {@link WebError} when the
   * capability cannot run. A non-2xx response is a result, not a throw.
   * @param request - the URL plus retrieval options.
   * @param signal - optional cancellation signal forwarded to the provider.
   * @returns the retrieval outcome; non-2xx responses resolve descriptively.
   */
  async fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    const provider = resolveProvider({
      providers: this.fetchProviders,
      ...this.fetchProviderId !== undefined ? { configuredId: this.fetchProviderId } : {},
    })
    return provider.fetch(request, signal)
  }
}

interface ResolvableProvider {
  readonly id: string
  available(): boolean
}

function resolveSearchProviderIds(config: WebRuntimeConfig): readonly string[] | undefined {
  if (config.searchProviders !== undefined && config.searchProviders.length > 0) {
    return freezeRoute(config.searchProviders, 'searchProviders')
  }
  if (config.searchProvider !== undefined) return freezeRoute([config.searchProvider], 'searchProvider')
  const environmentRoute = process.env.DSH_WEB_SEARCH_PROVIDERS
  if (environmentRoute !== undefined && environmentRoute.trim().length > 0) {
    return freezeRoute(environmentRoute.split(',').map(id => id.trim()), 'DSH_WEB_SEARCH_PROVIDERS')
  }
  const environmentProvider = process.env.DSH_WEB_SEARCH_PROVIDER
  return environmentProvider === undefined ? undefined : freezeRoute([environmentProvider], 'DSH_WEB_SEARCH_PROVIDER')
}

function freezeRoute(route: readonly string[], field: string): readonly string[] {
  if (route.length === 0) throw new Error(`web: ${field} must contain at least one provider id`)
  if (route.some(id => id.length === 0)) throw new Error(`web: ${field} provider ids must be non-empty`)
  if (new Set(route).size !== route.length) throw new Error(`web: ${field} provider ids must be unique`)
  return Object.freeze([...route])
}

function resolveSearchRoute(
  route: readonly string[],
  providers: ReadonlyMap<string, WebSearchProvider>,
): WebSearchProvider[] {
  const missing = route.filter(id => !providers.has(id))
  if (missing.length > 0) {
    throw new WebError(
      `configured search provider${missing.length === 1 ? '' : 's'} not registered: ${missing.join(', ')}`,
      'WEB_PROVIDER_CONFIGURED_MISSING',
    )
  }
  const usable = route.flatMap((id) => {
    const provider = providers.get(id)
    return provider?.available() === true ? [provider] : []
  })
  if (usable.length === 0) {
    throw new WebError(`configured search providers are unavailable: ${route.join(', ')}`, 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
  }
  return usable
}

/** Resolve one configured provider or the sole usable provider. */
function resolveProvider<P extends ResolvableProvider>(selection: Selection<P>): P {
  const { configuredId, providers } = selection
  if (configuredId !== undefined) {
    const provider = providers.get(configuredId)
    if (!provider) {
      throw new WebError(`configured web provider "${configuredId}" is not registered`, 'WEB_PROVIDER_CONFIGURED_MISSING')
    }
    if (!provider.available()) {
      throw new WebError(`configured web provider "${configuredId}" is registered but unavailable`, 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
    }
    return provider
  }
  const usable = [...providers.values()].filter(provider => provider.available())
  const [single] = usable
  if (single === undefined) throw new WebError('no usable web provider is registered', 'WEB_PROVIDER_UNAVAILABLE')
  if (usable.length > 1) {
    const ids = usable.map(provider => provider.id).join(', ')
    throw new WebError(`multiple usable web providers are registered (${ids}); configure one explicitly`, 'WEB_PROVIDER_AMBIGUOUS')
  }
  return single
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw normalizeAbort(signal.reason, signal)
}

function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true
    || (error instanceof WebError && error.code === 'WEB_ABORTED')
    || (error instanceof DOMException && error.name === 'AbortError')
}

function normalizeAbort(error: unknown, signal?: AbortSignal): WebError {
  if (error instanceof WebError && error.code === 'WEB_ABORTED') return error
  return new WebError('web search aborted', 'WEB_ABORTED', { cause: signal?.reason ?? error })
}

function errorSummary(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Enforce `maxResults` on a search result: truncate sources and set `truncated`. */
function capSources(result: WebSearchResult, maxResults: number | undefined): WebSearchResult {
  if (maxResults === undefined || result.sources.length <= maxResults) return result
  return { ...result, sources: result.sources.slice(0, maxResults), truncated: true }
}

export default WebRuntime

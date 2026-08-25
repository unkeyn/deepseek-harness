import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-fork-web'
import { WebError } from '@deepseek-ai/dsh-fork-web'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { checkProviderKeys, type PoolKeyCheckResult } from './check.ts'
import { installCheckRoute } from './route.ts'
import type { KeyHealthPatch, PoolConfig, PoolKey, PoolProvider, RuntimeConfig } from './types.ts'

export const name = 'web-search-pool'
export const inject = ['web', 'tools', 'systemPrompt']
/** Settings namespace for user-managed custom web search pools. */
export const WEB_SEARCH_POOL_SETTINGS_NAMESPACE = settingsNamespace('web-search-pool')
/** Provider id registered in the web search route. */
export const WEB_SEARCH_POOL_PROVIDER_ID = 'custom-pool'

export type { KeyHealthPatch, PoolCheckSpec, PoolConfig, PoolKey, PoolProvider, RuntimeConfig } from './types.ts'
export { checkProviderKeys, type PoolKeyCheckResult } from './check.ts'

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_COOLDOWN_MS = 30_000
const MAX_PROVIDERS = 32
const MAX_KEYS_PER_PROVIDER = 32

/** User-managed provider pool configuration. */
export interface Config extends PoolConfig {}

export const Config: z<Config> = z.object({
  providers: z.array(z.object({
    id: z.string(), name: z.string(), priority: z.number().default(0), endpoint: z.string(), method: z.union(['GET', 'POST'] as const),
    queryParam: z.string().default('q'), requestBody: z.union(['query', 'exa'] as const).default('query'), authMode: z.union(['header', 'bearer', 'query'] as const).default('header'),
    authName: z.string().default('x-api-key'), responseResultsPath: z.string().default('results'),
    resultUrlPath: z.string().default('url'), resultTitlePath: z.string().default('title'),
    resultSnippetPath: z.string().default('snippet'), resultDatePath: z.string().default('publishedAt'),
    check: z.object({
      endpoint: z.string(),
      method: z.union(['GET', 'POST'] as const),
      usagePath: z.string(),
      limitPath: z.string(),
      remainingPath: z.string(),
    }),
    keys: z.array(z.object({ id: z.string(), ref: z.string(), enabled: z.boolean().default(true), priority: z.number().default(0), maxConcurrent: z.number().default(1), cooldownUntil: z.number(), quarantineUntil: z.number(), lastError: z.string(), lastStatus: z.number() })).default([]),
    enabled: z.boolean().default(true),
  })).default([]),
  maxAttempts: z.number().default(DEFAULT_MAX_ATTEMPTS), cooldownMs: z.number().default(DEFAULT_COOLDOWN_MS),
})

export function apply(ctx: Context, config: Config): void {
  // The runtime config rebuilds from the authoritative source at every commit:
  // a provider or key the user saves in the UI joins the live pool without a
  // restart, exactly like the key-health patches do.
  let source: (() => Config) | undefined
  let current = resolveConfig(config)
  const refresh = (): void => {
    if (source !== undefined) current = resolveConfig(source())
  }
  const patchLiveKey = (providerId: string, keyId: string, patch: KeyHealthPatch): void => {
    current = patchRuntimeKey(current, providerId, keyId, patch)
  }
  installSettingsSection(ctx, WEB_SEARCH_POOL_SETTINGS_NAMESPACE, Config, config, {
    setSource: (next) => {
      source = next
      current = resolveConfig(next())
    },
    onChange: refresh,
    validate: validateConfig,
  })
  installCheckRoute(ctx, providerId => checkProviderKeys({ resolveCredential: resolveStoredCredential(ctx), config: current }, providerId))
  ctx.web.registerSearchProvider(new CustomPoolProvider(ctx, () => current, patchLiveKey))
  ctx.systemPrompt.section({
    name: 'tool:web_search_pool',
    order: 111,
    text: 'Use web_search_pool_status to inspect custom search providers, key health, validity, and remaining credits (credits appear for providers that publish an account endpoint; secrets are never returned). Use web_search_pool_rotate only to disable, enable, or cooldown a named key after a provider error. When a custom pool serves searches, check web_search_pool_status after failures or before long research runs, and factor the remaining credits of each key into how many searches you run.',
  })
  ctx.tools.register(defineTool({
    name: 'web_search_pool_status',
    description: 'Inspect custom web search providers, eligible keys, cooldowns, redacted error status, and remaining per-key credits for providers that publish an account endpoint. Never returns API key values.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { providers: { type: 'array', required: true } } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: () => poolStatusWithCredits(ctx, current),
  }))
  ctx.tools.register(defineTool({
    name: 'web_search_pool_rotate',
    description: 'Disable, enable, or cooldown one custom web search key by provider id and key id. This does not expose or accept a secret.',
    parameters: {
      provider_id: { type: 'string', required: true },
      key_id: { type: 'string', required: true },
      action: { type: 'string', required: true, enum: ['disable', 'enable', 'cooldown'] },
      cooldown_ms: { type: 'number', description: 'Cooldown duration for action cooldown; positive integer, capped by the pool policy.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, message: { type: 'string', required: true } } },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args) {
      const duration = args.cooldown_ms === undefined ? current.cooldownMs : Math.min(Math.max(1, Math.trunc(args.cooldown_ms)), 86_400_000)
      await rotateKey(ctx, current, args.provider_id, args.key_id, args.action, duration, patchLiveKey)
      return { ok: true, message: `custom web search key ${args.provider_id}/${args.key_id} updated` }
    },
  }))
}

/** The credential-store read one key check authenticates with. */
function resolveStoredCredential(ctx: Context): (ref: ReturnType<typeof credentialRef>) => Promise<{ value: string } | undefined> {
  return async (ref) => {
    const credentials = ctx.get('credentials')
    if (credentials === undefined) throw new WebError('custom web search credentials service is unavailable', 'WEB_PROVIDER_UNAVAILABLE')
    return credentials.resolve(ref)
  }
}

class CustomPoolProvider implements WebSearchProvider {
  readonly id = WEB_SEARCH_POOL_PROVIDER_ID
  private readonly active = new Map<string, number>()
  private rotation = 0

  constructor(
    private readonly ctx: Context,
    private readonly getConfig: () => RuntimeConfig,
    private readonly patchConfig: (providerId: string, keyId: string, patch: KeyHealthPatch) => void,
  ) {}

  available(): boolean {
    const now = Date.now()
    return this.getConfig().providers.some(provider => provider.enabled && provider.keys.some(key =>
      key.enabled && (key.cooldownUntil ?? 0) <= now && (key.quarantineUntil ?? 0) <= now
      && (this.active.get(`${provider.id}/${key.id}`) ?? 0) < key.maxConcurrent))
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const config = this.getConfig()
    const candidates = rotateTopTier(config.providers.flatMap(provider => provider.enabled
      ? provider.keys.filter(key => key.enabled && (key.cooldownUntil ?? 0) <= Date.now() && (key.quarantineUntil ?? 0) <= Date.now()
        && (this.active.get(`${provider.id}/${key.id}`) ?? 0) < key.maxConcurrent).map(key => ({ provider, key }))
      : [])
      .sort((a, b) => b.provider.priority - a.provider.priority || b.key.priority - a.key.priority), this.rotation++)
    if (candidates.length === 0) throw new WebError('custom web search pool has no eligible provider keys', 'WEB_PROVIDER_UNAVAILABLE')
    const failures: string[] = []
    const attempted = new Set<string>()
    for (let attempt = 0; attempt < Math.min(config.maxAttempts, candidates.length); attempt += 1) {
      const candidate = candidates.find(item => !attempted.has(`${item.provider.id}/${item.key.id}`))
      if (candidate === undefined) break
      const candidateId = `${candidate.provider.id}/${candidate.key.id}`
      attempted.add(candidateId)
      this.active.set(candidateId, (this.active.get(candidateId) ?? 0) + 1)
      try {
        const result = await searchWithCandidate(this.ctx, candidate.provider, candidate.key, request, signal)
        this.patchConfig(candidate.provider.id, candidate.key.id, { clearCooldown: true, clearQuarantine: true, clearError: true, clearStatus: true })
        await updateKey(this.ctx, candidate.provider.id, candidate.key.id, { clearCooldown: true, clearQuarantine: true, clearError: true, clearStatus: true })
        return result
      } catch (error: unknown) {
        if (signal?.aborted === true) throw new WebError('custom web search aborted', 'WEB_ABORTED', { cause: error })
        const status = statusOf(error)
        const message = safeFailureMessage(error, status)
        failures.push(`${candidate.provider.name}/${candidate.key.id}: ${message}`)
        const health = healthPatch(status, config.cooldownMs)
        this.patchConfig(candidate.provider.id, candidate.key.id, { ...health, lastError: message, ...(status === undefined ? {} : { lastStatus: status }) })
        await updateKey(this.ctx, candidate.provider.id, candidate.key.id, {
          ...health,
          lastError: message, ...(status === undefined ? {} : { lastStatus: status }),
        })
      } finally {
        const active = this.active.get(candidateId) ?? 0
        if (active <= 1) this.active.delete(candidateId)
        else this.active.set(candidateId, active - 1)
      }
    }
    throw new WebError(`custom web search pool exhausted: ${failures.join('; ')}`, 'WEB_PROVIDER_CHAIN_FAILED')
  }
}

/**
 * Rotate the start of the attempt order within the top priority tier, so
 * concurrent searches spread across the best keys instead of pinning one;
 * lower tiers keep their failover order.
 */
function rotateTopTier<Item extends { provider: { priority: number }; key: { priority: number } }>(candidates: readonly Item[], rotation: number): Item[] {
  const first = candidates[0]
  if (first === undefined) return []
  const tierOf = (item: Item): string => `${item.provider.priority}:${item.key.priority}`
  const head = candidates.findIndex(candidate => tierOf(candidate) !== tierOf(first))
  const topCount = head === -1 ? candidates.length : head
  const offset = rotation % topCount
  return [...candidates.slice(offset, topCount), ...candidates.slice(0, offset), ...candidates.slice(topCount)]
}

async function searchWithCandidate(ctx: Context, provider: PoolProvider, key: PoolKey, request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
  const url = provider.method === 'GET' ? addQuery(provider.endpoint, provider.queryParam, request.query) : provider.endpoint
  const headers: Record<string, string> = { accept: 'application/json', 'user-agent': 'deepseek-harness/custom-web-search' }
  const value = await resolveKey(ctx, key)
  const queryKey = provider.authMode === 'query' ? `${provider.authName}=${encodeURIComponent(value)}` : ''
  if (provider.authMode === 'header') headers[provider.authName] = value
  if (provider.authMode === 'bearer') headers.authorization = `Bearer ${value}`
  const body = provider.requestBody === 'exa'
    ? { query: request.query, type: 'auto', contents: { highlights: { highlightsPerUrl: 1 } } }
    : { [provider.queryParam]: request.query }
  const response = await fetch(queryKey.length > 0 ? `${url}${url.includes('?') ? '&' : '?'}${queryKey}` : url, {
    method: provider.method, redirect: 'error', headers,
    ...(provider.method === 'POST' ? { body: JSON.stringify(body), headers: { ...headers, 'content-type': 'application/json' } } : {}),
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status })
  const payload = await response.json() as unknown
  return mapResult(payload, provider)
}

async function resolveKey(ctx: Context, key: PoolKey): Promise<string> {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) throw new WebError('custom web search credentials service is unavailable', 'WEB_PROVIDER_UNAVAILABLE')
  const value = await credentials.resolve(credentialRef(key.ref))
  if (value === undefined) throw new WebError(`custom web search credential '${key.ref}' is not configured`, 'WEB_CREDENTIAL_MISSING')
  return value.value
}

function mapResult(payload: unknown, provider: PoolProvider): WebSearchResult {
  const raw = getPath(payload, provider.responseResultsPath)
  if (!Array.isArray(raw)) throw new WebError(`custom provider '${provider.name}' returned no results array`, 'WEB_PROVIDER_ERROR')
  const sources = raw.flatMap(item => {
    const url = getPath(item, provider.resultUrlPath)
    if (typeof url !== 'string' || url.length === 0) return []
    const source: WebSearchSource = { url }
    const title = getPath(item, provider.resultTitlePath)
    const snippet = getPath(item, provider.resultSnippetPath)
    const date = getPath(item, provider.resultDatePath)
    return [{ ...source, ...(typeof title === 'string' ? { title } : {}), ...(typeof snippet === 'string' ? { snippet } : {}), ...(typeof date === 'string' ? { publishedAt: date } : {}) }]
  })
  return { sources, truncated: false }
}

function getPath(value: unknown, path: string): unknown {
  let current: unknown = value
  for (const part of path.split('.').filter(Boolean)) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}
function addQuery(endpoint: string, name: string, value: string): string { return `${endpoint}${endpoint.includes('?') ? '&' : '?'}${encodeURIComponent(name)}=${encodeURIComponent(value)}` }
function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : undefined
}

function safeFailureMessage(error: unknown, status: number | undefined): string {
  if (status !== undefined) return `HTTP ${status}`
  if (error instanceof WebError) return error.code
  if (error instanceof DOMException && error.name === 'AbortError') return 'aborted'
  return 'provider request failed'
}

function healthPatch(status: number | undefined, cooldownMs: number): Partial<PoolKey> {
  const until = Date.now() + cooldownMs
  // 402 is out-of-credits: the key is accepted but cannot serve, so it waits
  // out the same quarantine an authorization denial gets.
  if (status === 401 || status === 402 || status === 403) return { quarantineUntil: until, cooldownUntil: until }
  return { cooldownUntil: until }
}

function patchRuntimeKey(config: RuntimeConfig, providerId: string, keyId: string, patch: KeyHealthPatch): RuntimeConfig {
  return {
    ...config,
    providers: config.providers.map(provider => provider.id !== providerId ? provider : {
      ...provider,
      keys: provider.keys.map(key => key.id !== keyId ? key : applyKeyPatch(key, patch)),
    }),
  }
}

function applyKeyPatch(key: PoolKey, patch: KeyHealthPatch): PoolKey {
  const next = { ...key, ...patch }
  if (patch.clearCooldown === true) delete next.cooldownUntil
  if (patch.clearQuarantine === true) delete next.quarantineUntil
  if (patch.clearError === true) delete next.lastError
  if (patch.clearStatus === true) delete next.lastStatus
  delete next.clearCooldown
  delete next.clearQuarantine
  delete next.clearError
  delete next.clearStatus
  return next
}

function resolveConfig(config: Config): RuntimeConfig {
  return {
    providers: (config.providers ?? []).map(provider => {
      const next: PoolProvider = {
        ...provider,
        priority: provider.priority ?? 0,
        keys: provider.keys.map(key => ({ ...key, maxConcurrent: key.maxConcurrent ?? 1 })),
        requestBody: provider.requestBody ?? 'query',
      }
      // Schemastery materializes an absent nested object as `{}`; a check
      // spec without a usable endpoint is no spec at all.
      if (!isUsableCheck(next.check)) delete next.check
      return next
    }),
    maxAttempts: config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    cooldownMs: config.cooldownMs ?? DEFAULT_COOLDOWN_MS,
  }
}

/** Whether one check spec carries an endpoint a request could actually target. */
function isUsableCheck(check: PoolProvider['check']): boolean {
  return typeof check?.endpoint === 'string' && URL.canParse(check.endpoint)
}
function validateConfig(config: Config): void {
  if ((config.providers?.length ?? 0) > MAX_PROVIDERS) throw new Error(`web-search-pool supports at most ${MAX_PROVIDERS} providers`)
  if ((config.providers ?? []).some(provider => provider.keys.length > MAX_KEYS_PER_PROVIDER)) throw new Error(`web-search-pool supports at most ${MAX_KEYS_PER_PROVIDER} keys per provider`)
  if (!Number.isSafeInteger(config.maxAttempts) || (config.maxAttempts ?? 0) < 1) throw new Error('web-search-pool maxAttempts must be a positive integer')
  if (!Number.isSafeInteger(config.cooldownMs) || (config.cooldownMs ?? 0) < 0) throw new Error('web-search-pool cooldownMs must be a non-negative integer')
  const ids = (config.providers ?? []).map(provider => provider.id)
  if (new Set(ids).size !== ids.length) throw new Error('web-search-pool provider ids must be unique')
  const refs: string[] = []
  for (const provider of config.providers ?? []) {
    if (provider.id.length === 0 || provider.name.length === 0) throw new Error('web-search-pool provider id and name must be non-empty')
    if (!Number.isSafeInteger(provider.priority) || provider.priority < 0) throw new Error(`web-search-pool provider '${provider.id}' priority must be a non-negative integer`)
    if (!URL.canParse(provider.endpoint) || new URL(provider.endpoint).protocol !== 'https:') throw new Error(`web-search-pool provider '${provider.id}' endpoint must be an absolute HTTPS URL`)
    // A materialized-empty check spec (`{}`) is absence, not misconfiguration;
    // only a spec that names an endpoint must name a usable one.
    if (typeof provider.check?.endpoint === 'string'
      && (!URL.canParse(provider.check.endpoint) || new URL(provider.check.endpoint).protocol !== 'https:')) {
      throw new Error(`web-search-pool provider '${provider.id}' check endpoint must be an absolute HTTPS URL`)
    }
    for (const key of provider.keys) {
      if (!Number.isSafeInteger(key.maxConcurrent) || key.maxConcurrent < 1) throw new Error(`web-search-pool key '${key.id}' maxConcurrent must be a positive integer`)
      credentialRef(key.ref)
      if (key.id.length === 0) throw new Error(`web-search-pool provider '${provider.id}' key id must be non-empty`)
      if (refs.includes(key.ref)) throw new Error(`web-search-pool credential reference '${key.ref}' is duplicated`)
      refs.push(key.ref)
    }
  }
}
function poolStatus(config: RuntimeConfig): {
  providers: Array<{
    id: string
    name: string
    priority: number
    enabled: boolean
    credits?: Array<PoolKeyCheckResult>
    keys: Array<{ id: string; ref: string; enabled: boolean; maxConcurrent: number; eligible: boolean; cooldownUntil?: number; quarantineUntil?: number; lastError?: string; lastStatus?: number }>
  }>
} {
  const now = Date.now()
  return {
    providers: config.providers.map(provider => ({
      id: provider.id,
      name: provider.name,
      priority: provider.priority,
      enabled: provider.enabled,
      keys: provider.keys.map(key => ({
        id: key.id,
        ref: key.ref,
        enabled: key.enabled,
        maxConcurrent: key.maxConcurrent,
        eligible: provider.enabled && key.enabled && (key.cooldownUntil ?? 0) <= now && (key.quarantineUntil ?? 0) <= now,
        ...key.cooldownUntil === undefined ? {} : { cooldownUntil: key.cooldownUntil },
        ...key.quarantineUntil === undefined ? {} : { quarantineUntil: key.quarantineUntil },
        ...key.lastError === undefined ? {} : { lastError: key.lastError },
        ...key.lastStatus === undefined ? {} : { lastStatus: key.lastStatus },
      })),
    })),
  }
}

/** Cached account-endpoint credit posture per provider id, refreshed at most once per TTL. */
const creditCache = new Map<string, { at: number; results: PoolKeyCheckResult[] }>()
const CREDIT_CACHE_TTL_MS = 60_000

/**
 * The status payload enriched with per-key credit numbers for providers that
 * publish an account endpoint. Pings never run here — a status read must not
 * spend searches — and a failed lookup leaves the health fields as the answer.
 */
async function poolStatusWithCredits(ctx: Context, config: RuntimeConfig): Promise<ReturnType<typeof poolStatus>> {
  const status = poolStatus(config)
  for (const provider of status.providers) {
    const source = config.providers.find(candidate => candidate.id === provider.id)
    if (source === undefined || !isUsableCheck(source.check)) continue
    const cached = creditCache.get(provider.id)
    if (cached === undefined || Date.now() - cached.at >= CREDIT_CACHE_TTL_MS) {
      try {
        const results = await checkProviderKeys({ resolveCredential: resolveStoredCredential(ctx), config }, provider.id)
        creditCache.set(provider.id, { at: Date.now(), results })
      } catch {
        continue
      }
    }
    const cachedResults = creditCache.get(provider.id)?.results
    if (cachedResults !== undefined) provider.credits = cachedResults
  }
  return status
}

async function rotateKey(
  ctx: Context,
  config: RuntimeConfig,
  providerId: string,
  keyId: string,
  action: 'disable' | 'enable' | 'cooldown',
  cooldownMs: number,
  patchLiveKey: (providerId: string, keyId: string, patch: KeyHealthPatch) => void,
): Promise<void> {
  const provider = config.providers.find(candidate => candidate.id === providerId)
  const key = provider?.keys.find(candidate => candidate.id === keyId)
  if (provider === undefined || key === undefined) throw new WebError(`custom web search key '${providerId}/${keyId}' was not found`, 'WEB_PROVIDER_ERROR')
  const settings = ctx.get('settings')
  if (settings === undefined) throw new WebError('custom web search settings service is unavailable', 'WEB_PROVIDER_UNAVAILABLE')
  const livePatch: KeyHealthPatch = {
    enabled: action === 'disable' ? false : action === 'enable' ? true : key.enabled,
    ...action === 'enable' ? { clearCooldown: true, clearQuarantine: true, clearError: true, clearStatus: true } : {},
    ...action === 'cooldown' ? { cooldownUntil: Date.now() + cooldownMs, lastError: 'manually cooled down' } : {},
  }
  patchLiveKey(providerId, keyId, livePatch)
  const providers = config.providers.map(candidate => candidate.id !== providerId ? candidate : {
    ...candidate,
    keys: candidate.keys.map(item => item.id !== keyId ? item : applyKeyPatch(item, livePatch)),
  })
  await settings.update(WEB_SEARCH_POOL_SETTINGS_NAMESPACE, { providers })
}
const healthWrites = new WeakMap<object, Promise<void>>()

async function updateKey(
  ctx: Context,
  providerId: string,
  keyId: string,
  patch: KeyHealthPatch,
): Promise<void> {
  const settings = ctx.get('settings')
  if (settings === undefined) return
  const owner = settings as unknown as object
  const previous = healthWrites.get(owner) ?? Promise.resolve()
  const next = previous.then(async () => {
    const current = settings.get(WEB_SEARCH_POOL_SETTINGS_NAMESPACE) as Config | undefined
    if (current?.providers === undefined) return
    const providers = current.providers.map(provider => provider.id !== providerId ? provider : {
      ...provider,
      keys: provider.keys.map(key => {
        if (key.id !== keyId) return key
        const updated = { ...key, ...patch }
        if (patch.clearCooldown === true) delete updated.cooldownUntil
        if (patch.clearQuarantine === true) delete updated.quarantineUntil
        if (patch.clearError === true) delete updated.lastError
        if (patch.clearStatus === true) delete updated.lastStatus
        delete updated.clearCooldown
        delete updated.clearQuarantine
        delete updated.clearError
        delete updated.clearStatus
        return updated
      }),
    })
    try {
      await settings.update(WEB_SEARCH_POOL_SETTINGS_NAMESPACE, { providers })
    } catch {
      // Health persistence must not change the provider result.
    }
  })
  healthWrites.set(owner, next)
  await next
  if (healthWrites.get(owner) === next) healthWrites.delete(owner)
}

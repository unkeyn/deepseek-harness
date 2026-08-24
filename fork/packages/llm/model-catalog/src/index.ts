import { Context, Service } from '@deepseek-ai/cordis'
import MODELS from '@oh-my-pi/pi-catalog/models.json' with { type: 'json' }
import z from '@deepseek-ai/schemastery'

type RawModel = {
  id: string
  name?: string
  input?: readonly string[]
  reasoning?: boolean
  thinking?: { mode: string; efforts?: readonly string[]; defaultLevel?: string }
  contextWindow?: number | null
  maxTokens?: number | null
}

/** One provider's models as the generated catalog publishes them. */
type CatalogProvider = Record<string, RawModel>

/** The full catalog document: providers keyed by id, each holding its models by id. */
type CatalogSource = Record<string, CatalogProvider>

/**
 * One capability reference resolved for a specific catalog provider. The
 * generated database records per-provider wire facts (reasoning effort
 * spellings differ across gateways serving the same model), so a consumer
 * naming the provider should see that provider's own entry before any
 * cross-provider best pick.
 */
export interface ModelCapabilityReference {
  readonly id: string
  readonly name: string
  readonly input: readonly string[]
  readonly reasoning: boolean
  readonly thinking?: {
    mode: string
    efforts: readonly string[]
    /** The level this provider serves when a request names none. */
    defaultLevel?: string
  }
  readonly contextWindow?: number
  readonly maxTokens?: number
}

/** Startup-refresh configuration for the catalog service. */
export interface Config {
  /** Fetch a fresh catalog once at startup. Disable for fully offline hosts. */
  refresh?: boolean
  /** Catalog document URL. Defaults to the upstream repository's generated file. */
  refreshUrl?: string
  /** Whole-request deadline in milliseconds; expiry counts as a failed refresh. */
  refreshTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  refresh: z.boolean(),
  refreshUrl: z.string(),
  refreshTimeoutMs: z.number(),
})

/** The generated catalog document in the upstream repository. */
export const DEFAULT_REFRESH_URL = 'https://raw.githubusercontent.com/can1357/oh-my-pi/main/packages/catalog/src/models.json'

/** Default whole-request deadline for one refresh. */
export const DEFAULT_REFRESH_TIMEOUT_MS = 10_000

/**
 * Reply ceiling for one refresh. The generated database measures about 10 MB;
 * the headroom absorbs growth while capping what an unexpected reply may hold.
 */
const MAX_REFRESH_BYTES = 32 * 1024 * 1024

declare module '@deepseek-ai/cordis' {
  interface Context { modelCatalog: ModelCatalog }
}

/**
 * Read one reply body, refusing one that outgrows {@link MAX_REFRESH_BYTES}.
 * A declared length is checked first so an oversized reply is turned away
 * without transferring anything; the accumulated total is what actually
 * enforces the bound, because a server that under-declares (or streams) tells
 * us nothing up front.
 * @param response - the fetch reply to drain.
 * @returns the decoded body text.
 */
async function readBounded(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_REFRESH_BYTES) {
    await response.body?.cancel().catch(() => {
      // Cancel after an already-drained or abandoned read is best-effort
      // cleanup; the refusal below stands either way.
    })
    throw new Error(`catalog reply exceeds ${MAX_REFRESH_BYTES} bytes`)
  }
  /* v8 ignore next -- fetch always exposes a body stream on a 2xx Response; the null guard is defensive. */
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_REFRESH_BYTES) throw new Error(`catalog reply exceeds ${MAX_REFRESH_BYTES} bytes`)
    chunks.push(value)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

/** Test whether one value is a plain object (not null, not an array). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate one fetched catalog document before it replaces the bundled
 * snapshot. Every entry must at least carry its identity; capacity and
 * capability fields stay optional exactly as in the bundled snapshot. The
 * check refuses the whole document rather than skipping entries: a document
 * that cannot state every model's id is not the generated database, and a
 * partial merge would look like a catalog that lost models.
 * @param raw - the parsed JSON value.
 * @returns the validated provider-keyed source.
 */
function validateCatalog(raw: unknown): CatalogSource {
  if (!isPlainObject(raw)) throw new Error('catalog document is not an object')
  for (const [provider, entries] of Object.entries(raw)) {
    if (!isPlainObject(entries)) throw new Error(`provider "${provider}" is not an object`)
    for (const [key, entry] of Object.entries(entries)) {
      if (!isPlainObject(entry)) throw new Error(`model "${provider}/${key}" is not an object`)
      if (typeof entry.id !== 'string' || entry.id.length === 0) {
        throw new Error(`model "${provider}/${key}" has no id`)
      }
    }
  }
  return raw as CatalogSource
}

/**
 * Compare two references for the same id and rank the more complete one
 * first: image modalities, reasoning, explicit effort tiers, then capacities.
 * @param left - one candidate reference.
 * @param right - the reference currently stored under the id.
 * @returns positive when `left` outranks `right`.
 */
function compareReferences(left: ModelCapabilityReference, right: ModelCapabilityReference): number {
  const leftRank = [
    left.input.includes('image') ? 1 : 0,
    left.reasoning ? 1 : 0,
    left.thinking?.efforts.length ?? 0,
    left.contextWindow ?? 0,
    left.maxTokens ?? 0,
  ]
  const rightRank = [
    right.input.includes('image') ? 1 : 0,
    right.reasoning ? 1 : 0,
    right.thinking?.efforts.length ?? 0,
    right.contextWindow ?? 0,
    right.maxTokens ?? 0,
  ]
  for (let index = 0; index < leftRank.length; index += 1) {
    const left = leftRank[index]
    const right = rightRank[index]
    if (left !== right) return (left ?? 0) - (right ?? 0)
  }
  return right.id.localeCompare(left.id)
}

/**
 * One shared model-reference catalog for all LLM consumers, served from the
 * bundled snapshot of the generated database and replaced once at startup by
 * a freshly fetched copy when one can be read.
 */
export class ModelCatalog extends Service {
  static Config: z<Config> = Config

  /** Resolved startup-refresh settings. */
  private readonly refreshEnabled: boolean
  private readonly refreshUrl: string
  private readonly refreshTimeoutMs: number

  private references: ReadonlyMap<string, ModelCapabilityReference>
  private referencesByProvider: ReadonlyMap<string, ReadonlyMap<string, ModelCapabilityReference>>

  /**
   * @param ctx - the owning context.
   * @param config - optional startup-refresh configuration; absent fields take their defaults.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'modelCatalog')
    this.refreshEnabled = config.refresh ?? true
    this.refreshUrl = config.refreshUrl ?? DEFAULT_REFRESH_URL
    this.refreshTimeoutMs = config.refreshTimeoutMs ?? DEFAULT_REFRESH_TIMEOUT_MS
    const built = this.buildReferences(MODELS as unknown as CatalogSource)
    this.references = built.references
    this.referencesByProvider = built.byProvider
  }

  /** Resolve a configured model id to capability metadata without provider guesses.
   * @param modelId configured model identifier.
   * @returns capability metadata, or `undefined` when absent.
   */
  resolve(modelId: string): ModelCapabilityReference | undefined {
    const candidates = [modelId, modelId.slice(modelId.lastIndexOf('/') + 1)]
    for (const candidate of candidates) {
      const reference = this.references.get(candidate.toLowerCase())
      if (reference !== undefined) return reference
    }
    return undefined
  }

  /**
   * Resolve a model id to capability metadata, preferring the entry the named
   * catalog provider publishes. A model id served by several gateways carries
   * provider-specific wire facts — reasoning effort spellings above all — so a
   * consumer that knows which gateway it serves must read that gateway's own
   * record; the cross-provider best pick stays the fallback for ids the named
   * provider does not describe.
   * @param provider - catalog provider key, matched case-insensitively.
   * @param modelId configured model identifier.
   * @returns capability metadata, or `undefined` when absent.
   */
  resolveFor(provider: string, modelId: string): ModelCapabilityReference | undefined {
    const scoped = this.referencesByProvider.get(provider.toLowerCase())?.get(modelId.toLowerCase())
    return scoped ?? this.resolve(modelId)
  }

  protected async [Service.init](): Promise<void> {
    // One attempt per process start. Failure keeps the bundled snapshot and
    // never blocks activation: the catalog enriches capability metadata, so an
    // unreachable source degrades resolution quality rather than availability.
    if (!this.refreshEnabled) return
    try {
      const response = await fetch(this.refreshUrl, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.refreshTimeoutMs),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const source = validateCatalog(JSON.parse(await readBounded(response)))
      const built = this.buildReferences(source)
      this.references = built.references
      this.referencesByProvider = built.byProvider
      this.ctx.logger.info('refreshed the model catalog from %s: %d models', this.refreshUrl, this.references.size)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      this.ctx.logger.warn('model catalog refresh from %s failed (%s); serving the bundled snapshot', this.refreshUrl, message)
    }
  }

  /**
   * Project one validated catalog source into the lookup maps. The global map
   * keys each id once, and when several providers publish the same id the
   * entry with the most complete capability metadata wins deterministically.
   * The per-provider map keeps every provider's own record so a consumer
   * serving a known gateway can read its wire facts verbatim.
   * @param source - the validated provider-keyed catalog.
   * @returns the global lowercase-id map and the per-provider maps.
   */
  private buildReferences(source: CatalogSource): {
    references: Map<string, ModelCapabilityReference>
    byProvider: Map<string, Map<string, ModelCapabilityReference>>
  } {
    const references = new Map<string, ModelCapabilityReference>()
    const byProvider = new Map<string, Map<string, ModelCapabilityReference>>()
    for (const [provider, entries] of Object.entries(source)) {
      const scoped = new Map<string, ModelCapabilityReference>()
      byProvider.set(provider.toLowerCase(), scoped)
      for (const model of Object.values(entries)) {
        const reference = this.projectReference(model)
        scoped.set(model.id.toLowerCase(), reference)
        const key = model.id.toLowerCase()
        const current = references.get(key)
        if (current === undefined || compareReferences(reference, current) > 0) references.set(key, reference)
      }
    }
    return { references, byProvider }
  }

  /**
   * Project one raw catalog entry into the immutable reference shape.
   * @param model - the validated raw entry.
   * @returns the capability reference.
   */
  private projectReference(model: RawModel): ModelCapabilityReference {
    return {
      id: model.id,
      name: model.name ?? model.id,
      input: [...model.input ?? ['text']],
      reasoning: model.reasoning === true,
      ...model.thinking === undefined ? {} : {
        thinking: {
          mode: model.thinking.mode,
          efforts: [...model.thinking.efforts ?? []],
          ...model.thinking.defaultLevel === undefined ? {} : { defaultLevel: model.thinking.defaultLevel },
        },
      },
      ...model.contextWindow == null ? {} : { contextWindow: model.contextWindow },
      ...model.maxTokens == null ? {} : { maxTokens: model.maxTokens },
    }
  }
}

export default ModelCatalog

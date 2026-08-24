/** Freebuff free-mode LLM adapter with OAuth and server-side session admission. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import {
  attributionHeaders,
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  resolveRetryPolicy,
  RetryPolicySchema,
} from '@deepseek-ai/dsh-fork-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  ModelModality,
  ResolvedRetryPolicy,
  StreamChunk,
} from '@deepseek-ai/dsh-fork-llm'
import type { RetryPolicyConfig } from '@deepseek-ai/dsh-fork-llm'
import type { FreebuffOAuthService } from '@deepseek-ai/dsh-fork-credential-freebuff-oauth'
import {
  serializeRequest,
  serializeRequestWithImages,
} from '@deepseek-ai/dsh-fork-llm-deepseek/serialize'
import { parseSse } from '@deepseek-ai/dsh-fork-llm-deepseek/sse'
import { translate } from '@deepseek-ai/dsh-fork-llm-deepseek/translate'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

export const name = 'llm-freebuff'
export const inject = ['llm', 'freebuffOAuth']

const PROVIDER = 'freebuff'
const NS = settingsNamespace('llm-freebuff')
const DEFAULT_API_BASE_URL = 'https://codebuff.com'
const DEFAULT_CONTEXT_WINDOW = 131_072
const DEFAULT_MAX_TOKENS = 131_072
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 60_000
const DEFAULT_MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024
const AUTH_EXPIRED_MESSAGE = 'Freebuff login expired. Reconnect in Settings -> Plugins -> OAuth.'
const DEFAULT_MODELS: FreebuffCatalogModel[] = [
  { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextWindow: 1_048_576 },
  { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash 07/31', contextWindow: 1_048_576 },
  { id: 'openai/gpt-5.6-luna', name: 'GPT-5.6 Luna', contextWindow: 1_000_000, inputModalities: ['text', 'image'] },
  { id: 'mimo/mimo-v2.5', name: 'MiMo 2.5', inputModalities: ['text', 'image'] },
]

const MODEL_MODALITIES = ['text', 'image'] as const satisfies readonly ModelModality[]
const OFF = ReasoningEffortId('off')
const LOW = ReasoningEffortId('low')
const HIGH = ReasoningEffortId('high')
const MAX = ReasoningEffortId('max')
const REASONING = [
  { id: OFF, name: 'Off' },
  { id: LOW, name: 'Low' },
  { id: HIGH, name: 'High' },
  { id: MAX, name: 'Max' },
] as const

/** One model displayed by the Freebuff model selector. */
export interface FreebuffCatalogModel {
  /** Freebuff wire model id. */
  id: string
  /** Selector label. */
  name?: string
  /** Optional selector description. */
  description?: string
  /** Known combined context capacity. */
  contextWindow?: number
  /** Per-model output cap. */
  maxTokens?: number
  /** Input content accepted by the model. */
  inputModalities?: ModelModality[]
}

/** Freebuff LLM plugin configuration. */
export interface Config {
  /** Freebuff web/API origin. */
  baseURL?: string
  /** Catalog shown to model discovery consumers. */
  models?: FreebuffCatalogModel[]
  /** Default output-token cap. */
  maxTokens?: number
  /** Fallback context capacity. */
  defaultContextWindow?: number
  /** Provider stream idle timeout. */
  streamIdleTimeoutMs?: number
  /** Maximum transient image payload per request. */
  maxRequestImageBytes?: number
  /** Retry policy captured by the LLM registry. */
  retryPolicy?: RetryPolicyConfig
}

const catalogModel: z<FreebuffCatalogModel> = z.object({
  id: z.string().required(),
  name: z.string(),
  description: z.string(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  inputModalities: z.array(z.union(MODEL_MODALITIES)).min(1).default(['text']),
})

export const Config: z<Config> = z.object({
  baseURL: z.string().default(DEFAULT_API_BASE_URL),
  models: z.array(catalogModel).default(DEFAULT_MODELS),
  maxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS),
  defaultContextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  streamIdleTimeoutMs: z.number().step(1).min(1).default(DEFAULT_STREAM_IDLE_TIMEOUT_MS),
  maxRequestImageBytes: z.number().step(1).min(1).default(DEFAULT_MAX_REQUEST_IMAGE_BYTES),
  retryPolicy: RetryPolicySchema,
})

interface ResolvedConfig {
  readonly baseURL: string
  readonly models: readonly FreebuffCatalogModel[]
  readonly maxTokens: number
  readonly defaultContextWindow: number
  readonly streamIdleTimeoutMs: number
  readonly maxRequestImageBytes: number
  readonly retryPolicy?: ResolvedRetryPolicy
}

interface ActiveSession {
  readonly model: string
  readonly instanceId: string
}

interface SessionResponse {
  readonly status?: string
  readonly model?: string
  readonly instanceId?: string
  readonly error?: string
  readonly message?: string
  readonly statusCode?: number
}

const GATE_CODES = new Set([
  'waiting_room_required',
  'session_expired',
  'session_superseded',
  'session_model_mismatch',
  'session_limit_reached',
  'waiting_room_queued',
  'model_unavailable',
])
const ENDS_SESSION = new Set([
  'waiting_room_required',
  'session_expired',
  'session_superseded',
  'session_model_mismatch',
])

/** Adapter options kept separate from Cordis configuration for focused tests. */
export interface FreebuffAdapterOptions {
  /** Current validated connection facts. */
  readonly options: () => ResolvedConfig
  /** Resolve the OAuth access token for the next request. */
  readonly resolveToken: () => Promise<string>
  /** Resolve durable attachments for image-capable models. */
  readonly resolveAttachments?: () => AttachmentStore | undefined
  /** Injectable transport used by tests. */
  readonly fetch?: typeof fetch
  /** Clear the persisted OAuth credential after a provider-side 401. */
  readonly onUnauthorized?: () => Promise<void>
  /** Optional logger for best-effort cleanup diagnostics. */
  readonly warn?: (error: unknown) => void
}

/** Freebuff OpenAI-compatible adapter. */
export class FreebuffAdapter extends LlmAdapter {
  private readonly fetchImpl: typeof fetch
  private session: ActiveSession | undefined
  private admission: { readonly model: string; readonly promise: Promise<ActiveSession> } | undefined

  constructor(private readonly config: FreebuffAdapterOptions) {
    super()
    this.fetchImpl = config.fetch ?? globalThis.fetch
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Freebuff' }
  }

  override providerRetryPolicy(_provider: string): ResolvedRetryPolicy | undefined {
    return this.config.options().retryPolicy
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.config.options().models.map(model => modelInfo(provider, model)))
  }

  override resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const connection = this.config.options()
    const configured = connection.models.find(entry => entry.id === model)
    return Promise.resolve({
      ...(configured === undefined
        ? { provider, id: model, name: model, inputModalities: ['text' as const] }
        : modelInfo(provider, configured)),
      context: { contextWindow: configured?.contextWindow ?? connection.defaultContextWindow },
      defaultMaxTokens: configured?.maxTokens ?? connection.maxTokens,
      reasoning: { efforts: REASONING, defaultEffort: HIGH },
    })
  }

  /** Release the current server-side Freebuff slot. */
  async release(): Promise<void> {
    const current = this.session
    this.session = undefined
    if (current === undefined) return
    try {
      const token = await this.config.resolveToken()
      const response = await this.fetchImpl(`${this.config.options().baseURL}/api/v1/freebuff/session`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (response.status === 401) await this.invalidateUnauthorized()
    } catch (error: unknown) {
      this.config.warn?.(error)
    }
  }

  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.streamWithRecovery(options)
  }

  private async *streamWithRecovery(options: GenerateOptions): AsyncGenerator<StreamChunk> {
    let retriedAdmission = false
    while (true) {
      const token = await this.config.resolveToken()
      const session = await this.ensureSession(options.model, token, options.signal)
      try {
        yield* this.request(options, token, session)
        return
      } catch (error: unknown) {
        if (retriedAdmission || !(error instanceof FreebuffGateError) || !error.endsSession) throw error
        retriedAdmission = true
        this.session = undefined
      }
    }
  }

  private async *request(options: GenerateOptions, token: string, session: ActiveSession,): AsyncGenerator<StreamChunk> {
    const connection = this.config.options()
    const hasImages = options.messages.some(message => message.content.some(block => block.type === 'image'))
    const body = {
      ...hasImages
        ? await this.imageRequest(options, connection)
        : serializeRequest(options),
      codebuff_metadata: {
        cost_mode: 'free',
        freebuff_instance_id: session.instanceId,
      },
    }
    const signal = options.signal === undefined
      ? AbortSignal.timeout(connection.streamIdleTimeoutMs)
      : AbortSignal.any([options.signal, AbortSignal.timeout(connection.streamIdleTimeoutMs)])
    const response = await this.fetchImpl(`${connection.baseURL}/api/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'text/event-stream',
        'x-freebuff-model': options.model,
        'x-freebuff-instance-id': session.instanceId,
        ...options.purpose === 'compaction' ? { 'x-freebuff-compact-session': '1' } : {},
        ...attributionHeaders(),
      },
      body: JSON.stringify(body),
      signal,
    })
    if (!response.ok) throw await this.responseError(response)
    if (response.body === null) throw new LlmError('Freebuff returned no response body', 'EMPTY_RESPONSE')
    yield* translate(parseSse(response.body))
  }

  private async imageRequest(options: GenerateOptions, connection: ResolvedConfig): Promise<ReturnType<typeof serializeRequest>> {
    const model = connection.models.find(entry => entry.id === options.model)
    if (model?.inputModalities?.includes('image') !== true) {
      throw new LlmError(`Freebuff model "${options.model}" does not accept image input.`, 'UNSUPPORTED_CONTENT')
    }
    const attachments = this.config.resolveAttachments?.()
    if (attachments === undefined) {
      throw new LlmError('Freebuff image conversion requires the durable attachment service.', 'UNSUPPORTED_CONTENT')
    }
    return serializeRequestWithImages(options, {
      attachments,
      maxRequestImageBytes: connection.maxRequestImageBytes,
      signal: options.signal ?? AbortSignal.timeout(connection.streamIdleTimeoutMs),
    })
  }

  private async ensureSession(model: string, token: string, signal?: AbortSignal): Promise<ActiveSession> {
    const current = this.session
    if (current?.model === model) {
      try {
        const state = await this.sessionRequest('GET', token, current.instanceId, undefined, signal)
        if (state.status === 'active' && state.instanceId === current.instanceId && state.model === model) return current
      } catch (error: unknown) {
        if (error instanceof FreebuffGateError && !error.endsSession) throw error
      }
      this.session = undefined
    }
    const pendingAdmission = this.admission
    if (pendingAdmission !== undefined) {
      if (pendingAdmission.model === model) return pendingAdmission.promise
      await pendingAdmission.promise.catch(() => undefined)
      return this.ensureSession(model, token, signal)
    }
    const pending = this.admit(model, token, signal)
    let tracked: Promise<ActiveSession>
    tracked = pending.finally(() => {
      if (this.admission?.promise === tracked) this.admission = undefined
    })
    const ownedAdmission = { model, promise: tracked }
    this.admission = ownedAdmission
    try {
      const admitted = await tracked
      this.session = admitted
      return admitted
    } finally {
      if (this.admission === ownedAdmission) this.admission = undefined
    }
  }

  private async admit(model: string, token: string, signal?: AbortSignal): Promise<ActiveSession> {
    const state = await this.sessionRequest('POST', token, undefined, model, signal)
    if (state.status !== 'active' || typeof state.instanceId !== 'string') {
      throw sessionStatusError(state)
    }
    return { model, instanceId: state.instanceId }
  }

  private async sessionRequest(
    method: 'GET' | 'POST' | 'DELETE',
    token: string,
    instanceId?: string,
    model?: string,
    signal?: AbortSignal,
  ): Promise<SessionResponse> {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` }
    if (instanceId !== undefined) headers['x-freebuff-instance-id'] = instanceId
    if (model !== undefined) headers['x-freebuff-model'] = model
    const response = await this.fetchImpl(`${this.config.options().baseURL}/api/v1/freebuff/session`, {
      method,
      headers,
      signal: signal === undefined ? AbortSignal.timeout(20_000) : signal,
    })
    if (response.status === 404) return { status: 'none' }
    if (response.status === 401) throw await this.unauthorizedError()
    const body = await readObject(response)
    if (!response.ok) {
      if (isAdmissionStatus(method, response.status, body)) return body
      const error = typeof body.error === 'string' ? body.error : undefined
      throw new FreebuffGateError(error ?? `session_http_${response.status}`, response.status, false)
    }
    return body
  }

  private async responseError(response: Response): Promise<Error> {
    const body = await readObject(response)
    if (response.status === 401) return this.unauthorizedError()
    const error = typeof body.error === 'string' ? body.error : undefined
    const statusCode = typeof body.statusCode === 'number' ? body.statusCode : response.status
    if (error !== undefined && GATE_CODES.has(error) && statusCode === response.status) {
      return new FreebuffGateError(error, statusCode, ENDS_SESSION.has(error))
    }
    const message = typeof body.message === 'string'
      ? body.message
      : `Freebuff API error (HTTP ${response.status})`
    const code = response.status === 401 || response.status === 403
      ? 'AUTH'
      : response.status === 429
        ? 'RATE_LIMIT'
        : response.status >= 500 ? 'SERVER' : 'INVALID_REQUEST'
    return new LlmError(message, code, { status: response.status })
  }

  private async unauthorizedError(): Promise<LlmError> {
    await this.invalidateUnauthorized()
    return new LlmError(AUTH_EXPIRED_MESSAGE, 'AUTH', { status: 401 })
  }

  private async invalidateUnauthorized(): Promise<void> {
    try {
      await this.config.onUnauthorized?.()
    } catch (error: unknown) {
      this.config.warn?.(error)
    }
  }
}

function isAdmissionStatus(
  method: 'GET' | 'POST' | 'DELETE',
  statusCode: number,
  response: SessionResponse,
): boolean {
  if (method !== 'POST' && !(statusCode === 403 && (response.status === 'country_blocked' || response.status === 'banned'))) {
    return false
  }
  if (statusCode === 409) return response.status === 'model_locked' || response.status === 'model_unavailable'
  if (statusCode === 429) return response.status === 'rate_limited' || response.status === 'spend_limited' || response.status === 'ip_capped'
  return statusCode === 403 && (response.status === 'country_blocked' || response.status === 'banned')
}

class FreebuffGateError extends Error {
  readonly code = 'FREEBUFF_SESSION_GATE'
  constructor(readonly gate: string, readonly statusCode: number, readonly endsSession: boolean) {
    super(`Freebuff session gate: ${gate}`)
    this.name = 'FreebuffGateError'
  }
}

function sessionStatusError(response: SessionResponse): Error {
  const status = response.status ?? 'unknown'
  const code = status === 'rate_limited' || status === 'spend_limited' || status === 'ip_capped'
    ? 'RATE_LIMIT'
    : status === 'model_unavailable' || status === 'model_locked'
      ? 'MODEL_UNAVAILABLE'
      : status === 'country_blocked' || status === 'banned' ? 'AUTH' : 'FREEBUFF_SESSION'
  return new LlmError(response.message ?? `Freebuff session admission returned ${status}`, code)
}

async function readObject(response: Response): Promise<SessionResponse> {
  const value: unknown = await response.json().catch(() => ({}))
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as SessionResponse
}

function modelInfo(provider: string, model: FreebuffCatalogModel): LlmModelInfo {
  return {
    provider,
    id: model.id,
    name: model.name ?? model.id,
    ...model.description === undefined ? {} : { description: model.description },
    inputModalities: model.inputModalities ?? ['text'],
  }
}

function resolveConfig(config: Config): ResolvedConfig {
  const models = config.models ?? DEFAULT_MODELS
  const seen = new Set<string>()
  for (const model of models) {
    if (model.id.length === 0 || seen.has(model.id)) throw new Error(`llm-freebuff: invalid or duplicate model '${model.id}'`)
    seen.add(model.id)
    const modalities = model.inputModalities ?? ['text']
    if (modalities.length === 0 || modalities.some(value => !MODEL_MODALITIES.includes(value))) {
      throw new Error(`llm-freebuff: invalid input modalities for '${model.id}'`)
    }
  }
  return {
    baseURL: normalizeBaseURL(config.baseURL ?? DEFAULT_API_BASE_URL),
    models: models.map(model => ({ ...model, inputModalities: [...model.inputModalities ?? ['text']] })),
    maxTokens: positive(config.maxTokens ?? DEFAULT_MAX_TOKENS, 'maxTokens'),
    defaultContextWindow: positive(config.defaultContextWindow ?? DEFAULT_CONTEXT_WINDOW, 'defaultContextWindow'),
    streamIdleTimeoutMs: positive(config.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS, 'streamIdleTimeoutMs'),
    maxRequestImageBytes: positive(config.maxRequestImageBytes ?? DEFAULT_MAX_REQUEST_IMAGE_BYTES, 'maxRequestImageBytes'),
    retryPolicy: resolveRetryPolicy(config.retryPolicy, 'llm-freebuff: retryPolicy'),
  }
}

function normalizeBaseURL(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('llm-freebuff: baseURL must use HTTPS outside localhost')
  }
  return value.replace(/\/$/u, '')
}

function positive(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`llm-freebuff: ${field} must be a positive safe integer`)
  return value
}

/** Compose the Freebuff provider route beside the official routes. */
export function apply(ctx: Context, config: Config): void {
  const freebuff = ctx.get('freebuffOAuth') as FreebuffOAuthService | undefined
  if (freebuff === undefined) throw new Error('llm-freebuff requires credential-freebuff-oauth')
  let current = resolveConfig(config)
  const adapter = new FreebuffAdapter({
    options: () => current,
    resolveToken: () => freebuff.accessToken(),
    onUnauthorized: () => freebuff.invalidate(),
    resolveAttachments: () => ctx.get('attachments'),
    warn: error => { ctx.logger.warn('llm-freebuff: session release failed'); ctx.logger.warn(error) },
  })
  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: 'Freebuff', settingsNs: NS, settingsPath: [] },
  ])
  const registration = ctx.llm.registerAdapter([PROVIDER], adapter)
  ctx.effect(() => async () => { await adapter.release() }, 'freebuff session teardown')
  installSettingsSection(ctx, NS, Config, config, {
    setSource: source => { current = resolveConfig(source()) },
    onChange: () => { registration.replace([PROVIDER]) },
  })
}

/** Direct Bearer chat adapter for configurable provider routes. */

import { attributionHeaders, LlmAdapter, LlmError } from '@deepseek-ai/dsh-fork-llm'
import type {
  GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, ReplayEnvelope, StreamChunk,
} from '@deepseek-ai/dsh-fork-llm'
import type { ResolvedBearerProviderProfile } from './config.ts'
import { parseSse } from './sse.ts'

/** Operation-local dependencies owned by the plugin. */
export interface BearerAdapterOptions {
  /** Current resolved profile map. */
  profiles: () => ReadonlyMap<string, ResolvedBearerProviderProfile>
  /** Resolve or rotate this route's Bearer token. */
  resolveToken: (profile: ResolvedBearerProviderProfile) => Promise<string>
}

interface BearerStreamEvent {
  type?: unknown
  content?: unknown
  session_id?: unknown
  message?: unknown
  error?: unknown
}

interface BearerReplayResponse {
  kind: 'bearer-chat'
  version: 1
  provider: string
  model: string
  sessionId: string
}

function replaySessionId(options: GenerateOptions): string | undefined {
  for (let index = options.messages.length - 1; index >= 0; index -= 1) {
    const message = options.messages[index]
    if (message?.role !== 'assistant' || message.source.kind !== 'model') continue
    if (message.source.provider !== options.provider || message.source.model !== options.model) continue
    const raw = message.source.replayState
    if (typeof raw !== 'object' || raw === null) continue
    const response = (raw as { response?: unknown }).response
    if (typeof response !== 'object' || response === null) continue
    const state = response as Partial<BearerReplayResponse>
    if (state.kind === 'bearer-chat' && state.version === 1
      && state.provider === options.provider && state.model === options.model
      && typeof state.sessionId === 'string' && state.sessionId.length > 0) return state.sessionId
  }
  return undefined
}

function latestUserQuery(options: GenerateOptions): string {
  const message = options.messages.findLast(candidate => candidate.role === 'user')
  if (message === undefined) throw new LlmError('Bearer chat requires a user message', 'INVALID_REQUEST')
  const query = message.content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('\n')
  if (query.length === 0) throw new LlmError('Bearer chat requires text in the latest user message', 'UNSUPPORTED_CONTENT')
  return query
}

function failureMessage(event: BearerStreamEvent): string {
  if (typeof event.message === 'string' && event.message.length > 0) return event.message
  if (typeof event.error === 'string' && event.error.length > 0) return event.error
  return 'Bearer chat reported an error'
}

function replayState(options: GenerateOptions, sessionId: string): ReplayEnvelope {
  return {
    response: {
      kind: 'bearer-chat',
      version: 1,
      provider: options.provider,
      model: options.model,
      sessionId,
    } satisfies BearerReplayResponse,
  }
}

/** One adapter instance serving every configured Bearer route. */
export class BearerAdapter extends LlmAdapter {
  constructor(private readonly options: BearerAdapterOptions) {
    super()
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: this.profile(provider).displayName }
  }

  override providerRetryPolicy(provider: string): ResolvedBearerProviderProfile['retryPolicy'] {
    return this.profile(provider).retryPolicy
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.profile(provider).models.map(model => ({
      provider,
      id: model.id,
      name: model.name ?? model.id,
      inputModalities: ['text'],
    })))
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const profile = this.profile(provider)
    const entry = profile.models.find(candidate => candidate.id === model)
    if (entry === undefined) {
      throw new LlmError(`llm-bearer: unknown model "${model}" for provider route "${provider}"`, 'UNKNOWN_MODEL')
    }
    return Promise.resolve({
      provider,
      id: entry.id,
      name: entry.name ?? entry.id,
      inputModalities: ['text'],
      context: { contextWindow: entry.contextWindow },
      defaultMaxTokens: entry.maxTokens,
    })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const profile = this.profile(options.provider)
    if (!profile.models.some(model => model.id === options.model)) {
      throw new LlmError(`llm-bearer: unknown model "${options.model}" for provider route "${options.provider}"`, 'UNKNOWN_MODEL')
    }
    const token = await this.options.resolveToken(profile)
    const previousSessionId = replaySessionId(options)
    const request = {
      type: 'app',
      version: 1,
      response_version: 1,
      query: latestUserQuery(options),
      model: options.model === 'auto' ? 'auto' : { model_name: options.model },
      context: null,
      client: {
        platform: 'web',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        client_time: new Date().toISOString(),
        locale: 'en',
      },
      mode: 'default',
      ...previousSessionId === undefined ? {} : { session_id: previousSessionId },
    }
    const timeout = AbortSignal.timeout(profile.timeoutMs)
    const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout])
    let response: Response
    try {
      response = await fetch(profile.chatURL, {
        method: 'POST',
        headers: {
          ...attributionHeaders(),
          authorization: `Bearer ${token}`,
          accept: 'text/event-stream',
          'content-type': 'application/json',
        },
        body: JSON.stringify(request),
        signal,
      })
    } catch (error: unknown) {
      if (options.signal?.aborted) throw new LlmError('Bearer request aborted by caller', 'ABORTED', { cause: error })
      if (timeout.aborted) throw new LlmError(`Bearer request timed out after ${profile.timeoutMs}ms`, 'TIMEOUT', { cause: error })
      throw new LlmError(`Bearer request to ${profile.chatURL} failed`, 'TRANSPORT', { cause: error })
    }
    if (!response.ok) {
      throw new LlmError(
        `Bearer chat answered HTTP ${response.status}`,
        response.status === 401 || response.status === 403
          ? 'AUTH'
          : response.status === 429 ? 'RATE_LIMIT' : response.status >= 500 ? 'SERVER' : 'INVALID_REQUEST',
        { status: response.status },
      )
    }
    if (response.body === null) throw new LlmError('Bearer chat response has no body', 'EMPTY_RESPONSE')

    let sessionId: string | undefined
    let nextIndex = 0
    let hasContent = false
    let text: { index: number; value: string } | undefined
    let reasoning: { index: number; value: string } | undefined
    const closeText = function* (): Generator<StreamChunk> {
      if (text === undefined) return
      yield { type: 'block-end', index: text.index, block: { type: 'text', text: text.value } }
      text = undefined
    }
    const closeReasoning = function* (): Generator<StreamChunk> {
      if (reasoning === undefined) return
      yield { type: 'block-end', index: reasoning.index, block: { type: 'reasoning', text: reasoning.value } }
      reasoning = undefined
    }
    try {
      for await (const data of parseSse(response.body)) {
        if (data === '[DONE]') break
        let event: BearerStreamEvent
        try {
          event = JSON.parse(data) as BearerStreamEvent
        } catch (error: unknown) {
          throw new LlmError('Bearer chat sent malformed SSE JSON', 'TRANSPORT', { cause: error })
        }
        if (typeof event.session_id === 'string' && event.session_id.length > 0) sessionId = event.session_id
        if (event.type === 'text_start' && text === undefined) {
          text = { index: nextIndex++, value: '' }
          yield { type: 'block-start', index: text.index, blockType: 'text' }
          if (typeof event.content === 'string' && event.content.length > 0) {
            text.value += event.content
            hasContent = true
            yield { type: 'text-delta', index: text.index, text: event.content }
          }
        } else if (event.type === 'text_delta' && typeof event.content === 'string') {
          if (text === undefined) {
            text = { index: nextIndex++, value: '' }
            yield { type: 'block-start', index: text.index, blockType: 'text' }
          }
          text.value += event.content
          if (event.content.length > 0) hasContent = true
          yield { type: 'text-delta', index: text.index, text: event.content }
        } else if (event.type === 'thinking_start' && reasoning === undefined) {
          reasoning = { index: nextIndex++, value: '' }
          yield { type: 'block-start', index: reasoning.index, blockType: 'reasoning' }
          if (typeof event.content === 'string' && event.content.length > 0) {
            reasoning.value += event.content
            hasContent = true
            yield { type: 'reasoning-delta', index: reasoning.index, text: event.content }
          }
        } else if (event.type === 'thinking_delta' && typeof event.content === 'string') {
          if (reasoning === undefined) {
            reasoning = { index: nextIndex++, value: '' }
            yield { type: 'block-start', index: reasoning.index, blockType: 'reasoning' }
          }
          reasoning.value += event.content
          if (event.content.length > 0) hasContent = true
          yield { type: 'reasoning-delta', index: reasoning.index, text: event.content }
        } else if (event.type === 'error') {
          throw new LlmError(failureMessage(event), 'SERVER')
        } else if (event.type === 'done') {
          break
        }
      }
    } catch (error: unknown) {
      yield* closeReasoning()
      yield* closeText()
      throw error
    }
    yield* closeReasoning()
    yield* closeText()
    if (!hasContent) {
      throw new LlmError('Bearer chat completed without text or reasoning', 'EMPTY_RESPONSE')
    }
    yield {
      type: 'finish',
      reason: { kind: 'stop' },
      ...sessionId === undefined ? {} : { replayState: replayState(options, sessionId) },
    }
  }

  private profile(provider: string): ResolvedBearerProviderProfile {
    const profile = this.options.profiles().get(provider)
    if (profile === undefined) throw new LlmError(`llm-bearer: unknown provider route "${provider}"`, 'UNKNOWN_PROVIDER')
    return profile
  }
}

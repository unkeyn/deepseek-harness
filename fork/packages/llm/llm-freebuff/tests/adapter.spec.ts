import { describe, expect, it, vi } from 'vitest'
import { createUserMessage, BlockAssembler } from '@deepseek-ai/dsh-fork-llm'
import { Config, FreebuffAdapter } from '../src/index.ts'

const config = {
  baseURL: 'https://freebuff.test',
  models: [
    { id: 'deepseek/deepseek-v4-pro', contextWindow: 1_048_576 },
    { id: 'minimax/minimax-m3', inputModalities: ['text', 'image'] as const },
  ],
  maxTokens: 131_072,
  defaultContextWindow: 131_072,
  streamIdleTimeoutMs: 10_000,
  maxRequestImageBytes: 1024,
  retryPolicy: undefined,
}

const toolStart = {
  choices: [{
    delta: {
      tool_calls: [{
        index: 0,
        id: 'call-1',
        function: { name: 'lookup', arguments: '{"q":"x"' },
      }],
    },
  }],
}

const toolFinish = {
  choices: [{
    delta: {
      tool_calls: [{
        index: 0,
        function: { arguments: '}' },
      }],
    },
    finish_reason: 'tool_calls',
  }],
  usage: {
    prompt_tokens: 7,
    completion_tokens: 4,
    completion_tokens_details: { reasoning_tokens: 2 },
  },
}

const completion = [
  JSON.stringify({ choices: [{ delta: { role: 'assistant', reasoning_content: 'think' } }] }),
  JSON.stringify(toolStart),
  JSON.stringify(toolFinish),
  '[DONE]',
].map(value => `data: ${value}\n\n`).join('')

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function streamResponse(): Response {
  return new Response(completion, { headers: { 'content-type': 'text/event-stream' } })
}

function message() {
  return createUserMessage({
    content: [{ type: 'text', text: 'hello' }],
    source: { kind: 'plugin', plugin: 'test' },
  })
}

describe('FreebuffAdapter', () => {
  it('uses the Codebuff API origin separately from the Freebuff login origin', () => {
    expect(Config.dict.baseURL.meta.default).toBe('https://codebuff.com')
  })

  it('admits a session and sends free metadata and the complete harness stream', async () => {
    const calls: Array<{ url: string; method: string; headers: Headers; body?: Record<string, unknown> }> = []
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined
      calls.push({ url: String(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body })
      if (calls.length === 1) return jsonResponse({ status: 'active', model: 'deepseek/deepseek-v4-pro', instanceId: 'instance-1' })
      return streamResponse()
    })
    const adapter = new FreebuffAdapter({
      options: () => config,
      resolveToken: async () => 'oauth-token',
      fetch,
    })
    const assembler = new BlockAssembler()
    for await (const chunk of adapter.stream({ provider: 'freebuff', model: 'deepseek/deepseek-v4-pro', messages: [message()] })) {
      assembler.push(chunk)
    }

    expect(assembler.finish).toEqual({ kind: 'tool-calls' })
    expect(assembler.usage).toEqual({ inputTokens: 7, outputTokens: 4, reasoningTokens: 2 })
    expect(assembler.message({ kind: 'model', provider: 'freebuff', model: 'deepseek/deepseek-v4-pro' }).content).toEqual([
      { type: 'reasoning', text: 'think' },
      { type: 'tool-call', id: 'call-1', name: 'lookup', arguments: '{"q":"x"}' },
    ])
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.headers.get('x-freebuff-model')).toBe('deepseek/deepseek-v4-pro')
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer oauth-token')
    expect(calls[1]?.url).toBe('https://freebuff.test/api/v1/chat/completions')
    expect(calls[1]?.headers.get('x-freebuff-instance-id')).toBe('instance-1')
    expect(calls[1]?.body?.codebuff_metadata).toEqual({
      cost_mode: 'free',
      freebuff_instance_id: 'instance-1',
    })
  })

  it('invalidates OAuth when session admission rejects the bearer token', async () => {
    const onUnauthorized = vi.fn(async () => {})
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse({ error: 'unauthorized' }, 401))
    const adapter = new FreebuffAdapter({ options: () => config, resolveToken: async () => 'oauth-token', onUnauthorized, fetch })

    await expect(async () => {
      for await (const _chunk of adapter.stream({ provider: 'freebuff', model: 'deepseek/deepseek-v4-pro', messages: [message()] })) { /* drain */ }
    }).rejects.toMatchObject({ code: 'AUTH', message: 'Freebuff login expired. Reconnect in Settings -> Plugins -> OAuth.' })
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })

  it('invalidates OAuth when chat rejects the bearer token', async () => {
    const onUnauthorized = vi.fn(async () => {})
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => String(input).endsWith('/freebuff/session') && init?.method === 'POST'
      ? jsonResponse({ status: 'active', model: 'deepseek/deepseek-v4-pro', instanceId: 'instance-1' })
      : jsonResponse({ error: 'unauthorized' }, 401))
    const adapter = new FreebuffAdapter({ options: () => config, resolveToken: async () => 'oauth-token', onUnauthorized, fetch })

    await expect(async () => {
      for await (const _chunk of adapter.stream({ provider: 'freebuff', model: 'deepseek/deepseek-v4-pro', messages: [message()] })) { /* drain */ }
    }).rejects.toMatchObject({ code: 'AUTH', message: 'Freebuff login expired. Reconnect in Settings -> Plugins -> OAuth.' })
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })

  it('re-admits once when the chat gate reports an expired session', async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = []
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? 'GET', body: init?.body })
      if (calls.length === 1) return jsonResponse({ status: 'active', model: 'deepseek/deepseek-v4-pro', instanceId: 'instance-old' })
      if (calls.length === 2) return jsonResponse({ error: 'session_expired', statusCode: 410, message: 'expired' }, 410)
      return calls.length === 3
        ? jsonResponse({ status: 'active', model: 'deepseek/deepseek-v4-pro', instanceId: 'instance-new' })
        : streamResponse()
    })
    const adapter = new FreebuffAdapter({ options: () => config, resolveToken: async () => 'oauth-token', fetch })
    const chunks: StreamChunkLike[] = []
    for await (const chunk of adapter.stream({ provider: 'freebuff', model: 'deepseek/deepseek-v4-pro', messages: [message()] })) chunks.push(chunk)

    expect(chunks.some(chunk => chunk.type === 'finish')).toBe(true)
    expect(calls.filter(call => call.method === 'POST')).toHaveLength(4)
    expect(String(calls[3]?.body)).toContain('instance-new')
  })

  it('releases the admitted session best effort', async () => {
    const methods: string[] = []
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      methods.push(init?.method ?? 'GET')
      return methods.length === 1
        ? jsonResponse({ status: 'active', model: 'deepseek/deepseek-v4-pro', instanceId: 'instance-1' })
        : streamResponse()
    })
    const adapter = new FreebuffAdapter({ options: () => config, resolveToken: async () => 'oauth-token', fetch })
    for await (const _chunk of adapter.stream({ provider: 'freebuff', model: 'deepseek/deepseek-v4-pro', messages: [message()] })) { /* drain */ }
    await adapter.release()
    expect(methods).toEqual(['POST', 'POST', 'DELETE'])
  })

  it('does not share a pending admission with a different model', async () => {
    let resolveFirstAdmission!: (response: Response) => void
    const firstAdmission = new Promise<Response>(resolve => { resolveFirstAdmission = resolve })
    const calls: Array<{ url: string; method: string; headers: Headers }> = []
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const headers = new Headers(init?.headers)
      calls.push({ url, method, headers })
      if (url.endsWith('/api/v1/freebuff/session') && method === 'POST' && calls.filter(call => call.url.endsWith('/api/v1/freebuff/session')).length === 1) {
        return firstAdmission
      }
      if (url.endsWith('/api/v1/freebuff/session') && method === 'POST') {
        return jsonResponse({ status: 'active', model: 'mimo/mimo-v2.5', instanceId: 'instance-b' })
      }
      return streamResponse()
    })
    const adapter = new FreebuffAdapter({ options: () => config, resolveToken: async () => 'oauth-token', fetch })
    const drain = async (model: string): Promise<void> => {
      for await (const _chunk of adapter.stream({ provider: 'freebuff', model, messages: [message()] })) { /* drain */ }
    }
    const first = drain('deepseek/deepseek-v4-pro')
    await Promise.resolve()
    const second = drain('mimo/mimo-v2.5')
    await Promise.resolve()
    expect(calls.filter(call => call.url.endsWith('/api/v1/freebuff/session'))).toHaveLength(1)

    resolveFirstAdmission(jsonResponse({ status: 'active', model: 'deepseek/deepseek-v4-pro', instanceId: 'instance-a' }))
    await Promise.all([first, second])

    const chatCalls = calls.filter(call => call.url.endsWith('/api/v1/chat/completions'))
    expect(chatCalls.map(call => call.headers.get('x-freebuff-model'))).toEqual([
      'deepseek/deepseek-v4-pro',
      'mimo/mimo-v2.5',
    ])
  })

  it('maps admission model locks to a model-unavailable failure', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => jsonResponse({
      status: 'model_locked',
      requestedModel: 'mimo/mimo-v2.5',
      currentModel: 'deepseek/deepseek-v4-pro',
    }, 409))
    const adapter = new FreebuffAdapter({ options: () => config, resolveToken: async () => 'oauth-token', fetch })
    await expect(async () => {
      for await (const _chunk of adapter.stream({ provider: 'freebuff', model: 'mimo/mimo-v2.5', messages: [message()] })) { /* drain */ }
    }).rejects.toMatchObject({ code: 'MODEL_UNAVAILABLE' })
  })
})

type StreamChunkLike = { type: string }

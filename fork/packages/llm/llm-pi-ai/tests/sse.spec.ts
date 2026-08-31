import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-fork-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-fork-llm-pi-ai'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'
import { assemble } from './assemble.ts'

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeMockServers()
})

beforeEach(() => {
  vi.stubEnv('SSE_TEST_KEY', 'test-key')
})

describe('OpenAI-compatible SSE framing', () => {
  it('accepts gateways that omit the blank line between data events', async () => {
    const server = await mockServer([{ events: textEvents, separator: '\n' }])
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(LlmPiAi, {
      providers: {
        gateway: {
          apiKeyEnv: 'SSE_TEST_KEY',
          api: 'openai-completions',
          baseURL: server.url,
          models: [{ id: 'gateway-model', contextWindow: 4096, maxTokens: 256 }],
        },
      },
    })

    const result = await assemble(ctx, {
      provider: 'gateway',
      model: 'gateway-model',
      messages: [createUserMessage({
        content: [{ type: 'text', text: 'hello' }],
        source: { kind: 'plugin', plugin: 'sse-test' },
      })],
    })

    expect(result.message.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(result.finish).toEqual({ kind: 'stop' })
  })
})

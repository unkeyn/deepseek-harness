import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-fork-llm'
import type { GenerateOptions, ToolSchema } from '@deepseek-ai/dsh-fork-llm'
import { buildTwinMindChatRequest, twinMindCapabilities } from '../src/adapter.ts'

function request(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return {
    provider: 'twinmind',
    model: 'auto',
    messages: [createUserMessage({
      content: [{ type: 'text', text: 'create a document' }],
      source: { kind: 'plugin', plugin: 'test' },
    })],
    ...overrides,
  }
}

const webSearch: ToolSchema = {
  name: 'web_search',
  description: 'Search the web.',
  parameters: { type: 'object', properties: {} },
}

const notesSearch: ToolSchema = {
  name: 'summary_search',
  description: 'Search saved notes.',
  parameters: { type: 'object', properties: {} },
}

describe('TwinMind Bearer request compatibility', () => {
  it('maps native harness tools to TwinMind capability switches', () => {
    expect(twinMindCapabilities(request({ tools: [webSearch, notesSearch] }))).toEqual({
      allow_web_search: true,
      allow_notes_access: true,
    })
  })

  it('does not advertise local tools TwinMind cannot execute', () => {
    expect(twinMindCapabilities(request({ tools: [{
      name: 'write',
      description: 'Write a local file.',
      parameters: { type: 'object', properties: {} },
    }] }))).toBeUndefined()
  })

  it('builds the native envelope and keeps the exact latest query', () => {
    expect(buildTwinMindChatRequest(request({ tools: [webSearch] }), 'Europe/Bucharest', '2026-08-29T00:00:00.000Z')).toEqual({
      type: 'app',
      version: 1,
      response_version: 1,
      query: 'create a document',
      model: 'auto',
      context: null,
      client: {
        platform: 'web',
        timezone: 'Europe/Bucharest',
        client_time: '2026-08-29T00:00:00.000Z',
        locale: 'en',
      },
      mode: 'default',
      capabilities: { allow_web_search: true },
    })
  })
})

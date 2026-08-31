import { describe, expect, it } from 'vitest'
import { resolveProfiles } from '../src/config.ts'

describe('Bearer provider configuration', () => {
  it('uses configured endpoints exactly and never derives provider-specific paths', () => {
    const resolved = resolveProfiles({
      example: {
        auth: {
          type: 'bearer',
          accessTokenEnv: 'EXAMPLE_BEARER_TOKEN',
          refresh: {
            type: 'firebase',
            endpoint: 'https://auth.example/token/',
            refreshTokenEnv: 'EXAMPLE_REFRESH_TOKEN',
            apiKey: 'public-key',
          },
        },
        api: 'bearer-chat',
        chatURL: 'https://chat.example/v3/stream/',
        modelsURL: 'https://chat.example/v3/models/',
        models: [{ id: 'auto' }],
      },
    }).get('example')

    expect(resolved).toMatchObject({
      chatURL: 'https://chat.example/v3/stream/',
      modelsURL: 'https://chat.example/v3/models/',
      auth: { refresh: { endpoint: 'https://auth.example/token/' } },
    })
  })

  it('rejects missing and non-HTTP refresh endpoints', () => {
    const profile = {
      auth: {
        type: 'bearer' as const,
        accessTokenEnv: 'EXAMPLE_BEARER_TOKEN',
        refresh: {
          type: 'firebase' as const,
          endpoint: 'file:///token',
          refreshTokenEnv: 'EXAMPLE_REFRESH_TOKEN',
          apiKey: 'public-key',
        },
      },
      api: 'bearer-chat',
      chatURL: 'https://chat.example/stream',
      models: [{ id: 'auto' }],
    }
    expect(() => resolveProfiles({ example: profile })).toThrow(/refresh endpoint must use http or https/)
    expect(() => resolveProfiles({ example: {
      ...profile,
      auth: { ...profile.auth, refresh: { ...profile.auth.refresh, endpoint: '' } },
    } })).toThrow(/refresh endpoint must be non-empty/)
  })

  it('resolves an enabled MCP bridge without changing the provider chat route', () => {
    const resolved = resolveProfiles({ example: {
      auth: { type: 'bearer', accessTokenEnv: 'EXAMPLE_BEARER_TOKEN' },
      api: 'bearer-chat',
      chatURL: 'https://chat.example/v3/stream/',
      models: [{ id: 'auto' }],
      mcpBridge: {
        enabled: true,
        endpoint: 'https://tools.example/mcp/v1',
        tokenEnv: 'EXAMPLE_MCP_TOKEN',
      },
    } }).get('example')

    expect(resolved).toMatchObject({
      chatURL: 'https://chat.example/v3/stream/',
      mcpBridge: {
        enabled: true,
        endpoint: 'https://tools.example/mcp/v1',
        tokenEnv: 'EXAMPLE_MCP_TOKEN',
        tokenExchange: true,
        toolCallTimeoutMs: 60_000,
      },
    })
  })

  it('rejects an enabled MCP bridge without an exact HTTP endpoint', () => {
    const profile = {
      auth: { type: 'bearer' as const, accessTokenEnv: 'EXAMPLE_BEARER_TOKEN' },
      api: 'bearer-chat',
      chatURL: 'https://chat.example/stream',
      models: [{ id: 'auto' }],
      mcpBridge: { enabled: true, endpoint: 'file:///tools' },
    }
    expect(() => resolveProfiles({ example: profile })).toThrow(/MCP bridge endpoint must use http or https/)
    expect(() => resolveProfiles({ example: {
      ...profile,
      mcpBridge: { enabled: true, endpoint: '' },
    } })).toThrow(/MCP bridge endpoint must be non-empty/)
  })
})

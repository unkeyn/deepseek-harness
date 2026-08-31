import { afterEach, describe, expect, it, vi } from 'vitest'
import { isFirebaseToken, resolveMcpToken } from '../src/token.ts'
import type { BearerProviderBridgeEntry } from '@deepseek-ai/dsh-fork-llm-bearer'

afterEach(() => { vi.unstubAllGlobals() })

function fakeJwt(issuer: string): string {
  const payload = Buffer.from(JSON.stringify({ iss: issuer })).toString('base64url')
  return `header.${payload}.signature`
}

function entry(token: string, endpoint = 'https://tools.example/mcp/v1'): BearerProviderBridgeEntry {
  return {
    provider: 'example',
    displayName: 'Example',
    chatURL: 'https://chat.example/v1/chat',
    bridge: { enabled: true, endpoint, tokenExchange: true, toolCallTimeoutMs: 60_000 },
    tokenRefs: ['EXAMPLE_TOKEN'],
    resolveToken: async () => token,
  }
}

describe('Bearer MCP token handling', () => {
  it('recognizes Firebase tokens without classifying arbitrary JWTs as Firebase', () => {
    expect(isFirebaseToken(fakeJwt('https://securetoken.google.com/example'))).toBe(true)
    expect(isFirebaseToken(fakeJwt('https://issuer.example'))).toBe(false)
    expect(isFirebaseToken('not-a-jwt')).toBe(false)
  })

  it('exchanges a Firebase token using the target OAuth metadata', async () => {
    const source = fakeJwt('https://securetoken.google.com/example')
    const calls: Array<{ input: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      calls.push({ input: String(input), init })
      if (calls.length === 1) {
        return new Response(JSON.stringify({
          resource: 'https://tools.example/mcp',
          token_exchange_endpoint: 'https://tools.example/oauth/exchange',
        }), { status: 200 })
      }
      if (calls.length === 2) {
        return new Response(JSON.stringify({ token_exchange_endpoint: 'https://tools.example/oauth/exchange' }), { status: 200 })
      }
      return new Response(JSON.stringify({ access_token: 'mcp-token' }), { status: 200 })
    }))

    await expect(resolveMcpToken(entry(source))).resolves.toBe('mcp-token')
    expect(calls[0]?.input).toBe('https://tools.example/.well-known/oauth-protected-resource/mcp/v1')
    expect(calls[1]?.input).toBe('https://tools.example/.well-known/oauth-authorization-server')
    expect(calls[2]?.init?.headers).toMatchObject({ authorization: `Bearer ${source}` })
    expect(String(calls[2]?.init?.body)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Atoken-exchange')
    expect(String(calls[2]?.init?.body)).toContain('resource=https%3A%2F%2Ftools.example%2Fmcp')
  })

  it('passes a non-Firebase provider token through unchanged', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(resolveMcpToken(entry('provider-issued-mcp-token'))).resolves.toBe('provider-issued-mcp-token')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('finds protected-resource metadata on a parent MCP path', async () => {
    const source = fakeJwt('https://session.firebase.google.com/example')
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/mcp/v1')) return new Response('not found', { status: 404 })
      if (url.endsWith('/mcp')) {
        return new Response(JSON.stringify({
          resource: 'https://tools.example/mcp',
          token_exchange_endpoint: 'https://tools.example/oauth/exchange',
        }), { status: 200 })
      }
      if (url.endsWith('/oauth-authorization-server')) {
        return new Response(JSON.stringify({}), { status: 200 })
      }
      return new Response(JSON.stringify({ access_token: 'mcp-token' }), { status: 200 })
    }))

    await expect(resolveMcpToken(entry(source))).resolves.toBe('mcp-token')
    expect(calls.slice(0, 3)).toEqual([
      'https://tools.example/.well-known/oauth-protected-resource/mcp/v1',
      'https://tools.example/.well-known/oauth-protected-resource/mcp',
      'https://tools.example/.well-known/oauth-authorization-server',
    ])
  })
})

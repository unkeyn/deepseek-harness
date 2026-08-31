/** Token handling for provider-agnostic Bearer MCP connections. */

import { createHash } from 'node:crypto'
import type { BearerProviderBridgeEntry } from '@deepseek-ai/dsh-fork-llm-bearer'

interface OAuthMetadata {
  token_endpoint?: unknown
  exchange_endpoint?: unknown
  token_exchange_endpoint?: unknown
  token_exchange?: { endpoint?: unknown }
  scopes_supported?: unknown
}

interface ProtectedResourceMetadata {
  resource?: unknown
  token_exchange_endpoint?: unknown
  authorization_servers?: unknown
  scopes_supported?: unknown
}

/** Return a non-secret fingerprint used only to decide whether a connection changed. */
export function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Detect Firebase ID/session tokens without treating arbitrary JWTs as Firebase. */
export function isFirebaseToken(token: string): boolean {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  try {
    const payloadPart = parts[1]
    if (payloadPart === undefined) return false
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as { iss?: unknown }
    return typeof payload.iss === 'string'
      && (payload.iss.includes('securetoken.google.com') || payload.iss.includes('firebase.google.com'))
  } catch {
    return false
  }
}

/** Resolve the token to send to the provider's MCP endpoint. */
export async function resolveMcpToken(entry: BearerProviderBridgeEntry): Promise<string> {
  const bridge = entry.bridge
  if (bridge === undefined) throw new Error('MCP bridge is not enabled')
  const source = await entry.resolveToken(bridge.tokenEnv)
  if (source === undefined || source.trim().length === 0) {
    throw new Error('the selected Bearer credential is not configured')
  }
  if (!bridge.tokenExchange || !isFirebaseToken(source)) return source
  return exchangeFirebaseToken(source, bridge.endpoint)
}

/** Exchange a Firebase access token only when the target advertises that flow. */
async function exchangeFirebaseToken(source: string, resource: string): Promise<string> {
  const endpoint = new URL(resource)
  const origin = endpoint.origin
  const protectedMetadata = await findProtectedResourceMetadata(origin, endpoint.pathname)
  // A protected-resource document may be complete on its own. Fetch the
  // authorization-server document as an enrichment/fallback, rather than
  // making every valid protected-resource response depend on a second file.
  const metadata = await findOAuthMetadata(origin, protectedMetadata).catch((): OAuthMetadata => ({}))
  const exchangeEndpoint = typeof protectedMetadata?.token_exchange_endpoint === 'string'
    ? protectedMetadata.token_exchange_endpoint
    : typeof metadata.token_exchange_endpoint === 'string'
      ? metadata.token_exchange_endpoint
      : typeof metadata.token_exchange?.endpoint === 'string'
        ? metadata.token_exchange.endpoint
        : typeof metadata.exchange_endpoint === 'string' ? metadata.exchange_endpoint : undefined
  if (exchangeEndpoint === undefined) throw new Error('OAuth metadata does not declare a token exchange endpoint')

  const targetResource = typeof protectedMetadata?.resource === 'string' ? protectedMetadata.resource : resource

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: source,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
    resource: targetResource,
  })
  if (supportsScope(protectedMetadata?.scopes_supported) || supportsScope(metadata.scopes_supported)) {
    body.set('scope', 'mcp:read')
  }
  const response = await fetch(new URL(exchangeEndpoint, origin), {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${source}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
    redirect: 'error',
  })
  if (!response.ok) throw new Error(`OAuth token exchange failed with HTTP ${response.status}`)
  const payload = await response.json() as { access_token?: unknown; token?: unknown }
  const token = typeof payload.access_token === 'string'
    ? payload.access_token
    : typeof payload.token === 'string' ? payload.token : undefined
  if (token === undefined || token.trim().length === 0) throw new Error('OAuth token exchange returned no access token')
  return token
}

async function findOAuthMetadata(origin: string, protectedMetadata: ProtectedResourceMetadata | undefined): Promise<OAuthMetadata> {
  const candidates = [
    `${origin}/.well-known/oauth-authorization-server`,
    ...authorizationServerMetadataURLs(protectedMetadata?.authorization_servers),
  ]
  const attempted = new Set<string>()
  for (const candidate of candidates) {
    if (attempted.has(candidate)) continue
    attempted.add(candidate)
    try {
      const response = await fetch(candidate, { headers: { accept: 'application/json' }, redirect: 'error' })
      if (!response.ok) continue
      return await response.json() as OAuthMetadata
    } catch {
      // A server may publish only the protected-resource document or use a
      // separate authorization-server origin; continue through the candidates.
    }
  }
  throw new Error('OAuth metadata request failed for the protected MCP resource')
}

function authorizationServerMetadataURLs(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const urls: string[] = []
  for (const candidate of value) {
    if (typeof candidate !== 'string') continue
    try {
      const server = new URL(candidate)
      const path = server.pathname.replace(/\/+$/, '')
      urls.push(path.length === 0
        ? `${server.origin}/.well-known/oauth-authorization-server`
        : `${server.origin}/.well-known/oauth-authorization-server${path}`)
    } catch {
      // Ignore malformed metadata entries and preserve the other candidates.
    }
  }
  return urls
}

function supportsScope(value: unknown): boolean {
  return Array.isArray(value) && value.some(scope => scope === 'mcp:read')
}

/** Read the RFC 9728 resource metadata when the server publishes it. */
async function findProtectedResourceMetadata(origin: string, pathname: string): Promise<ProtectedResourceMetadata | undefined> {
  const pathParts = pathname.split('/').filter(Boolean)
  const resourcePaths = pathParts.map((_, index) => `/${pathParts.slice(0, index + 1).join('/')}`).reverse()
  const candidates = [
    ...resourcePaths.map(resourcePath => `${origin}/.well-known/oauth-protected-resource${resourcePath}`),
    `${origin}/.well-known/oauth-protected-resource`,
  ]
  const attempted = new Set<string>()
  for (const candidate of candidates) {
    if (attempted.has(candidate)) continue
    attempted.add(candidate)
    try {
      const response = await fetch(candidate, { headers: { accept: 'application/json' }, redirect: 'error' })
      if (!response.ok) continue
      return await response.json() as ProtectedResourceMetadata
    } catch {
      // The OAuth authorization-server document below remains the fallback.
    }
  }
  return undefined
}

/** Per-request Bearer resolution and Firebase Secure Token rotation. */

import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { assertUsableApiKey, LlmError } from '@deepseek-ai/dsh-fork-llm'
import type { ResolvedBearerAuth } from './config.ts'

/** Refresh before the access token enters its final minute. */
const REFRESH_SKEW_MS = 60_000

/** Minimal credential access used by the resolver. */
export interface BearerCredentialStore {
  /** Resolve one secret reference. */
  resolve(ref: CredentialRef): Promise<string | undefined>
  /** Persist one rotated secret. */
  set(ref: CredentialRef, value: string): Promise<void>
}

interface JwtHints {
  expiresAt?: number
  issuer?: string
}

/** Decode non-authoritative JWT hints used only to decide when to refresh. */
function jwtHints(token: string): JwtHints {
  const payload = token.split('.')[1]
  if (payload === undefined) return {}
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: unknown
      iss?: unknown
    } | null
    const exp = claims?.exp
    const issuer = claims?.iss
    return {
      ...typeof exp === 'number' && Number.isFinite(exp) && exp > 0 ? { expiresAt: exp * 1000 } : {},
      ...typeof issuer === 'string' && issuer.length > 0 ? { issuer } : {},
    }
  } catch (_malformedJwtPayload) {
    // Opaque tokens have no local expiry hint; the provider remains authoritative.
    return {}
  }
}

/** Firebase session cookies must first be exchanged for an API ID token. */
function isFirebaseSessionCookie(issuer: string | undefined): boolean {
  return issuer?.startsWith('https://session.firebase.google.com/') === true
}

interface FirebaseRefreshReply {
  id_token?: unknown
  access_token?: unknown
  refresh_token?: unknown
}

/** Resolve usable Bearer values and durably rotate expiring Firebase ID tokens. */
export class BearerTokenResolver {
  private readonly pending = new Map<string, Promise<string>>()

  constructor(
    private readonly store: BearerCredentialStore,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Resolve the current access token, refreshing it when due.
   * @param provider - provider route used for refresh deduplication and diagnostics.
   * @param auth - validated credential references and optional refresh configuration.
   * @returns a usable current Bearer token after any required durable rotation.
   */
  async resolve(provider: string, auth: ResolvedBearerAuth): Promise<string> {
    const raw = await this.store.resolve(auth.accessTokenEnv)
    if (raw === undefined || raw.length === 0) {
      throw new LlmError(
        `llm-bearer: no Bearer credential for provider route "${provider}"; store ${auth.accessTokenEnv}`,
        'MISSING_CREDENTIAL',
      )
    }
    const accessToken = assertUsableApiKey(raw, 'llm-bearer', auth.accessTokenEnv)
    const hints = jwtHints(accessToken)
    if (auth.refresh === undefined) {
      if (isFirebaseSessionCookie(hints.issuer)) {
        throw new LlmError(
          `llm-bearer: Firebase session cookie ${auth.accessTokenEnv} for provider route "${provider}" requires refresh configuration`,
          'OAUTH_REAUTHENTICATE',
        )
      }
      if (hints.expiresAt !== undefined && hints.expiresAt <= this.now()) {
        throw new LlmError(
          `llm-bearer: Bearer credential ${auth.accessTokenEnv} for provider route "${provider}" has expired`,
          'OAUTH_REAUTHENTICATE',
        )
      }
      return accessToken
    }
    if (hints.expiresAt === undefined) {
      throw new LlmError(
        `llm-bearer: Firebase Bearer credential ${auth.accessTokenEnv} is not a JWT with an expiry`,
        'INVALID_CREDENTIAL',
      )
    }
    if (!isFirebaseSessionCookie(hints.issuer) && hints.expiresAt > this.now() + REFRESH_SKEW_MS) return accessToken

    const refreshKey = [provider, auth.accessTokenEnv, auth.refresh.refreshTokenEnv, auth.refresh.apiKey].join('\0')
    const existing = this.pending.get(refreshKey)
    if (existing !== undefined) return existing
    const refresh = this.refresh(provider, auth)
    this.pending.set(refreshKey, refresh)
    try {
      return await refresh
    } finally {
      if (this.pending.get(refreshKey) === refresh) this.pending.delete(refreshKey)
    }
  }

  /** Exchange and persist one Firebase refresh token. */
  private async refresh(provider: string, auth: ResolvedBearerAuth): Promise<string> {
    const config = auth.refresh
    if (config === undefined) throw new Error('llm-bearer: internal refresh dispatch without refresh configuration')
    const raw = await this.store.resolve(config.refreshTokenEnv)
    if (raw === undefined || raw.length === 0) {
      throw new LlmError(
        `llm-bearer: provider route "${provider}" needs sign-in again; ${config.refreshTokenEnv} is missing`,
        'OAUTH_REAUTHENTICATE',
      )
    }
    const refreshToken = assertUsableApiKey(raw, 'llm-bearer', config.refreshTokenEnv)
    let response: Response
    try {
      if (config.endpoint === undefined || config.endpoint.trim().length === 0) {
        throw new LlmError(`llm-bearer: refresh endpoint is not configured for provider route "${provider}"`, 'AUTH')
      }
      const endpoint = new URL(config.endpoint)
      if (!endpoint.searchParams.has('key')) endpoint.searchParams.set('key', config.apiKey)
      response = await this.fetcher(
        endpoint.toString(),
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
        },
      )
    } catch (error: unknown) {
      throw new LlmError(`llm-bearer: Firebase refresh failed for provider route "${provider}"`, 'AUTH', { cause: error })
    }
    if (!response.ok) {
      throw new LlmError(
        `llm-bearer: Firebase rejected the refresh credential for provider route "${provider}"`,
        response.status === 400 || response.status === 401 ? 'OAUTH_REAUTHENTICATE' : 'AUTH',
        { status: response.status },
      )
    }
    let reply: FirebaseRefreshReply
    try {
      reply = await response.json() as FirebaseRefreshReply
    } catch (error: unknown) {
      throw new LlmError('llm-bearer: Firebase refresh response was not JSON', 'AUTH', { cause: error })
    }
    const rawAccess = typeof reply.id_token === 'string' ? reply.id_token : reply.access_token
    if (typeof rawAccess !== 'string' || rawAccess.length === 0) {
      throw new LlmError('llm-bearer: Firebase refresh response omitted the ID token', 'AUTH')
    }
    const accessToken = assertUsableApiKey(rawAccess, 'llm-bearer', auth.accessTokenEnv)
    const rotatedRefresh = typeof reply.refresh_token === 'string' && reply.refresh_token.length > 0
      ? assertUsableApiKey(reply.refresh_token, 'llm-bearer', config.refreshTokenEnv)
      : refreshToken
    try {
      if (rotatedRefresh !== refreshToken) await this.store.set(config.refreshTokenEnv, rotatedRefresh)
      await this.store.set(auth.accessTokenEnv, accessToken)
    } catch (error: unknown) {
      throw new LlmError(
        `llm-bearer: refreshed credentials for provider route "${provider}" could not be persisted`,
        'CREDENTIAL_WRITE_FAILED',
        { cause: error },
      )
    }
    return accessToken
  }
}

/** Freebuff device-code OAuth and its Cordis service provider. */

import { Context, Service } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider, CredentialRef } from '@deepseek-ai/dsh-credentials'
import {
  OAuthLifecycle,
} from '@deepseek-ai/dsh-fork-credential-oauth'
import type {
  OAuthCredentialReferenceResolver,
  OAuthCredentialStore,
  OAuthLoginResult,
} from '@deepseek-ai/dsh-fork-credential-oauth'
import z from '@deepseek-ai/schemastery'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { getFingerprintId } from './fingerprint.ts'

export const name = 'credential-freebuff-oauth'

const DEFAULT_BASE_URL = 'https://freebuff.com'
const DEFAULT_TOKEN_REFERENCE = 'FREEBUFF_AUTH_TOKEN'
const DEFAULT_POLL_INTERVAL_MS = 5_000
const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60_000
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_ACCOUNT_ID = 'default'
const NEVER_EXPIRES = Number.MAX_SAFE_INTEGER
const DESKTOP_SHORTCUT_NAME = 'DeepSeek Harness Desktop.lnk'

/** Device challenge returned by `/api/auth/cli/code`. */
export interface FreebuffDeviceChallenge {
  readonly fingerprintId: string
  readonly loginUrl: string
  readonly fingerprintHash: string
  readonly expiresAt: string
}

/** User data returned after the browser approves a device challenge. */
export interface FreebuffLoginUser {
  readonly id?: string
  readonly email?: string
  readonly name?: string
  readonly authToken: string
  readonly [key: string]: unknown
}

/** Freebuff OAuth configuration. */
export interface Config {
  /** Freebuff web/API origin. */
  baseURL?: string
  /** Writable credential reference used by the OAuth lifecycle. */
  tokenReference?: string
  /** Delay between pending device-status requests. */
  pollIntervalMs?: number
  /** Maximum time to wait for browser approval. */
  loginTimeoutMs?: number
  /** Timeout applied to each OAuth HTTP request. */
  requestTimeoutMs?: number
  /** Absolute path to the local DeepSeek Harness Desktop shortcut. */
  desktopShortcutPath?: string
}

/** Schema used by loader configuration and settings consumers. */
export const Config: z<Config> = z.object({
  baseURL: z.string().default(DEFAULT_BASE_URL),
  tokenReference: z.string().role('credential-ref').default(DEFAULT_TOKEN_REFERENCE),
  pollIntervalMs: z.number().step(1).min(1).default(DEFAULT_POLL_INTERVAL_MS),
  loginTimeoutMs: z.number().step(1).min(1).default(DEFAULT_LOGIN_TIMEOUT_MS),
  requestTimeoutMs: z.number().step(1).min(1).default(DEFAULT_REQUEST_TIMEOUT_MS),
  desktopShortcutPath: z.string().required(false),
})

/** Options for overriding network access in tests or a host transport. */
export interface FreebuffOAuthProviderOptions {
  readonly baseURL: string
  readonly requestTimeoutMs: number
  readonly fetch?: typeof fetch
}

/** Parameters for a device-code login. */
export interface FreebuffDeviceLoginOptions {
  readonly fingerprintId?: string
  readonly pollIntervalMs?: number
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  readonly sleep?: (milliseconds: number) => Promise<void>
}

/** Result of a completed device-code login. */
export interface FreebuffDeviceLoginResult {
  readonly challenge: FreebuffDeviceChallenge
  readonly account: ReturnType<OAuthLifecycle['snapshot']>[number]
}

/** Browser-safe account metadata exposed by the Host API. */
export interface FreebuffAccountStatus {
  readonly accountId: string
  readonly displayName?: string
  readonly status: 'active' | 'reauthenticate'
}

/** Browser-safe OAuth state exposed by the Host API. */
export interface FreebuffOAuthStatus {
  readonly accounts: readonly FreebuffAccountStatus[]
  readonly pending?: Pick<FreebuffDeviceChallenge, 'loginUrl' | 'expiresAt'>
}

/** Provider-specific OAuth operations for Freebuff's device-code flow. */
export class FreebuffOAuthProvider {
  private readonly fetchImpl: typeof fetch
  private readonly baseURL: string
  private readonly requestTimeoutMs: number

  constructor(options: FreebuffOAuthProviderOptions) {
    this.fetchImpl = options.fetch ?? globalThis.fetch
    this.baseURL = normalizeBaseURL(options.baseURL)
    this.requestTimeoutMs = requirePositiveFinite(options.requestTimeoutMs, 'requestTimeoutMs')
  }

  /** Request a browser URL and the signed values required for status polling. */
  async beginLogin(fingerprintId: string): Promise<FreebuffDeviceChallenge> {
    if (fingerprintId.length === 0) throw new Error('Freebuff fingerprintId must not be empty')
    const response = await this.request('/api/auth/cli/code', {
      method: 'POST',
      body: JSON.stringify({ fingerprintId }),
    })
    const body = await jsonObject(response)
    const challenge = {
      fingerprintId,
      loginUrl: requiredString(body.loginUrl, 'loginUrl'),
      fingerprintHash: requiredString(body.fingerprintHash, 'fingerprintHash'),
      // Preserve the server string exactly: it is part of the status request signature.
      expiresAt: requiredExpiry(body.expiresAt),
    }
    return challenge
  }

  /** Poll until the browser returns a user or the caller aborts/times out. */
  async pollLogin(
    challenge: FreebuffDeviceChallenge,
    options: FreebuffDeviceLoginOptions = {},
  ): Promise<OAuthLoginResult> {
    const intervalMs = requirePositiveFinite(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, 'pollIntervalMs')
    const timeoutMs = requirePositiveFinite(options.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS, 'timeoutMs')
    const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)))
    const startedAt = Date.now()
    let attempts = 0
    while (Date.now() - startedAt < timeoutMs) {
      throwIfAborted(options.signal)
      attempts += 1
      const response = await this.request('/api/auth/cli/status?' + new URLSearchParams({
        fingerprintId: challenge.fingerprintId,
        fingerprintHash: challenge.fingerprintHash,
        expiresAt: challenge.expiresAt,
      }).toString(), {
        method: 'GET',
        pendingStatuses: [401],
        ...options.signal === undefined ? {} : { signal: options.signal },
      })
      const body = await jsonObject(response)
      const user = body.user
      if (isRecord(user) && typeof user.authToken === 'string' && user.authToken.length > 0) {
        return loginResultFromUser(user as FreebuffLoginUser, challenge.fingerprintId)
      }
      await sleep(intervalMs)
    }
    throw new Error(`Freebuff device login timed out after ${timeoutMs}ms (${attempts} attempts)`)
  }

  /** OAuthLifecycle callback adapter for a previously completed device login. */
  completeLogin(callback: string): Promise<OAuthLoginResult> {
    let value: unknown
    try {
      value = JSON.parse(callback)
    } catch (error) {
      return Promise.reject(new Error('Freebuff OAuth callback is not a serialized login result', { cause: error }))
    }
    if (!isRecord(value)) return Promise.reject(new Error('Freebuff OAuth callback is not an object'))
    return Promise.resolve(loginResultFromUser(value as FreebuffLoginUser, DEFAULT_ACCOUNT_ID))
  }

  private async request(
    path: string,
    options: { method: 'GET' | 'POST'; body?: string; signal?: AbortSignal; pendingStatuses?: readonly number[] },
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(this.requestTimeoutMs)
    const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout])
    const response = await this.fetchImpl(`${this.baseURL}${path}`, {
      method: options.method,
      headers: options.body === undefined ? { accept: 'application/json' } : {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      ...options.body === undefined ? {} : { body: options.body },
      signal,
    })
    if (options.pendingStatuses?.includes(response.status) === true) return response
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`Freebuff OAuth request ${options.method} ${path} failed: HTTP ${response.status} ${text.slice(0, 200)}`)
    }
    return response
  }
}

/** OAuth service made available as `ctx.freebuffOAuth` to LLM consumers. */
export class FreebuffOAuthService extends Service {
  private readonly spec: Required<Config>
  private readonly provider: FreebuffOAuthProvider
  private readonly lifecycle: OAuthLifecycle
  private restored = false
  private pendingChallenge: FreebuffDeviceChallenge | undefined
  private invalidation: Promise<void> | undefined

  constructor(ctx: Context, config: Config) {
    super(ctx, 'freebuffOAuth')
    this.spec = resolveConfig(config)
    this.provider = new FreebuffOAuthProvider({ baseURL: this.spec.baseURL, requestTimeoutMs: this.spec.requestTimeoutMs })
    const references: OAuthCredentialReferenceResolver = (_accountId, _includeRefresh) => ({
      accessRef: this.tokenReference(),
    })
    this.lifecycle = new OAuthLifecycle(this.provider, new ContextCredentialStore(ctx), 'FREEBUFF', references)
  }

  /** Return the redacted account metadata currently known to the service. */
  snapshot(): readonly ReturnType<OAuthLifecycle['snapshot']>[number][] {
    return this.lifecycle.snapshot()
  }

  /** Restore the persisted token and return only browser-safe OAuth metadata. */
  async status(): Promise<FreebuffOAuthStatus> {
    await this.restoreStoredToken()
    const accounts = this.lifecycle.snapshot().map(account => ({
      accountId: account.accountId,
      ...account.displayName === undefined ? {} : { displayName: account.displayName },
      status: account.status,
    }))
    const pending = this.pendingChallenge
    return {
      accounts,
      ...pending === undefined ? {} : {
        pending: {
          loginUrl: pending.loginUrl,
          expiresAt: pending.expiresAt,
        },
      },
    }
  }

  /** Return the reference used for the persisted Freebuff token. */
  tokenReference(): CredentialRef {
    return credentialRef(this.spec.tokenReference)
  }

  /** Return the Host-owned shortcut path used by the OAuth settings action. */
  desktopShortcutPath(): string {
    return this.spec.desktopShortcutPath
  }

  /** Request and retain a device challenge until it is completed or replaced. */
  async beginLogin(options: Pick<FreebuffDeviceLoginOptions, 'fingerprintId'> = {}): Promise<FreebuffDeviceChallenge> {
    const fingerprintId = options.fingerprintId ?? await getFingerprintId()
    const challenge = await this.provider.beginLogin(fingerprintId)
    this.pendingChallenge = challenge
    return challenge
  }

  /** Poll the retained device challenge and persist the approved token. */
  async completePendingLogin(options: Omit<FreebuffDeviceLoginOptions, 'fingerprintId'> = {}): Promise<FreebuffDeviceLoginResult> {
    const challenge = this.pendingChallenge
    if (challenge === undefined) throw new Error('Freebuff device login has not been started')
    const result = await this.provider.pollLogin(challenge, {
      ...options,
      pollIntervalMs: options.pollIntervalMs ?? this.spec.pollIntervalMs,
      timeoutMs: options.timeoutMs ?? this.spec.loginTimeoutMs,
    })
    const account = await this.lifecycle.loginResult({
      ...result,
      accountId: DEFAULT_ACCOUNT_ID,
      expiresAt: NEVER_EXPIRES,
    })
    this.restored = true
    this.pendingChallenge = undefined
    return { challenge, account }
  }

  /** Open the browser login URL, poll for approval, and persist the token. */
  async login(options: FreebuffDeviceLoginOptions = {}): Promise<FreebuffDeviceLoginResult> {
    await this.beginLogin(options)
    return this.completePendingLogin(options)
  }

  /** Resolve the current Freebuff access token for one provider request. */
  async accessToken(): Promise<string> {
    await this.restoreStoredToken()
    return this.lifecycle.accessToken(DEFAULT_ACCOUNT_ID)
  }

  /** Remove the local token after Freebuff rejects it and expose signed-out state. */
  async invalidate(): Promise<void> {
    const pending = this.invalidation
    if (pending !== undefined) return pending
    const operation = this.invalidateLocalToken()
    this.invalidation = operation
    try {
      await operation
    } finally {
      if (this.invalidation === operation) this.invalidation = undefined
    }
  }

  /** Remove the local token and report provider revocation as unsupported. */
  async logout(): Promise<void> {
    await this.invalidate()
  }

  private async restoreStoredToken(): Promise<void> {
    if (this.restored) return
    this.restored = true
    const token = await new ContextCredentialStore(this.ctx).resolve(this.tokenReference())
    if (token === undefined) return
    try {
      await this.lifecycle.restore({
        accountId: DEFAULT_ACCOUNT_ID,
        accessToken: token,
        expiresAt: NEVER_EXPIRES,
      })
    } catch (error) {
      this.ctx.logger.warn('freebuff-oauth: stored credential could not be restored')
      this.ctx.logger.warn(error)
    }
  }

  private async invalidateLocalToken(): Promise<void> {
    await this.restoreStoredToken()
    if (this.lifecycle.snapshot().some(account => account.accountId === DEFAULT_ACCOUNT_ID)) {
      await this.lifecycle.logout(DEFAULT_ACCOUNT_ID)
    } else {
      await new ContextCredentialStore(this.ctx).unset(this.tokenReference())
    }
    this.pendingChallenge = undefined
    this.restored = true
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { freebuffOAuth: FreebuffOAuthService }
}

/** Compose the service provider. */
export function apply(ctx: Context, config: Config): void {
  ctx.plugin(FreebuffOAuthService, config)
}

function resolveConfig(config: Config): Required<Config> {
  const baseURL = normalizeBaseURL(config.baseURL ?? DEFAULT_BASE_URL)
  const tokenReference = config.tokenReference ?? DEFAULT_TOKEN_REFERENCE
  credentialRef(tokenReference)
  return {
    baseURL,
    tokenReference,
    pollIntervalMs: requirePositiveFinite(config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS, 'pollIntervalMs'),
    loginTimeoutMs: requirePositiveFinite(config.loginTimeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS, 'loginTimeoutMs'),
    requestTimeoutMs: requirePositiveFinite(config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, 'requestTimeoutMs'),
    desktopShortcutPath: resolveDesktopShortcutPath(config.desktopShortcutPath),
  }
}

function resolveDesktopShortcutPath(value: string | undefined): string {
  const path = value ?? defaultDesktopShortcutPath()
  if (!isAbsolute(path)) throw new Error('Freebuff OAuth desktopShortcutPath must be absolute')
  return path
}

function defaultDesktopShortcutPath(): string {
  const desktop = process.platform === 'win32'
    ? join(homedir(), 'OneDrive', 'Desktop')
    : join(homedir(), 'Desktop')
  return join(desktop, DESKTOP_SHORTCUT_NAME)
}

class ContextCredentialStore implements OAuthCredentialStore {
  constructor(private readonly ctx: Context) {}

  async resolve(ref: CredentialRef): Promise<string | undefined> {
    const provider = this.ctx.get('credentials') as CredentialProvider | undefined
    return (await provider?.resolve(ref))?.value
  }

  async set(ref: CredentialRef, value: string): Promise<void> {
    const provider = this.requireProvider()
    await provider.set(ref, value)
  }

  async unset(ref: CredentialRef): Promise<void> {
    const provider = this.requireProvider()
    await provider.unset(ref)
  }

  private requireProvider(): CredentialProvider {
    const provider = this.ctx.get('credentials') as CredentialProvider | undefined
    if (provider === undefined) throw new Error('freebuff-oauth requires the credentials service to persist OAuth tokens')
    return provider
  }
}

function loginResultFromUser(user: FreebuffLoginUser, fallbackAccountId: string): OAuthLoginResult {
  const accountId = typeof user.id === 'string' && user.id.length > 0
    ? user.id
    : typeof user.email === 'string' && user.email.length > 0
      ? user.email
      : fallbackAccountId
  return {
    accountId,
    ...typeof user.name === 'string' && user.name.length > 0 ? { displayName: user.name } : {},
    accessToken: requiredString(user.authToken, 'authToken'),
    expiresAt: NEVER_EXPIRES,
  }
}

async function jsonObject(response: Response): Promise<Record<string, unknown>> {
  const value: unknown = await response.json()
  if (!isRecord(value)) throw new Error('Freebuff OAuth response must be a JSON object')
  return value
}

function normalizeBaseURL(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('Freebuff OAuth baseURL must use HTTPS outside localhost')
  }
  return value.replace(/\/$/u, '')
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Freebuff OAuth response field '${field}' must be a non-empty string`)
  return value
}

function requiredExpiry(value: unknown): string {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
  throw new Error("Freebuff OAuth response field 'expiresAt' must be a non-empty string or positive integer")
}

function requirePositiveFinite(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Freebuff OAuth ${field} must be positive and finite`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('Freebuff OAuth login aborted')
}

export default FreebuffOAuthService

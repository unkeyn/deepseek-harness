import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type {
  OAuthAccountSnapshot, OAuthCredentialStore, OAuthLoginResult, OAuthLogoutResult, OAuthProvider, OAuthRefreshResult,
  OAuthAccountPool,
  ClaudeCodeOAuthTransport,
  ProviderOAuthAdapter,
} from './types.ts'

export type * from './types.ts'
export {
  RemoteOAuthCredentialStore,
  RemoteOAuthCredentialStoreReadOnlyError,
  projectRemoteOAuthCredentials,
} from './remote.ts'
export type {
  RemoteOAuthCredential,
  RemoteOAuthCredentialSnapshot,
  RemoteOAuthCredentialSnapshotSource,
  RemoteOAuthBrokerSnapshotSource,
} from './remote.ts'

/** Raised when a dead or rejected refresh token requires interactive login. */
export class OAuthReauthenticationRequired extends Error {
  /** Stable machine-readable error code. */
  readonly code = 'OAUTH_REAUTHENTICATE'
  constructor(readonly accountId: string, reason: string) {
    super(`OAuth account '${accountId}' requires reauthentication: ${reason}`)
    this.name = 'OAuthReauthenticationRequired'
  }
}

/** Raised when a provider does not expose a requested OAuth operation. */
export class OAuthUnsupportedOperationError extends Error {
  /** Stable machine-readable error code. */
  readonly code = 'OAUTH_UNSUPPORTED_OPERATION'
  constructor(readonly provider: string, readonly operation: string) {
    super(`${provider} OAuth does not support ${operation}`)
    this.name = 'OAuthUnsupportedOperationError'
  }
}

type Account = OAuthAccountSnapshot

/** Provider-owned credential references for one OAuth account. */
export interface OAuthCredentialReferences {
  /** Reference containing the current access token. */
  readonly accessRef: CredentialRef
  /** Reference containing the refresh token, when the provider supplies one. */
  readonly refreshRef?: CredentialRef
}

/** Resolve references when a provider uses a stable setting rather than generated names. */
export type OAuthCredentialReferenceResolver = (
  accountId: string,
  includeRefresh: boolean,
) => OAuthCredentialReferences

/**
 * Provider-specific OAuth lifecycle with reference-only account metadata.
 * Access and refresh values are resolved only for provider calls and never enter snapshots.
 */
export class OAuthLifecycle {
  private readonly accounts = new Map<string, Account>()
  private readonly refreshes = new Map<string, Promise<string>>()
  private generation = 0

  constructor(
    private readonly provider: OAuthProvider,
    private readonly store: OAuthCredentialStore,
    private readonly referencePrefix: string,
    private readonly referenceResolver?: OAuthCredentialReferenceResolver,
  ) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(referencePrefix)) throw new TypeError('OAuth reference prefix must be an identifier')
  }

  /** Complete a provider callback and persist both token values by generated references.
   * @param callback provider callback value.
   * @returns detached redacted account metadata.
   */
  async login(callback: string): Promise<OAuthAccountSnapshot> {
    const result = await this.provider.completeLogin(callback)
    return this.persistLogin(result)
  }

  /** Persist a provider-validated login result obtained outside a callback exchange.
   * @param result provider login result with the secret still in memory.
   * @returns detached redacted account metadata.
   */
  async loginResult(result: OAuthLoginResult): Promise<OAuthAccountSnapshot> {
    return this.persistLogin(result)
  }

  /** Rebuild one account from an already stored access credential without writing it.
   * @param result account metadata and the credential reference value.
   * @returns detached redacted account metadata.
   */
  async restore(result: OAuthLoginResult): Promise<OAuthAccountSnapshot> {
    validateLogin(result)
    const refs = this.references(result.accountId, result.refreshToken !== undefined)
    const stored = await this.store.resolve(refs.accessRef)
    if (stored === undefined) throw new Error(`OAuth access credential for '${result.accountId}' is unavailable`)
    if (result.refreshToken !== undefined && refs.refreshRef !== undefined) {
      const refresh = await this.store.resolve(refs.refreshRef)
      if (refresh === undefined) throw new Error(`OAuth refresh credential for '${result.accountId}' is unavailable`)
    }
    const account: Account = {
      accountId: result.accountId,
      ...result.displayName === undefined ? {} : { displayName: result.displayName },
      ...refs,
      expiresAt: result.expiresAt,
      generation: ++this.generation,
      status: 'active',
    }
    this.accounts.set(account.accountId, account)
    return { ...account }
  }

  /** Complete a provider setup-token login when the provider exposes that mode.
   * @param setupToken provider setup token.
   * @returns detached redacted account metadata.
   */
  async loginSetupToken(setupToken: string): Promise<OAuthAccountSnapshot> {
    if (this.provider.completeSetupToken === undefined) {
      throw new OAuthUnsupportedOperationError('OAuth provider', 'setup-token login')
    }
    return this.persistLogin(await this.provider.completeSetupToken(setupToken))
  }

  private async persistLogin(result: OAuthLoginResult): Promise<OAuthAccountSnapshot> {
    validateLogin(result)
    const refs = this.references(result.accountId, result.refreshToken !== undefined)
    await this.store.set(refs.accessRef, result.accessToken)
    if (result.refreshToken !== undefined && refs.refreshRef !== undefined) await this.store.set(refs.refreshRef, result.refreshToken)
    const account: Account = {
      accountId: result.accountId,
      ...result.displayName === undefined ? {} : { displayName: result.displayName },
      ...refs,
      expiresAt: result.expiresAt,
      generation: ++this.generation,
      status: 'active',
    }
    this.accounts.set(account.accountId, account)
    return { ...account }
  }

  /** Return a valid access token, deduplicating concurrent refreshes for one account.
   * @param accountId provider account identity.
   * @param now current time used for expiry checks.
   * @returns the current or refreshed access token.
   */
  async accessToken(accountId: string, now = Date.now()): Promise<string> {
    const account = this.requireAccount(accountId)
    if (account.status === 'reauthenticate') throw new OAuthReauthenticationRequired(accountId, account.reauthenticateReason ?? 'provider rejected refresh')
    const current = await this.store.resolve(account.accessRef)
    if (current !== undefined && account.expiresAt > now) return current
    const pending = this.refreshes.get(accountId)
    if (pending !== undefined) return pending
    const refresh = this.refreshAccount(account)
    this.refreshes.set(accountId, refresh)
    try {
      return await refresh
    } finally {
      if (this.refreshes.get(accountId) === refresh) this.refreshes.delete(accountId)
    }
  }

  /**
   * Bind provider-owned authorization and request semantics to this lifecycle.
   * Access-token refresh and reauthentication errors are handled by `accessToken`.
   * @param provider provider request adapter.
   * @returns a lifecycle-bound request adapter.
   */
  adapter<Request, Authorization, Response>(
    provider: ProviderOAuthAdapter<Request, Authorization, Response>,
  ): OAuthRequestAdapter<Request, Authorization, Response> {
    return new OAuthRequestAdapter(this, provider)
  }

  /** Return redacted metadata, optionally restricted by this provider's account policy.
   * @param allowedAccountIds optional account allowlist.
   * @returns detached account metadata.
   */
  snapshot(allowedAccountIds?: ReadonlySet<string>): readonly OAuthAccountSnapshot[] {
    return [...this.accounts.values()]
      .filter(account => allowedAccountIds === undefined || allowedAccountIds.has(account.accountId))
      .map(account => ({ ...account }))
  }

  /** Refresh active accounts whose expiry falls within the supplied skew window.
   * @param now current time used for expiry checks.
   * @param skewMs refresh lead time.
   */
  async refreshDue(now = Date.now(), skewMs = 5 * 60_000): Promise<void> {
    if (!Number.isFinite(now) || !Number.isFinite(skewMs) || skewMs < 0) throw new TypeError('refresh clock values must be finite')
    const targets = [...this.accounts.values()]
      .filter(account => account.status === 'active' && account.expiresAt <= now + skewMs)
    await Promise.all(targets.map(account => this.accessToken(account.accountId, now).then(() => undefined)))
  }

  /** Remove local references first, then report provider revocation guidance/result.
   * @param accountId provider account identity.
   * @returns local cleanup and revocation status.
   */
  async logout(accountId: string): Promise<OAuthLogoutResult> {
    const account = this.requireAccount(accountId)
    const accessToken = await this.store.resolve(account.accessRef)
    const refreshToken = account.refreshRef === undefined ? undefined : await this.store.resolve(account.refreshRef)
    await this.store.unset(account.accessRef)
    if (account.refreshRef !== undefined) await this.store.unset(account.refreshRef)
    this.accounts.delete(accountId)
    if (this.provider.revoke === undefined) return { accountId, localCleanup: 'completed', providerRevocation: 'required' }
    try {
      await this.provider.revoke({
        ...accessToken === undefined ? {} : { accessToken },
        ...refreshToken === undefined ? {} : { refreshToken },
      })
      return { accountId, localCleanup: 'completed', providerRevocation: 'completed' }
    } catch (error) {
      return { accountId, localCleanup: 'completed', providerRevocation: 'failed', providerRevocationError: errorMessage(error) }
    }
  }

  private async refreshAccount(account: Account): Promise<string> {
    if (account.refreshRef === undefined || this.provider.refresh === undefined) {
      return this.markReauthenticateIfCurrent(account, 'provider does not supply a refresh credential')
    }
    const refreshToken = await this.store.resolve(account.refreshRef)
    if (refreshToken === undefined) return this.markReauthenticateIfCurrent(account, 'refresh credential is unavailable')
    let result: OAuthRefreshResult
    try {
      result = await this.provider.refresh(refreshToken)
      validateRefresh(result)
    } catch (error) {
      const current = this.accounts.get(account.accountId)
      if (current !== undefined && current.generation !== account.generation) {
        const replacement = await this.store.resolve(current.accessRef)
        if (replacement !== undefined && current.status === 'active') return replacement
      }
      if (isDefinitiveOAuthFailure(error)) return this.markReauthenticateIfCurrent(account, errorMessage(error))
      throw error
    }
    const current = this.accounts.get(account.accountId)
    if (current?.generation !== account.generation || current.status !== 'active') {
      const replacement = current === undefined ? undefined : await this.store.resolve(current.accessRef)
      if (replacement !== undefined) return replacement
      throw new OAuthReauthenticationRequired(account.accountId, 'refresh was superseded by a newer login')
    }
    await this.store.set(account.accessRef, result.accessToken)
    if (result.refreshToken !== undefined) await this.store.set(account.refreshRef, result.refreshToken)
    const { reauthenticateReason: _reason, ...withoutReason } = account
    this.accounts.set(account.accountId, { ...withoutReason, expiresAt: result.expiresAt, status: 'active' })
    return result.accessToken
  }

  private markReauthenticateIfCurrent(account: Account, reason: string): never {
    const current = this.accounts.get(account.accountId)
    if (current !== undefined && current.generation === account.generation) {
      this.accounts.set(account.accountId, { ...account, status: 'reauthenticate', reauthenticateReason: reason })
      throw new OAuthReauthenticationRequired(account.accountId, reason)
    }
    throw new OAuthReauthenticationRequired(account.accountId, 'refresh was superseded by a newer login')
  }

  private requireAccount(accountId: string): Account {
    const account = this.accounts.get(accountId)
    if (account === undefined) throw new Error(`OAuth account '${accountId}' is not configured`)
    return account
  }

  private references(accountId: string, includeRefresh: boolean): OAuthCredentialReferences {
    if (this.referenceResolver !== undefined) {
      const references = this.referenceResolver(accountId, includeRefresh)
      if (references.refreshRef !== undefined && !includeRefresh) {
        throw new TypeError('OAuth reference resolver returned a refresh reference without a refresh token')
      }
      return references
    }
    const safe = accountId.replace(/[^A-Za-z0-9_]/g, '_')
    return {
      accessRef: credentialRef(`${this.referencePrefix}_${safe}_access`),
      ...includeRefresh ? { refreshRef: credentialRef(`${this.referencePrefix}_${safe}_refresh`) } : {},
    }
  }
}

/** Provider request bridge that keeps token resolution in OAuthLifecycle. */
export class OAuthRequestAdapter<Request, Authorization, Response> {
  constructor(
    private readonly lifecycle: OAuthLifecycle,
    private readonly provider: ProviderOAuthAdapter<Request, Authorization, Response>,
  ) {}

  /** Build provider authorization data after resolving or refreshing the account token.
   * @param accountId provider account identity.
   * @param request provider request data.
   * @returns provider authorization data.
   */
  async authorization(accountId: string, request: Request): Promise<Authorization> {
    const accessToken = await this.lifecycle.accessToken(accountId)
    return this.provider.authorization(accessToken, request)
  }

  /** Execute a provider request after resolving or refreshing the account token.
   * @param accountId provider account identity.
   * @param request provider request data.
   * @returns provider response.
   */
  async request(accountId: string, request: Request): Promise<Response> {
    const accessToken = await this.lifecycle.accessToken(accountId)
    return this.provider.request(accessToken, request)
  }
}

/** Filter redacted accounts using the provider entry from an account-pool policy.
 * @param accounts redacted account metadata.
 * @param provider provider route.
 * @param accountPool optional provider account policy.
 * @returns accounts allowed for the provider.
 */
export function filterOAuthAccounts(
  accounts: readonly OAuthAccountSnapshot[],
  provider: string,
  accountPool?: OAuthAccountPool,
): readonly OAuthAccountSnapshot[] {
  const allowed = accountPool?.get(provider)
  if (allowed === undefined) return accounts
  return accounts.filter(account => allowed.has(account.accountId))
}

/** Classify failures that invalidate the refresh credential rather than the network attempt.
 * @param error provider refresh failure.
 * @returns whether interactive login is required.
 */
export function isDefinitiveOAuthFailure(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()
  return message.includes('invalid_grant') || message.includes('invalid refresh') || message.includes('revoked')
    || /(^|\\D)401(\\D|$)/.test(message) || message.includes('unauthorized')
}

/** Timer owner for periodic OAuth refresh sweeps; callers attach it to Cordis disposal. */
export class OAuthRefreshScheduler {
  private timer: ReturnType<typeof setInterval> | undefined
  private running = false
  private nextSweepAt: number
  private readonly now: () => number
  private readonly skewMs: number
  private readonly intervalMs: number

  constructor(
    private readonly lifecycle: OAuthLifecycle,
    options: { skewMs?: number; intervalMs?: number; now?: () => number } = {},
  ) {
    this.skewMs = options.skewMs ?? 5 * 60_000
    this.intervalMs = options.intervalMs ?? 60_000
    this.now = options.now ?? Date.now
    if (!Number.isFinite(this.skewMs) || this.skewMs < 0 || !Number.isFinite(this.intervalMs) || this.intervalMs <= 0) {
      throw new TypeError('OAuth refresh schedule values are invalid')
    }
    this.nextSweepAt = this.now()
  }

  /** Start periodic refresh sweeps. */
  start(): void {
    if (this.timer !== undefined) return
    this.nextSweepAt = this.now()
    void this.tick()
    this.timer = setInterval(() => { void this.tick() }, this.intervalMs)
  }

  /** Stop periodic refresh sweeps. */
  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
  }

  /** Return the current scheduler projection.
   * @returns interval, skew, and next-sweep metadata.
   */
  getSchedule(): { enabled: boolean; intervalMs: number; skewMs: number; nextSweepAt: number } {
    return { enabled: true, intervalMs: this.intervalMs, skewMs: this.skewMs, nextSweepAt: this.nextSweepAt }
  }

  /** Run one deduplicated refresh sweep. */
  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      await this.lifecycle.refreshDue(this.now(), this.skewMs)
    } finally {
      this.running = false
      this.nextSweepAt = this.now() + this.intervalMs
    }
  }
}

function validateLogin(result: OAuthLoginResult): void {
  if (result.accountId.length === 0 || result.accessToken.length === 0) throw new Error('OAuth login result contains an empty required value')
  if (!Number.isFinite(result.expiresAt)) throw new Error('OAuth login result expiry must be finite')
}

function validateRefresh(result: OAuthRefreshResult): void {
  if (result.accessToken.length === 0 || !Number.isFinite(result.expiresAt)) throw new Error('OAuth refresh result is invalid')
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }


/**
 * Claude Code OAuth provider using caller-supplied transport functions.
 * The documented browser login and setup-token modes are represented here;
 * endpoint discovery, HTTP, and provider-specific token exchange stay outside this package.
 */
export class ClaudeCodeOAuthProvider<Request = unknown, Authorization = unknown, Response = unknown>
implements ProviderOAuthAdapter<Request, Authorization, Response> {
  constructor(private readonly transport: ClaudeCodeOAuthTransport<Request, Authorization, Response>) {}

  /** Complete the documented browser callback login. */
  completeLogin(callback: string): Promise<OAuthLoginResult> {
    return this.transport.completeBrowserLogin(callback)
  }

  /** Complete the documented setup-token login. */
  completeSetupToken(setupToken: string): Promise<OAuthLoginResult> {
    return this.transport.completeSetupToken(setupToken)
  }

  /** Refresh through the injected provider transport, or report unsupported semantics. */
  refresh(refreshToken: string): Promise<OAuthRefreshResult> {
    if (this.transport.refresh === undefined) {
      return Promise.reject(new OAuthUnsupportedOperationError('Claude Code', 'refresh'))
    }
    return this.transport.refresh(refreshToken)
  }

  /** Revoke through the injected provider transport, or report unsupported semantics. */
  revoke(tokens: { readonly accessToken?: string; readonly refreshToken?: string }): Promise<void> {
    if (this.transport.revoke === undefined) {
      return Promise.reject(new OAuthUnsupportedOperationError('Claude Code', 'revoke'))
    }
    return this.transport.revoke(tokens)
  }

  /** Build provider authorization data through the injected transport. */
  authorization(accessToken: string, request: Request): Authorization {
    if (this.transport.authorization === undefined) {
      throw new OAuthUnsupportedOperationError('Claude Code', 'request authorization')
    }
    return this.transport.authorization(accessToken, request)
  }

  /** Execute a provider request through the injected transport. */
  request(accessToken: string, request: Request): Promise<Response> {
    if (this.transport.request === undefined) {
      return Promise.reject(new OAuthUnsupportedOperationError('Claude Code', 'request'))
    }
    return this.transport.request(accessToken, request)
  }
}

/** Alias emphasizing use of Claude Code provider semantics as a lifecycle adapter. */
export class ClaudeCodeOAuthAdapter<Request = unknown, Authorization = unknown, Response = unknown>
  extends ClaudeCodeOAuthProvider<Request, Authorization, Response> {}

/** Deterministic provider used by lifecycle tests and local previews. */
export class FakeOAuthProvider implements OAuthProvider {
  /** Refresh-token inputs observed by the fake provider. */
  readonly refreshCalls: string[] = []
  /** Revocation inputs observed by the fake provider. */
  readonly revocations: Array<{ accessToken?: string; refreshToken?: string }> = []
  /** Requests observed by the fake provider. */
  readonly requests: Array<{ accessToken: string; request: { path: string } }> = []
  private loginResult: OAuthLoginResult | undefined
  private refreshResult: OAuthRefreshResult | undefined
  private requestResult: { status: number; body: string } | undefined
  private refreshError: Error | undefined
  private revokeError: Error | undefined

  /** Configure the next callback exchange result. @param result login result. */
  setLoginResult(result: OAuthLoginResult): void { this.loginResult = result }
  /** Configure a deterministic refresh result. @param result refresh result. */
  setRefreshResult(result: OAuthRefreshResult): void { this.refreshResult = result; this.refreshError = undefined }
  /** Configure a deterministic dead refresh token failure. @param error provider error. */
  setRefreshError(error: Error): void { this.refreshError = error; this.refreshResult = undefined }
  /** Configure provider revocation failure. @param error optional provider error. */
  setRevokeError(error: Error | undefined): void { this.revokeError = error }
  /** Configure a deterministic provider request result. @param result provider response. */
  setRequestResult(result: { status: number; body: string }): void { this.requestResult = { ...result } }
  async completeLogin(_callback: string): Promise<OAuthLoginResult> {
    if (this.loginResult === undefined) throw new Error('fake OAuth login result is not configured')
    return { ...this.loginResult }
  }
  async refresh(refreshToken: string): Promise<OAuthRefreshResult> {
    this.refreshCalls.push(refreshToken)
    if (this.refreshError !== undefined) throw this.refreshError
    if (this.refreshResult === undefined) throw new Error('fake OAuth refresh result is not configured')
    return { ...this.refreshResult }
  }
  async revoke(tokens: { accessToken?: string; refreshToken?: string }): Promise<void> {
    this.revocations.push({ ...tokens })
    if (this.revokeError !== undefined) throw this.revokeError
  }
  /** Build deterministic bearer authorization for a request. */
  authorization(accessToken: string, request: { path: string }): { path: string; authorization: string } {
    return { path: request.path, authorization: `Bearer ${accessToken}` }
  }
  /** Record and return a deterministic provider response. */
  async request(accessToken: string, request: { path: string }): Promise<{ status: number; body: string }> {
    this.requests.push({ accessToken, request: { ...request } })
    if (this.requestResult === undefined) throw new Error('fake OAuth request result is not configured')
    return { ...this.requestResult }
  }
}

export default OAuthLifecycle

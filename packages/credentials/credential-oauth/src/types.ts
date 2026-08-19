import type { CredentialRef } from '@deepseek-ai/dsh-credentials'

/** Secret storage operations used by the OAuth lifecycle; implementations own values. */
export interface OAuthCredentialStore {
  /** Read a token by reference for one provider operation. */
  resolve(ref: CredentialRef): Promise<string | undefined>
  /** Store a token under a provider-owned reference. */
  set(ref: CredentialRef, value: string): Promise<void>
  /** Remove a provider-owned reference. */
  unset(ref: CredentialRef): Promise<void>
}

/** Provider result produced after validating a login callback or setup token. */
export interface OAuthLoginResult {
  readonly accountId: string
  readonly displayName?: string
  readonly accessToken: string
  readonly refreshToken?: string
  readonly expiresAt: number
}

/** Token set returned by a provider refresh operation. */
export interface OAuthRefreshResult {
  readonly accessToken: string
  readonly refreshToken?: string
  readonly expiresAt: number
}

/** Provider-specific OAuth operations; token formats remain provider-owned. */
export interface OAuthProvider {
  /** Exchange and validate a browser callback result. */
  completeLogin(callback: string): Promise<OAuthLoginResult>
  /** Exchange and validate a provider-specific setup token when supported. */
  completeSetupToken?(setupToken: string): Promise<OAuthLoginResult>
  /** Refresh one account using its provider-native refresh token. */
  refresh(refreshToken: string): Promise<OAuthRefreshResult>
  /** Revoke provider-side credentials when supported. */
  revoke?(tokens: { readonly accessToken?: string; readonly refreshToken?: string }): Promise<void>
}

/** Provider-owned OAuth request semantics layered on lifecycle token resolution. */
export interface ProviderOAuthAdapter<Request, Authorization, Response> extends OAuthProvider {
  /** Build provider authorization data from the resolved access token and request. */
  authorization(accessToken: string, request: Request): Authorization
  /** Execute one provider request with the resolved access token and provider request data. */
  request(accessToken: string, request: Request): Promise<Response>
}

/** Injectable provider operations used by the Claude Code OAuth adapter. */
export interface ClaudeCodeOAuthTransport<Request = unknown, Authorization = unknown, Response = unknown> {
  /** Exchange the browser callback returned by the documented login flow. */
  completeBrowserLogin(callback: string): Promise<OAuthLoginResult>
  /** Validate the token entered from the documented setup-token flow. */
  completeSetupToken(setupToken: string): Promise<OAuthLoginResult>
  /** Refresh provider credentials when the provider supplies refresh semantics. */
  refresh?(refreshToken: string): Promise<OAuthRefreshResult>
  /** Revoke provider credentials when the provider supplies revocation semantics. */
  revoke?(tokens: { readonly accessToken?: string; readonly refreshToken?: string }): Promise<void>
  /** Build provider authorization data for a request. */
  authorization?: (accessToken: string, request: Request) => Authorization
  /** Execute a provider request. */
  request?: (accessToken: string, request: Request) => Promise<Response>
}

/** Provider-neutral account lifecycle state. */
export type OAuthAccountStatus = 'active' | 'reauthenticate'

/** Redacted account metadata safe for persistence, diagnostics, and snapshots. */
export interface OAuthAccountSnapshot {
  readonly accountId: string
  readonly displayName?: string
  readonly accessRef: CredentialRef
  readonly refreshRef?: CredentialRef
  readonly expiresAt: number
  /** Monotonic metadata generation used to reject stale refresh failures. */
  readonly generation: number
  readonly status: OAuthAccountStatus
  readonly reauthenticateReason?: string
}

/** OAuth identities allowed for each provider; absent providers are unrestricted. */
export type OAuthAccountPool = ReadonlyMap<string, ReadonlySet<string>>

/** Result of local logout and optional provider revocation. */
export interface OAuthLogoutResult {
  readonly accountId: string
  readonly localCleanup: 'completed'
  readonly providerRevocation: 'completed' | 'required' | 'failed'
  readonly providerRevocationError?: string
}

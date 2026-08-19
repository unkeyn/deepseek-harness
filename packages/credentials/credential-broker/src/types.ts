import type { Branded } from '@deepseek-ai/dsh-brand'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'

/** Nominal identifier for one broker pool. */
export type PoolId = Branded<'CredentialPoolId'>
/** Nominal identifier for one pool entry. */
export type CredentialId = Branded<'BrokerCredentialId'>
/** Nominal identifier for one request lease. */
export type LeaseId = Branded<'CredentialLeaseId'>

/** Brand a validated pool id. */
export const poolId = (value: string): PoolId => {
  if (value.length === 0) throw new TypeError('pool id must be non-empty')
  return value as PoolId
}
/** Brand a validated credential id. */
export const credentialId = (value: string): CredentialId => {
  if (value.length === 0) throw new TypeError('credential id must be non-empty')
  return value as CredentialId
}
/** Brand a validated lease id. */
export const leaseId = (value: string): LeaseId => {
  if (value.length === 0) throw new TypeError('lease id must be non-empty')
  return value as LeaseId
}

/** Authentication material is resolved by the credential provider. */
export type AuthKind = 'api-key' | 'oauth'
/** Reason for acquiring a lease, used by policy and health reporting. */
export type LeasePurpose = 'conversation' | 'compaction' | 'session-title' | 'health-check'

/** Request identity used for one broker selection. */
export interface CredentialBrokerRequest {
  readonly provider: string
  readonly model: string
  readonly sessionId?: string
  readonly agentId?: string
  readonly purpose: LeasePurpose
  /** Credential ids already used by the current bounded failover decision. */
  readonly excludedCredentials?: readonly CredentialId[]
  readonly signal?: AbortSignal
}

/** A reserved credential reference; it contains no secret value. */
export interface CredentialLease {
  readonly id: LeaseId
  readonly pool: PoolId
  readonly credential: CredentialId
  readonly credentialRef: CredentialRef
  readonly authKind: AuthKind
  readonly provider: string
  readonly model: string
}

/** Durable health decision reported after one provider attempt. */
export type FailureDisposition =
  | 'healthy'
  | 'cooldown'
  | 'quarantine'
  | 'model-exclude'
  | 'reauthenticate'
  | 'remove'
  | 'retain'

/** Terminal result of a lease; adapters report it exactly once. */
export type LeaseCompletion =
  | { readonly kind: 'success' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failure'; readonly disposition: FailureDisposition; readonly code: string }

/** A secret-free credential row published by a broker snapshot. */
export interface CredentialBrokerSnapshotEntry {
  readonly id: CredentialId
  readonly pool: PoolId
  readonly provider: string
  readonly reference: CredentialRef
  readonly authKind: AuthKind
  readonly accountId?: string
}

/** Full broker metadata at one monotonic generation. */
export interface CredentialBrokerSnapshot {
  readonly generation: number
  readonly entries: readonly CredentialBrokerSnapshotEntry[]
}

/** Incremental broker metadata notification, modeled after snapshot/SSE streams. */
export type CredentialBrokerSnapshotEvent =
  | { readonly kind: 'snapshot'; readonly generation: number; readonly entries: readonly CredentialBrokerSnapshotEntry[] }
  | { readonly kind: 'entry'; readonly generation: number; readonly entry: CredentialBrokerSnapshotEntry }
  | { readonly kind: 'removed'; readonly generation: number; readonly id: CredentialId }

/** A subscription that releases all listener resources. */
export interface CredentialBrokerSnapshotSubscription {
  dispose(): void
}

/** Listener for one broker snapshot event. */
export type CredentialBrokerSnapshotListener = (event: CredentialBrokerSnapshotEvent) => void

/** Read-only broker metadata source with explicit subscription disposal. */
export interface CredentialBrokerSnapshotSource {
  getSnapshot(): CredentialBrokerSnapshot
  subscribe(listener: CredentialBrokerSnapshotListener): CredentialBrokerSnapshotSubscription
}

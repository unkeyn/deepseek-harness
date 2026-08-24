import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { AuthKind, CredentialBrokerSnapshot, CredentialBrokerSnapshotEntry, CredentialBrokerSnapshotEvent, CredentialBrokerSnapshotSource, CredentialId } from '@deepseek-ai/dsh-fork-credential-broker'
import type { OAuthAccountPool, OAuthCredentialStore } from './types.ts'

/** One secret-free credential row published by a broker for remote consumers. */
export interface RemoteOAuthCredential {
  readonly id: CredentialId
  readonly provider: string
  readonly reference: CredentialRef
  readonly authKind: AuthKind
  /** OAuth account identity used by provider account-pool policy. */
  readonly accountId?: string
}

/** Generation-tagged broker metadata consumed by a remote OAuth projection. */
export interface RemoteOAuthCredentialSnapshot {
  readonly generation: number
  readonly credentials: readonly RemoteOAuthCredential[]
}

/** Read-only source of redacted broker metadata; it never returns token values. */
export interface RemoteOAuthCredentialSnapshotSource {
  getSnapshot(): RemoteOAuthCredentialSnapshot | CredentialBrokerSnapshot
  subscribe?(listener: (event: CredentialBrokerSnapshotEvent) => void): { dispose(): void }
}

export type RemoteOAuthBrokerSnapshotSource = CredentialBrokerSnapshotSource

/** Explicit failure raised when a remote projection is used as a writable store. */
export class RemoteOAuthCredentialStoreReadOnlyError extends Error {
  readonly code = 'OAUTH_REMOTE_STORE_READ_ONLY'

  constructor(operation: 'set' | 'unset') {
    super(`remote OAuth credential store is read-only; ${operation} is not supported`)
    this.name = 'RemoteOAuthCredentialStoreReadOnlyError'
  }
}

/**
 * Read-only OAuth credential store and detached broker metadata projection.
 * The store can expose references and identities but cannot resolve or mutate
 * token values; those operations remain owned by the broker-side provider.
 */
export class RemoteOAuthCredentialStore implements OAuthCredentialStore {
  private generation = -1
  private sourceCredentials: readonly RemoteOAuthCredential[] = []
  private credentials: readonly RemoteOAuthCredential[] = []
  private readonly subscription: { dispose(): void } | undefined

  constructor(
    private readonly source: RemoteOAuthCredentialSnapshotSource,
    private readonly provider: string,
    private readonly accountPool?: OAuthAccountPool,
  ) {
    this.replaceSnapshot(toRemoteSnapshot(source.getSnapshot()))
    this.subscription = source.subscribe?.((event) => { this.applyEvent(event) })
  }

  /** Stop consuming broker metadata and release the source listener. */
  dispose(): void { this.subscription?.dispose() }

  /** Token values do not cross the remote projection. */
  resolve(_ref: CredentialRef): Promise<string | undefined> {
    return Promise.resolve(undefined)
  }

  /** Remote projections cannot write token values. */
  set(_ref: CredentialRef, _value: string): Promise<void> {
    return Promise.reject(new RemoteOAuthCredentialStoreReadOnlyError('set'))
  }

  /** Remote projections cannot remove broker-owned credentials. */
  unset(_ref: CredentialRef): Promise<void> {
    return Promise.reject(new RemoteOAuthCredentialStoreReadOnlyError('unset'))
  }

  /** Replace metadata only when the source generation is newer. */
  replaceSnapshot(snapshot: RemoteOAuthCredentialSnapshot): boolean {
    if (!Number.isSafeInteger(snapshot.generation) || snapshot.generation < 0) {
      throw new TypeError('remote OAuth snapshot generation must be a non-negative safe integer')
    }
    if (snapshot.generation <= this.generation) return false
    this.generation = snapshot.generation
    this.sourceCredentials = snapshot.credentials.map(credential => ({ ...credential }))
    this.credentials = projectRemoteOAuthCredentials(this.sourceCredentials, this.provider, this.accountPool)
    return true
  }

  /** Apply one broker event only when it advances the remote generation. */
  applyEvent(event: CredentialBrokerSnapshotEvent): boolean {
    if (!Number.isSafeInteger(event.generation) || event.generation < 0) {
      throw new TypeError('remote OAuth snapshot generation must be a non-negative safe integer')
    }
    if (event.generation <= this.generation) return false
    if (event.kind === 'snapshot') {
      return this.replaceSnapshot({
        generation: event.generation,
        credentials: event.entries.map(toRemoteCredential),
      })
    }
    const entries = new Map(this.sourceCredentials.map(credential => [credential.id, credential]))
    if (event.kind === 'entry') entries.set(event.entry.id, toRemoteCredential(event.entry))
    else entries.delete(event.id)
    return this.replaceSnapshot({ generation: event.generation, credentials: [...entries.values()] })
  }

  /** Pull the current source snapshot and return a detached projection. */
  snapshot(): RemoteOAuthCredentialSnapshot {
    this.replaceSnapshot(toRemoteSnapshot(this.source.getSnapshot()))
    return {
      generation: this.generation,
      credentials: this.credentials.map(credential => ({ ...credential })),
    }
  }
}

/**
 * Project broker metadata for one provider. OAuth rows obey the provider's
 * account pool; API-key rows remain available because the pool names OAuth
 * identities only.
 */
function toRemoteSnapshot(snapshot: RemoteOAuthCredentialSnapshot | CredentialBrokerSnapshot): RemoteOAuthCredentialSnapshot {
  return 'credentials' in snapshot
    ? { generation: snapshot.generation, credentials: snapshot.credentials.map(credential => ({ ...credential })) }
    : { generation: snapshot.generation, credentials: snapshot.entries.map(toRemoteCredential) }
}

function toRemoteCredential(entry: CredentialBrokerSnapshotEntry): RemoteOAuthCredential {
  return {
    id: entry.id,
    provider: entry.provider,
    reference: entry.reference,
    authKind: entry.authKind,
    ...entry.accountId === undefined ? {} : { accountId: entry.accountId },
  }
}

export function projectRemoteOAuthCredentials(
  credentials: readonly RemoteOAuthCredential[],
  provider: string,
  accountPool?: OAuthAccountPool,
): readonly RemoteOAuthCredential[] {
  const allowed = accountPool?.get(provider)
  return credentials
    .filter(credential => credential.authKind !== 'oauth'
      || credential.provider !== provider
      || allowed === undefined
      || (credential.accountId !== undefined && allowed.has(credential.accountId)))
    .map(credential => ({ ...credential }))
}

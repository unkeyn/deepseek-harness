/**
 * Provider-neutral credential broker Service Definition (`ctx.credentialBroker`).
 * The broker selects a credential lease for one provider attempt; adapters own
 * provider wire calls and report the outcome exactly once.
 * @module @deepseek-ai/dsh-credential-broker
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { CredentialBrokerSnapshotStream } from './snapshot.ts'
import type {
  CredentialBrokerRequest, CredentialLease, LeaseCompletion, LeaseId, PoolId,
  CredentialBrokerSnapshot, CredentialBrokerSnapshotEvent, CredentialBrokerSnapshotListener,
  CredentialBrokerSnapshotSource, CredentialBrokerSnapshotSubscription,
} from './types.ts'

export type {
  AuthKind, CredentialBrokerRequest, CredentialId, CredentialLease, FailureDisposition,
  LeaseCompletion, LeaseId, LeasePurpose, PoolId,
  CredentialBrokerSnapshot, CredentialBrokerSnapshotEntry, CredentialBrokerSnapshotEvent,
  CredentialBrokerSnapshotListener, CredentialBrokerSnapshotSubscription, CredentialBrokerSnapshotSource,
} from './types.ts'

export { CredentialBrokerSnapshotStream } from './snapshot.ts'
export { credentialId, leaseId, poolId } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    credentialBroker: CredentialBroker
  }
}

/**
 * Abstract broker for request-scoped credential selection.
 * Implementations must make acquire/complete atomic with respect to concurrent
 * requests, release a lease on cancellation, and reject a second completion
 * for the same lease. Secret values never cross this interface.
 */
export abstract class CredentialBroker extends Service {
  private readonly snapshotStream = new CredentialBrokerSnapshotStream()

  constructor(ctx: Context) {
    super(ctx, 'credentialBroker')
    ctx.effect(() => () => this.snapshotStream.dispose(), 'credential broker snapshot teardown')
  }

  /** Return detached, secret-free broker metadata.
   * @returns the current metadata snapshot.
   */
  getSnapshot(): CredentialBrokerSnapshot { return this.snapshotStream.getSnapshot() }

  /** Subscribe to generation-tagged metadata changes until disposed.
   * @param listener receives detached metadata events.
   * @returns a disposable subscription.
   */
  subscribeSnapshots(listener: CredentialBrokerSnapshotListener): CredentialBrokerSnapshotSubscription {
    return this.snapshotStream.subscribe(listener)
  }

  /** Subscribe to metadata events through the generic source contract.
   * @param listener receives detached metadata events.
   * @returns a disposable subscription.
   */
  subscribe(listener: CredentialBrokerSnapshotListener): CredentialBrokerSnapshotSubscription {
    return this.subscribeSnapshots(listener)
  }

  /** Expose the read-only source consumed by remote projections. */
  get snapshotSource(): CredentialBrokerSnapshotSource { return this }

  /** Seed the provider baseline before any remote consumer subscribes. */
  protected initializeSnapshot(snapshot: CredentialBrokerSnapshot): void { this.snapshotStream.initialize(snapshot) }

  /** Publish one newer redacted metadata event from a provider implementation. */
  protected publishSnapshot(event: CredentialBrokerSnapshotEvent): boolean { return this.snapshotStream.publish(event) }


  /**
   * Select one eligible credential and reserve one concurrency slot.
   * @param request - provider, model, owner, purpose, and cancellation facts.
   * @returns the lease and reference needed by the adapter to resolve a secret.
   */
  abstract acquire(request: CredentialBrokerRequest): Promise<CredentialLease>

  /**
   * Commit the result of one provider attempt and release its lease.
   * @param leaseId - exact lease returned by {@link acquire}.
   * @param completion - terminal result, including cancellation.
   */
  abstract complete(leaseId: LeaseId, completion: LeaseCompletion): void

  /**
   * List non-secret pool metadata for operations and diagnostics.
   * @returns pool identifiers in provider-defined order.
   */
  abstract listPools(): readonly PoolId[]
}

export default CredentialBroker

/** Keep the import in the generated declaration graph for consumers that inspect the contract. */
export type BrokerCredentialReference = CredentialRef

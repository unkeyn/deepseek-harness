/** Credential broker provider driven by durable pool metadata. */
import { Context } from '@deepseek-ai/cordis'
import { CredentialBroker, leaseId } from '@deepseek-ai/dsh-fork-credential-broker'
import type { CredentialBrokerSnapshotEntry, CredentialBrokerRequest, CredentialLease, LeaseCompletion, LeaseId } from '@deepseek-ai/dsh-fork-credential-broker'
import type { HealthDisposition } from '@deepseek-ai/dsh-fork-credential-health'
import type { CredentialMutationVersion, CredentialRecord, CredentialHealthState, CredentialPoolStore } from '@deepseek-ai/dsh-fork-credential-pool-store'

/** Durable pool-backed broker that arbitrates local lease capacity. */
export class PoolCredentialBroker extends CredentialBroker {
  static inject = ['credentialPoolStore']

  private readonly live = new Map<string, LiveLease>()
  private readonly waiters: Waiter[] = []
  private sequence = 0
  private closed = false

  constructor(ctx: Context) {
    super(ctx)
    ctx.effect(() => () => this.close(), 'pool credential broker teardown')
    const snapshot = this.store().getSnapshot()
    this.initializeSnapshot({
      generation: snapshot.generation ?? 0,
      entries: snapshot.credentials.map(record => ({
        id: record.id,
        pool: record.pool,
        provider: snapshot.pools.find(pool => pool.id === record.pool)?.provider ?? '',
        reference: record.reference,
        authKind: record.authKind,
      } satisfies CredentialBrokerSnapshotEntry)),
    })
  }

  override acquire(request: CredentialBrokerRequest): Promise<CredentialLease> {
    if (this.closed) return Promise.reject(new Error('credential broker is closed'))
    if (request.signal?.aborted) return Promise.reject(abortError())
    const lease = this.tryAcquire(request)
    if (lease !== undefined) return Promise.resolve(lease)
    return new Promise<CredentialLease>((resolve, reject) => {
      const waiter: Waiter = { request, resolve, reject }
      if (request.signal !== undefined) {
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter)
          if (index !== -1) this.waiters.splice(index, 1)
          reject(abortError())
        }
        request.signal.addEventListener('abort', waiter.onAbort, { once: true })
      }
      this.waiters.push(waiter)
    })
  }

  /** Release one live lease.
   * @param id lease identifier returned by {@link acquire}.
   * @param _completion terminal outcome retained for interface symmetry.
   */
  override complete(id: LeaseId, _completion: LeaseCompletion): void {
    this.release(id)
  }

  /** Complete a lease once, then persist the classifier's metadata-only health decision.
   * @param id lease identifier returned by {@link acquire}.
   * @param completion terminal provider outcome.
   * @param disposition health policy decision to persist.
   */
  async completeWithHealth(id: LeaseId, completion: LeaseCompletion, disposition: HealthDisposition): Promise<void> {
    const lease = this.release(id)
    if (completion.kind === 'cancelled') return
    const store = this.store()
    const now = Date.now()
    if (disposition.kind === 'remove') {
      await store.removeCredential(lease.record.id, lease.version)
      this.publishStoreSnapshot()
      return
    }
    const health = healthAfter(lease.record.health, completion, disposition, now, lease.record.id)
    if (disposition.kind === 'reauthenticate') {
      await store.setCredentialReauthentication(
        lease.record.id,
        lease.version,
        disposition.reason,
        failureSummary(completion, disposition, now),
      )
      this.publishStoreSnapshot()
      return
    }
    await store.updateCredentialHealth(lease.record.id, lease.version, health)
    this.publishStoreSnapshot()
  }

  override listPools() { return this.store().getSnapshot().pools.map(pool => pool.id) }

  /** Dispose pending waiters and release all local lease counters. */
  close(): void {
    this.closed = true
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.onAbort !== undefined) waiter.request.signal?.removeEventListener('abort', waiter.onAbort)
      waiter.reject(new Error('credential broker disposed'))
    }
    this.live.clear()
  }

  private store(): CredentialPoolStore { return this.ctx.credentialPoolStore }

  private publishStoreSnapshot(): void {
    const snapshot = this.store().getSnapshot()
    this.publishSnapshot({
      kind: 'snapshot',
      generation: snapshot.generation,
      entries: snapshot.credentials.map(record => ({
        id: record.id,
        pool: record.pool,
        provider: snapshot.pools.find(pool => pool.id === record.pool)?.provider ?? '',
        reference: record.reference,
        authKind: record.authKind,
      })),
    })
  }

  private tryAcquire(request: CredentialBrokerRequest): CredentialLease | undefined {
    const snapshot = this.store().getSnapshot()
    const active = new Map<string, number>()
    const now = Date.now()
    for (const lease of this.live.values()) active.set(lease.record.id, (active.get(lease.record.id) ?? 0) + 1)
    const candidate = snapshot.credentials
      .filter(record => record.enabled
        && record.health.quarantineReason === undefined
        && snapshot.pools.find(pool => pool.id === record.pool)?.provider === request.provider
        && !request.excludedCredentials?.includes(record.id)
        && (record.health.cooldownUntil === undefined || record.health.cooldownUntil <= now)
        && !record.health.excludedModels.includes(request.model)
        && (active.get(record.id) ?? 0) < record.maxConcurrent)
      .sort((left, right) => right.priority - left.priority)[0]
    if (candidate === undefined) return undefined
    const id = leaseId(`lease-${++this.sequence}`)
    this.live.set(id, { record: candidate, version: { generation: candidate.generation, version: snapshot.generation } })
    return {
      id,
      pool: candidate.pool,
      credential: candidate.id,
      credentialRef: candidate.reference,
      authKind: candidate.authKind,
      provider: request.provider,
      model: request.model,
    }
  }

  private release(id: LeaseId): LiveLease {
    const lease = this.live.get(id)
    if (lease === undefined) throw new Error(`lease ${id} is not live`)
    this.live.delete(id)
    this.drain()
    return lease
  }

  private drain(): void {
    for (let index = 0; index < this.waiters.length;) {
      const waiter = this.waiters[index]
      if (waiter === undefined) break
      const lease = this.tryAcquire(waiter.request)
      if (lease === undefined) {
        index += 1
        continue
      }
      this.waiters.splice(index, 1)
      if (waiter.onAbort !== undefined) waiter.request.signal?.removeEventListener('abort', waiter.onAbort)
      waiter.resolve(lease)
    }
  }
}

type LiveLease = { record: CredentialRecord; version: CredentialMutationVersion }
type Waiter = {
  request: CredentialBrokerRequest
  resolve: (lease: CredentialLease) => void
  reject: (error: unknown) => void
  onAbort?: () => void
}
function abortError(): Error { return new Error('credential broker acquire aborted') }

function failureSummary(completion: LeaseCompletion, disposition: HealthDisposition, at: number): { disposition: HealthDisposition['kind']; code: string; at: number } | undefined {
  return completion.kind === 'failure' ? { disposition: disposition.kind, code: completion.code, at } : undefined
}

function healthAfter(previous: CredentialHealthState, completion: LeaseCompletion, disposition: HealthDisposition, now: number, id: CredentialRecord['id']): CredentialHealthState {
  const lastFailure = failureSummary(completion, disposition, now)
  switch (disposition.kind) {
    case 'healthy': {
      const {
        cooldownUntil: _cooldownUntil,
        quarantineReason: _quarantineReason,
        reauthenticateReason: _reauthenticateReason,
        ...stable
      } = previous
      return { ...stable, ...lastFailure === undefined ? {} : { lastFailure }, lastSuccessAt: now }
    }
    case 'cooldown':
      return {
        ...previous,
        ...(disposition.retryAfterMs === undefined ? {} : { cooldownUntil: now + validateDelay(disposition.retryAfterMs) }),
        ...lastFailure === undefined ? {} : { lastFailure },
      }
    case 'quarantine':
      return { ...previous, quarantineReason: disposition.reason, ...lastFailure === undefined ? {} : { lastFailure } }
    case 'model-exclude':
      return {
        ...previous,
        excludedModels: [...new Set([...previous.excludedModels, disposition.model])],
        ...lastFailure === undefined ? {} : { lastFailure },
      }
    case 'retain':
      return { ...previous, ...lastFailure === undefined ? {} : { lastFailure } }
    case 'reauthenticate':
    case 'remove':
      return previous
    default:
      return assertNever(disposition, id)
  }
}
function validateDelay(value: number): number { if (!Number.isSafeInteger(value) || value < 0) throw new Error('credential cooldown retryAfterMs must be a non-negative safe integer'); return value }
function assertNever(value: never, id: CredentialRecord['id']): never { throw new Error(`unsupported health disposition for credential '${id}': ${String(value)}`) }

export default PoolCredentialBroker

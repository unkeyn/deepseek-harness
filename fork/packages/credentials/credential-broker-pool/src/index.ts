/** Credential broker provider driven by durable pool metadata. */
import { Context } from '@deepseek-ai/cordis'
import { CredentialBroker, leaseId } from '@deepseek-ai/dsh-fork-credential-broker'
import type { CredentialBrokerSnapshotEntry, CredentialBrokerRequest, CredentialLease, LeaseCompletion, LeaseId } from '@deepseek-ai/dsh-fork-credential-broker'
import type { HealthDisposition } from '@deepseek-ai/dsh-fork-credential-health'
import { CredentialPoolStaleWriterError } from '@deepseek-ai/dsh-fork-credential-pool-store'
import type { CredentialMutationVersion, CredentialRecord, CredentialHealthState, CredentialPoolStore, PoolSnapshot } from '@deepseek-ai/dsh-fork-credential-pool-store'

/** Durable pool-backed broker that arbitrates local lease capacity. */
export class PoolCredentialBroker extends CredentialBroker {
  static inject = ['credentialPoolStore']

  private readonly live = new Map<string, LiveLease>()
  private readonly waiters: Waiter[] = []
  private readonly rotations = new Map<string, number>()
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
        provider: poolProviderOf(snapshot, record),
        reference: record.reference,
        authKind: record.authKind,
      } satisfies CredentialBrokerSnapshotEntry)),
    })
  }

  /** Select one lease, park while exhausted lease capacity blocks every
   * candidate, or reject when no credential can serve the request now.
   * @param request provider, model, and failover exclusions for one attempt.
   * @returns the lease; rejects with `CREDENTIAL_COOLDOWN` when every candidate
   *   is cooling down (naming the earliest expiry, so the caller retries on its
   *   own schedule instead of holding the request here), `NO_ELIGIBLE_CREDENTIAL`
   *   when every candidate is disabled, quarantined, model-excluded, or excluded
   *   by the request, and an abort error when the request signal fires.
   */
  override acquire(request: CredentialBrokerRequest): Promise<CredentialLease> {
    if (this.closed) return Promise.reject(new Error('credential broker is closed'))
    if (request.signal?.aborted) return Promise.reject(abortError())
    const selected = this.select(request)
    if (selected.kind === 'leased') return Promise.resolve(selected.lease)
    if (selected.kind === 'cooldown') return Promise.reject(credentialCooldownError(request, selected.until))
    if (selected.kind === 'unavailable') return Promise.reject(noEligibleCredentialError(request))
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
    // The next failover acquire can select its lease before this lease's
    // mutation lands, so the store-wide CAS version may have drifted; retry
    // once with a refreshed token instead of silently dropping the decision.
    const write = async (run: (token: CredentialMutationVersion) => Promise<unknown>): Promise<void> => {
      try {
        await run(lease.version)
      } catch (error) {
        const token = error instanceof CredentialPoolStaleWriterError ? refreshedToken(store, lease) : undefined
        if (token === undefined) throw error
        await run(token)
      }
    }
    if (disposition.kind === 'remove') {
      await write(token => store.removeCredential(lease.record.id, token))
      this.publishStoreSnapshot()
      return
    }
    const health = healthAfter(lease.record.health, completion, disposition, now, lease.record.id)
    if (disposition.kind === 'reauthenticate') {
      await write(token => store.setCredentialReauthentication(
        lease.record.id,
        token,
        disposition.reason,
        failureSummary(completion, disposition, now),
      ))
      this.publishStoreSnapshot()
      return
    }
    await write(token => store.updateCredentialHealth(lease.record.id, token, health))
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

  protected publishStoreSnapshot(): void {
    const snapshot = this.store().getSnapshot()
    this.publishSnapshot({
      kind: 'snapshot',
      generation: snapshot.generation,
      entries: snapshot.credentials.map(record => ({
        id: record.id,
        pool: record.pool,
        provider: poolProviderOf(snapshot, record),
        reference: record.reference,
        authKind: record.authKind,
      })),
    })
    // A membership change (a re-enabled or newly added key) can satisfy a
    // capacity waiter that no release would wake.
    this.drain()
  }

  /** Select a lease for the request or name why none is selectable. A cooldown
   * and an exhausted lease capacity are the two blockers that clear without a
   * configuration change; the cooldown rejects so the caller retries on its own
   * schedule, while capacity parks until a release. Disabled, quarantined,
   * request-excluded, and model-excluded records reject outright. */
  private select(request: CredentialBrokerRequest): Selection {
    const snapshot = this.store().getSnapshot()
    const active = new Map<string, number>()
    const now = Date.now()
    for (const lease of this.live.values()) active.set(lease.record.id, (active.get(lease.record.id) ?? 0) + 1)
    const eligible: CredentialRecord[] = []
    let cooldown = false
    let capacity = false
    for (const record of snapshot.credentials) {
      if (poolProviderOf(snapshot, record) !== request.provider) continue
      if (!serviceable(record, request)) continue
      if (record.health.cooldownUntil !== undefined && record.health.cooldownUntil > now) {
        cooldown = true
        continue
      }
      if ((active.get(record.id) ?? 0) >= record.maxConcurrent) {
        capacity = true
        continue
      }
      eligible.push(record)
    }
    if (eligible.length === 0) {
      if (cooldown) return { kind: 'cooldown', until: earliestCooldown(snapshot, request, now) ?? now }
      if (capacity) return { kind: 'capacity' }
      return { kind: 'unavailable' }
    }
    // Priority orders the failover ladder; equal-priority entries rotate so
    // parallel sessions spread across the pool instead of pinning one key.
    const topPriority = Math.max(...eligible.map(record => record.priority))
    const tier = eligible.filter(record => record.priority === topPriority)
    const rotation = this.rotations.get(request.provider) ?? 0
    this.rotations.set(request.provider, rotation + 1)
    const candidate = tier[rotation % tier.length]
    if (candidate === undefined) return { kind: 'unavailable' }
    const id = leaseId(`lease-${++this.sequence}`)
    this.live.set(id, { record: candidate, version: { generation: candidate.generation, version: snapshot.generation } })
    return {
      kind: 'leased',
      lease: {
        id,
        pool: candidate.pool,
        credential: candidate.id,
        credentialRef: candidate.reference,
        authKind: candidate.authKind,
        provider: request.provider,
        model: request.model,
      },
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
      const selected = this.select(waiter.request)
      if (selected.kind === 'capacity') {
        index += 1
        continue
      }
      this.waiters.splice(index, 1)
      if (waiter.onAbort !== undefined) waiter.request.signal?.removeEventListener('abort', waiter.onAbort)
      if (selected.kind === 'unavailable') waiter.reject(noEligibleCredentialError(waiter.request))
      else if (selected.kind === 'cooldown') waiter.reject(credentialCooldownError(waiter.request, selected.until))
      else waiter.resolve(selected.lease)
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
/** One acquire outcome: a lease, or the blocker that kept every candidate out. */
type Selection =
  | { kind: 'leased'; lease: CredentialLease }
  | { kind: 'cooldown'; until: number }
  | { kind: 'capacity' }
  | { kind: 'unavailable' }
function abortError(): Error { return new Error('credential broker acquire aborted') }

function poolProviderOf(snapshot: PoolSnapshot, record: CredentialRecord): string {
  return snapshot.pools.find(pool => pool.id === record.pool)?.provider ?? ''
}

/** Whether the record could serve the request but for a cooldown or lease
 * capacity — the two blockers that clear without a configuration change. */
function serviceable(record: CredentialRecord, request: CredentialBrokerRequest): boolean {
  return record.enabled
    && record.health.quarantineReason === undefined
    && !request.excludedCredentials?.includes(record.id)
    && !record.health.excludedModels.includes(request.model)
}

/** The earliest cooldown expiry among the request's serviceable candidates. */
function earliestCooldown(snapshot: PoolSnapshot, request: CredentialBrokerRequest, now: number): number | undefined {
  let earliest: number | undefined
  for (const record of snapshot.credentials) {
    const until = record.health.cooldownUntil
    if (until === undefined || until <= now) continue
    if (poolProviderOf(snapshot, record) !== request.provider) continue
    if (!serviceable(record, request)) continue
    earliest = earliest === undefined ? until : Math.min(earliest, until)
  }
  return earliest
}

/** The lease's CAS token re-read from the current snapshot, or `undefined`
 * when another health decision already mutated this credential — the one
 * staleness a refresh must not paper over. */
function refreshedToken(store: CredentialPoolStore, lease: LiveLease): CredentialMutationVersion | undefined {
  const snapshot = store.getSnapshot()
  const current = snapshot.credentials.find(record => record.id === lease.record.id)
  if (current === undefined || current.generation !== lease.record.generation) return undefined
  return { generation: current.generation, version: snapshot.generation }
}

/** The rejection for a request no pool credential can ever serve: waiting
 * cannot change disabled, quarantined, model-excluded, or request-excluded
 * candidates, so the caller must surface the failure or change the request. */
function noEligibleCredentialError(request: CredentialBrokerRequest): Error {
  const error = new Error(
    `no eligible credential for provider "${request.provider}" and model "${request.model}":`
    + ' every pooled credential is disabled, quarantined, model-excluded, or excluded by this request',
  ) as Error & { code: string }
  error.code = 'NO_ELIGIBLE_CREDENTIAL'
  return error
}

/** The rejection for a request whose every candidate is cooling down. The
 * caller retries on its own visible schedule instead of holding the request
 * inside the broker for the cooldown's remainder. */
function credentialCooldownError(request: CredentialBrokerRequest, until: number): Error {
  const error = new Error(
    `every pooled credential for provider "${request.provider}" is cooling down until`
    + ` ${new Date(until).toISOString()} (model "${request.model}")`,
  ) as Error & { code: string }
  error.code = 'CREDENTIAL_COOLDOWN'
  return error
}

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

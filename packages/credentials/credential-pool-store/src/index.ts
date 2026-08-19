/** Durable provider-neutral pool metadata store backed by the storage KV facet. */
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialId, poolId } from '@deepseek-ai/dsh-credential-broker'
import type { AuthKind, CredentialId, FailureDisposition, PoolId } from '@deepseek-ai/dsh-credential-broker'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { KvUnit } from '@deepseek-ai/dsh-storage'

const FORMAT_VERSION = 3
const UNIT_NAME = 'credential_pools'
const AUTH_KINDS = new Set<AuthKind>(['api-key', 'oauth'])
const FAILURE_DISPOSITIONS = new Set<FailureDisposition>([
  'healthy', 'cooldown', 'quarantine', 'model-exclude', 'reauthenticate', 'remove', 'retain',
])

export interface Config {
  backend?: string
  unitName?: string
}

export const Config: z<Config> = z.object({
  backend: z.string().default('json'),
  unitName: z.string().default(UNIT_NAME),
})

export interface PoolRecord {
  readonly id: PoolId
  readonly provider: string
}

/** Most recent classified provider failure retained for operations and diagnostics. */
export interface CredentialFailureSummary {
  readonly disposition: FailureDisposition
  readonly code: string
  readonly at: number
}

/** Durable operational state that does not contain credential values. */
export interface CredentialHealthState {
  readonly cooldownUntil?: number
  readonly quarantineReason?: string
  readonly reauthenticateReason?: string
  readonly excludedModels: readonly string[]
  readonly lastFailure?: CredentialFailureSummary
  readonly lastSuccessAt?: number
}

export interface CredentialRecord {
  readonly id: CredentialId
  readonly pool: PoolId
  readonly reference: CredentialRef
  readonly authKind: AuthKind
  readonly priority: number
  readonly maxConcurrent: number
  readonly enabled: boolean
  readonly health: CredentialHealthState
  /** Monotonic id generation used to fence stale disable and refresh writers. */
  readonly generation: number
}

export interface PoolSnapshot {
  readonly version: typeof FORMAT_VERSION
  /** Monotonic snapshot generation advanced after every durable mutation. */
  readonly generation: number
  readonly pools: readonly PoolRecord[]
  readonly credentials: readonly CredentialRecord[]
}

/** CAS token returned with a credential projection and required for mutations. */
export interface CredentialMutationVersion {
  readonly generation: number
  /** Snapshot generation, not the storage format version. */
  readonly version: number
}

export interface CredentialMutationResult {
  readonly credential: CredentialRecord
  readonly version: CredentialMutationVersion
}

/** Explicit error returned when a writer presents an obsolete credential CAS token. */
export class CredentialPoolStaleWriterError extends Error {
  readonly code = 'CREDENTIAL_POOL_STALE_WRITER'
  constructor(
    readonly credential: CredentialId,
    readonly expected: CredentialMutationVersion,
    readonly actual: CredentialMutationVersion | undefined,
  ) {
    super(`credential '${credential}' mutation is stale: expected generation ${expected.generation} / version ${expected.version}`)
    this.name = 'CredentialPoolStaleWriterError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    credentialPoolStore: CredentialPoolStore
  }
}

/** Durable metadata store; credential values remain in `ctx.credentials`. */
export class CredentialPoolStore extends Service {
  static inject = ['storage']
  static Config: z<Config> = Config

  private readonly backend: string
  private readonly unitName: string
  private unit!: KvUnit
  private snapshot: PoolSnapshot = { version: FORMAT_VERSION, generation: 0, pools: [], credentials: [] }
  private operations: Promise<void> = Promise.resolve()
  private closed = false

  constructor(ctx: Context, config: Config) {
    super(ctx, 'credentialPoolStore')
    this.backend = config.backend ?? 'json'
    this.unitName = config.unitName ?? UNIT_NAME
  }

  async* [Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    yield async () => {
      this.closed = true
      await this.operations
      await this.unit?.close()
    }
    const backend = this.ctx.storage.backend.get(this.backend)
    if (backend.kv === undefined) throw new Error(`storage backend '${this.backend}' has no kv facet`)
    this.unit = await backend.kv.open({ name: this.unitName, version: FORMAT_VERSION, tables: [], hasGlobal: true })
    const loaded = await this.unit.loadAll()
    this.snapshot = validateSnapshot(loaded.global)
  }

  /** Read a detached metadata snapshot. */
  getSnapshot(): PoolSnapshot { return detachSnapshot(this.snapshot) }

  /** Create or replace one pool, rejecting provider changes for existing entries. */
  async upsertPool(record: PoolRecord): Promise<void> {
    await this.enqueue((current) => {
      const id = poolId(String(record.id))
      const provider = nonEmpty(record.provider, 'pool provider')
      const existing = current.pools.find(pool => pool.id === id)
      if (existing !== undefined && existing.provider !== provider) {
        throw new Error(`pool '${id}' provider cannot change while metadata exists`)
      }
      const pools = current.pools.filter(pool => pool.id !== id)
      pools.push({ id, provider })
      return { ...current, pools }
    })
  }

  /** Create or replace one entry after validating its pool, reference, and health state. */
  async upsertCredential(record: Omit<CredentialRecord, 'generation'> & { readonly generation?: number }): Promise<void> {
    await this.enqueue((current) => {
      const id = credentialId(String(record.id))
      const pool = poolId(String(record.pool))
      if (!current.pools.some(candidate => candidate.id === pool)) throw new Error(`pool '${pool}' does not exist`)
      const reference = credentialRef(String(record.reference))
      if (!Number.isSafeInteger(record.priority)) throw new Error('credential priority must be a safe integer')
      if (!Number.isSafeInteger(record.maxConcurrent) || record.maxConcurrent < 1) throw new Error('credential maxConcurrent must be positive')
      const duplicate = current.credentials.find(candidate => candidate.pool === pool
        && candidate.reference === reference
        && candidate.id !== id)
      if (duplicate !== undefined) throw new Error(`credential reference '${reference}' is already assigned in pool '${pool}'`)
      const previous = current.credentials.find(candidate => candidate.id === id)
      const credentials = current.credentials.filter(candidate => candidate.id !== id)
      credentials.push({
        id, pool, reference, authKind: validateAuthKind(record.authKind, id), priority: record.priority,
        maxConcurrent: record.maxConcurrent, enabled: validateBoolean(record.enabled, `credential '${id}' enabled`),
        health: validateHealth(record.health, id), generation: previous === undefined ? record.generation ?? 0 : previous.generation + 1,
      })
      return { ...current, credentials }
    })
  }

  /** Replace non-secret health state when the credential CAS token is current. */
  async updateCredentialHealth(
    id: CredentialId,
    expected: CredentialMutationVersion,
    health: CredentialHealthState,
  ): Promise<CredentialMutationResult> {
    return this.mutateCredential(id, expected, () => ({ health: validateHealth(health, id) }))
  }

  /** Enable or disable a credential without resolving or writing its secret. */
  async setCredentialEnabled(id: CredentialId, expected: CredentialMutationVersion, enabled: boolean): Promise<CredentialMutationResult> {
    return this.mutateCredential(id, expected, () => ({ enabled: validateBoolean(enabled, `credential '${id}' enabled`) }))
  }

  /** Mark a credential as requiring reauthentication without touching credential values. */
  async setCredentialReauthentication(
    id: CredentialId,
    expected: CredentialMutationVersion,
    reason: string,
    failure?: CredentialFailureSummary,
  ): Promise<CredentialMutationResult> {
    const reauthenticateReason = nonEmpty(reason, 'reauthentication reason')
    const lastFailure = failure === undefined ? undefined : validateFailure(failure, id)
    return this.mutateCredential(id, expected, record => ({
      enabled: false,
      health: { ...record.health, reauthenticateReason, ...lastFailure === undefined ? {} : { lastFailure } },
    }))
  }

  /** Remove one credential when the caller still owns its CAS token. */
  async removeCredential(id: CredentialId, expected?: CredentialMutationVersion): Promise<void> {
    await this.enqueue((current) => {
      if (expected !== undefined) {
        const credential = current.credentials.find(record => record.id === id)
        if (credential === undefined) {
          throw new CredentialPoolStaleWriterError(id, expected, undefined)
        }
        const actual = { generation: credential.generation, version: current.generation }
        if (actual.generation !== expected.generation || actual.version !== expected.version) {
          throw new CredentialPoolStaleWriterError(id, expected, actual)
        }
      }
      return { ...current, credentials: current.credentials.filter(record => record.id !== id) }
    })
  }

  private async mutateCredential(
    id: CredentialId,
    expected: CredentialMutationVersion,
    changes: (record: CredentialRecord) => Partial<CredentialRecord>,
  ): Promise<CredentialMutationResult> {
    let result!: CredentialMutationResult
    await this.enqueue((current) => {
      const credential = current.credentials.find(record => record.id === id)
      if (credential === undefined) {
        throw new CredentialPoolStaleWriterError(id, expected, undefined)
      }
      const actual = { generation: credential.generation, version: current.generation }
      if (actual.generation !== expected.generation || actual.version !== expected.version) {
        throw new CredentialPoolStaleWriterError(id, expected, actual)
      }
      const nextCredential = { ...credential, ...changes(credential), generation: credential.generation + 1 }
      const credentials = current.credentials.map(record => record.id === id ? nextCredential : record)
      const next = { ...current, credentials }
      result = {
        credential: detachCredential(nextCredential),
        version: { generation: nextCredential.generation, version: next.generation + 1 },
      }
      return next
    })
    return result
  }

  private async enqueue(mutator: (current: PoolSnapshot) => PoolSnapshot): Promise<void> {
    if (this.closed) throw new Error('credential pool store is closed')
    const operation = this.operations.then(async () => {
      if (this.closed) throw new Error('credential pool store is closed')
      const next = validateSnapshot({ ...mutator(detachSnapshot(this.snapshot)), generation: this.snapshot.generation + 1 })
      await this.unit.setGlobal(next)
      this.snapshot = next
    })
    this.operations = operation.then(() => undefined, () => undefined)
    await operation
  }
}

function validateSnapshot(value: unknown): PoolSnapshot {
  if (value === null || typeof value !== 'object') return { version: FORMAT_VERSION, generation: 0, pools: [], credentials: [] }
  const candidate = value as { version?: unknown; generation?: unknown; pools?: unknown; credentials?: unknown }
  if (candidate.version !== FORMAT_VERSION || !Array.isArray(candidate.pools) || !Array.isArray(candidate.credentials)) {
    throw new Error(`credential pool metadata version must be ${FORMAT_VERSION}`)
  }
  const generation = candidate.generation === undefined ? 0 : requiredTimestamp(candidate.generation, 'credential pool metadata generation')
  const pools = candidate.pools.map((value) => {
    const record = value as { id?: unknown; provider?: unknown }
    return { id: poolId(String(record.id)), provider: nonEmpty(String(record.provider), 'pool provider') }
  })
  const poolIds = new Set(pools.map(pool => pool.id))
  if (poolIds.size !== pools.length) throw new Error('credential pool metadata contains duplicate pool ids')
  const credentials = candidate.credentials.map((value) => {
    const record = value as Record<string, unknown>
    const id = credentialId(String(record.id))
    const pool = poolId(String(record.pool))
    const reference = credentialRef(String(record.reference))
    const maxConcurrent = Number(record.maxConcurrent); const priority = Number(record.priority)
    if (!poolIds.has(pool)) throw new Error(`credential '${id}' references missing pool '${pool}'`)
    if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || !Number.isSafeInteger(priority)) throw new Error(`credential '${id}' has invalid limits`)
    return {
      id, pool, reference, authKind: validateAuthKind(record.authKind, id), priority, maxConcurrent,
      enabled: validateBoolean(record.enabled, `credential '${id}' enabled`), health: validateHealth(record.health, id),
      generation: record.generation === undefined ? 0 : requiredTimestamp(record.generation, `credential '${id}' generation`),
    }
  })
  const ids = new Set<string>(); const references = new Set<string>()
  for (const credential of credentials) {
    if (ids.has(credential.id)) throw new Error(`credential pool metadata contains duplicate credential id '${credential.id}'`)
    const referenceKey = `${credential.pool}:${credential.reference}`
    if (references.has(referenceKey)) throw new Error(`credential pool metadata contains duplicate reference '${referenceKey}'`)
    ids.add(credential.id); references.add(referenceKey)
  }
  return { version: FORMAT_VERSION, generation, pools, credentials }
}

function validateHealth(value: unknown, id: CredentialId): CredentialHealthState {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`credential '${id}' has invalid health state`)
  const health = value as Record<string, unknown>; const excludedModels = health.excludedModels
  if (!Array.isArray(excludedModels)) throw new Error(`credential '${id}' health excludedModels must be an array`)
  const models = excludedModels.map((model, index) => nonEmptyString(model, `credential '${id}' health excludedModels[${index}]`))
  if (new Set(models).size !== models.length) throw new Error(`credential '${id}' health contains duplicate excluded models`)
  const cooldownUntil = optionalTimestamp(health.cooldownUntil, `credential '${id}' health cooldownUntil`)
  const quarantineReason = optionalNonEmptyString(health.quarantineReason, `credential '${id}' health quarantineReason`)
  const reauthenticateReason = optionalNonEmptyString(health.reauthenticateReason, `credential '${id}' health reauthenticateReason`)
  const lastSuccessAt = optionalTimestamp(health.lastSuccessAt, `credential '${id}' health lastSuccessAt`)
  const lastFailure = validateFailure(health.lastFailure, id)
  return {
    ...cooldownUntil === undefined ? {} : { cooldownUntil },
    ...quarantineReason === undefined ? {} : { quarantineReason },
    ...reauthenticateReason === undefined ? {} : { reauthenticateReason },
    excludedModels: models,
    ...lastFailure === undefined ? {} : { lastFailure },
    ...lastSuccessAt === undefined ? {} : { lastSuccessAt },
  }
}
function validateFailure(value: unknown, id: CredentialId): CredentialFailureSummary | undefined {
  if (value === undefined) return undefined
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`credential '${id}' has invalid health lastFailure`)
  const failure = value as Record<string, unknown>
  if (typeof failure.disposition !== 'string' || !FAILURE_DISPOSITIONS.has(failure.disposition as FailureDisposition)) throw new Error(`credential '${id}' has invalid health failure disposition`)
  return {
    disposition: failure.disposition as FailureDisposition,
    code: nonEmptyString(failure.code, `credential '${id}' health failure code`),
    at: requiredTimestamp(failure.at, `credential '${id}' health failure time`),
  }
}
function detachCredential(record: CredentialRecord): CredentialRecord {
  return {
    ...record,
    health: {
      ...record.health,
      excludedModels: [...record.health.excludedModels],
      ...record.health.lastFailure === undefined ? {} : { lastFailure: { ...record.health.lastFailure } },
    },
  }
}
function detachSnapshot(snapshot: PoolSnapshot): PoolSnapshot {
  return {
    version: FORMAT_VERSION,
    generation: snapshot.generation,
    pools: snapshot.pools.map(pool => ({ ...pool })),
    credentials: snapshot.credentials.map(detachCredential),
  }
}
function validateAuthKind(value: unknown, id: CredentialId): AuthKind { if (typeof value !== 'string' || !AUTH_KINDS.has(value as AuthKind)) throw new Error(`credential '${id}' has invalid auth kind`); return value as AuthKind }
function validateBoolean(value: unknown, label: string): boolean { if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`); return value }
function optionalTimestamp(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  return requiredTimestamp(value, label)
}
function requiredTimestamp(value: unknown, label: string): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`); return value }
function optionalNonEmptyString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  return nonEmptyString(value, label)
}
function nonEmptyString(value: unknown, label: string): string { if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be non-empty`); return value }
function nonEmpty(value: string, label: string): string { if (value.length === 0) throw new Error(`${label} must be non-empty`); return value }

export default CredentialPoolStore

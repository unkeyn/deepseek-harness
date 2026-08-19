/** In-memory broker provider for local composition tests and previews. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { CredentialBroker, credentialId, leaseId, poolId } from '@deepseek-ai/dsh-credential-broker'
import type {
  AuthKind, CredentialBrokerRequest, CredentialLease, LeaseCompletion, LeaseId,
  CredentialBrokerSnapshotEntry,
} from '@deepseek-ai/dsh-credential-broker'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

export const name = 'credential-broker-memory'
export const inject = []

export interface EntryConfig {
  pool: string
  credential: string
  reference: string
  authKind: AuthKind
  maxConcurrent?: number
  priority?: number
}

export interface Config {
  entries: EntryConfig[]
}

type Entry = {
  pool: ReturnType<typeof poolId>
  credential: ReturnType<typeof credentialId>
  reference: CredentialRef
  authKind: AuthKind
  maxConcurrent: number
  priority: number
  active: number
}
type Waiter = {
  request: CredentialBrokerRequest
  resolve: (lease: CredentialLease) => void
  reject: (error: unknown) => void
  onAbort?: () => void
}

/**
 * Deterministic broker provider. It stores references and operational counters
 * only; credential values remain in `ctx.credentials`.
 */
export class MemoryCredentialBroker extends CredentialBroker {
  static Config: z<Config> = z.object({
    entries: z.array(z.object({
      pool: z.string().required(),
      credential: z.string().required(),
      reference: z.string().required(),
      authKind: z.union(['api-key', 'oauth'] as const).required(),
      maxConcurrent: z.number().step(1).min(1).default(1),
      priority: z.number().default(0),
    })).required(),
  })

  private readonly entries: Entry[]
  private readonly live = new Map<string, Entry>()
  private readonly waiters: Waiter[] = []
  private sequence = 0
  private closed = false

  constructor(ctx: Context, config: Config) {
    super(ctx)
    this.entries = config.entries.map(entry => ({
      pool: poolId(entry.pool),
      credential: credentialId(entry.credential),
      reference: credentialRef(entry.reference),
      authKind: entry.authKind,
      maxConcurrent: entry.maxConcurrent ?? 1,
      priority: entry.priority ?? 0,
      active: 0,
    }))
    if (this.entries.length === 0) throw new Error('memory credential broker requires at least one entry')
    ctx.effect(() => () => this.close(), 'memory credential broker teardown')
    const identities = new Set<string>()
    for (const entry of this.entries) {
      const identity = `${entry.pool}:${entry.credential}`
      if (identities.has(identity)) throw new Error(`duplicate broker entry ${identity}`)
      identities.add(identity)
    }
    this.initializeSnapshot({
      generation: 0,
      entries: this.entries.map(entry => ({
        id: entry.credential, pool: entry.pool, provider: '', reference: entry.reference, authKind: entry.authKind,
      } satisfies CredentialBrokerSnapshotEntry)),
    })
  }

  override acquire(request: CredentialBrokerRequest): Promise<CredentialLease> {
    if (this.closed) return Promise.reject(new Error('credential broker is closed'))
    if (request.provider.length === 0 || request.model.length === 0) {
      return Promise.reject(new Error('broker request provider and model must be non-empty'))
    }
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

  override complete(id: LeaseId, _completion: LeaseCompletion): void {
    const entry = this.live.get(id)
    if (entry === undefined) throw new Error(`lease ${id} is not live`)
    this.live.delete(id)
    entry.active -= 1
    this.drain()
  }

  override listPools() {
    return [...new Set(this.entries.map(entry => entry.pool))]
  }

  close(): void {
    this.closed = true
    for (const waiter of this.waiters.splice(0)) {
      if (waiter.onAbort !== undefined) waiter.request.signal?.removeEventListener('abort', waiter.onAbort)
      waiter.reject(new Error('credential broker disposed'))
    }
    this.live.clear()
  }

  private tryAcquire(request: CredentialBrokerRequest): CredentialLease | undefined {
    const entry = this.entries
      .filter(candidate => candidate.active < candidate.maxConcurrent
        && !request.excludedCredentials?.includes(candidate.credential))
      .sort((left, right) => right.priority - left.priority)[0]
    if (entry === undefined) return undefined
    const id = leaseId(`lease-${++this.sequence}`)
    entry.active += 1
    this.live.set(id, entry)
    return {
      id,
      pool: entry.pool,
      credential: entry.credential,
      authKind: entry.authKind,
      credentialRef: entry.reference,
      provider: request.provider,
      model: request.model,
    }
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

export default MemoryCredentialBroker

function abortError(): Error {
  return new Error('credential broker acquire aborted')
}

export function apply(ctx: Context, config: Config): void {
  ctx.plugin(MemoryCredentialBroker, config)
}

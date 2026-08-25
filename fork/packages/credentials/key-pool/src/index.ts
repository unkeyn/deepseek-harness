/**
 * User-managed API key pools for provider routes. Each pool names a provider
 * and several credential references; the broker rotates equal-priority keys
 * across concurrent requests, cools a key down after classified failures, and
 * fails over to the next eligible key within a bounded attempt budget. Key
 * values stay in `ctx.credentials`; this plugin stores references and redacted
 * health metadata in the `key-pool` settings namespace only.
 * @module @deepseek-ai/dsh-fork-key-pool
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { credentialId, poolId } from '@deepseek-ai/dsh-fork-credential-broker'
import type { CredentialFailureSummary, CredentialHealthState } from '@deepseek-ai/dsh-fork-credential-pool-store'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { KeyPoolBroker } from './broker.ts'
import { KeyPool } from './face.ts'
import { KeyPoolHealth } from './health.ts'
import { FORMAT_VERSION, KeyPoolStore } from './store.ts'

export const name = 'key-pool'
/** No hard service dependencies: the broker composition needs only optional
 * services, resolved with `ctx.get` guards below. */
export const inject: string[] = []

/** Settings namespace for user-managed API key pools. */
export const KEY_POOL_SETTINGS_NAMESPACE = settingsNamespace('key-pool')

const MAX_POOLS = 32
const MAX_KEYS_PER_POOL = 32
const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_COOLDOWN_MS = 30_000
const DEFAULT_MAX_CONCURRENT_PER_KEY = 4
const MAX_COOLDOWN_MS = 86_400_000

/** One pooled credential reference and its persisted health metadata. */
export interface PoolKeyConfig {
  /** Credential reference (environment-style name) resolved per request. */
  ref: string
  /** Disabled keys stay configured but are never selected. */
  enabled?: boolean
  /** Durable health metadata written back after classified failures. */
  health?: PersistedKeyHealth
}

/** Persisted health state for one key. */
export interface PersistedKeyHealth {
  cooldownUntil?: number
  quarantineReason?: string
  lastFailure?: { disposition?: string; code?: string; at?: number }
  lastSuccessAt?: number
}

/** One provider pool configuration. */
export interface PoolProviderConfig {
  /** Provider route id the pool serves (for example `deepseek-official`). */
  provider: string
  /** Pooled credential references, in configuration order. */
  keys: PoolKeyConfig[]
}

/** Key-pool plugin configuration, doubling as the settings-section shape. */
export interface Config {
  pools?: PoolProviderConfig[]
  /** Total provider attempts, including the initial attempt (default 3). */
  maxAttempts?: number
  /** Fallback cooldown for a rate-limited key without Retry-After (default 30 000 ms). */
  cooldownMs?: number
  /** Maximum simultaneous leases per key (default 4). */
  maxConcurrentPerKey?: number
}

const persistedHealth: z<PersistedKeyHealth> = z.object({
  cooldownUntil: z.number(),
  quarantineReason: z.string(),
  lastFailure: z.object({ disposition: z.string(), code: z.string(), at: z.number() }),
  lastSuccessAt: z.number(),
})

export const Config: z<Config> = z.object({
  pools: z.array(z.object({
    provider: z.string().required(),
    keys: z.array(z.object({
      ref: z.string().required(),
      enabled: z.boolean().default(true),
      // The union wrapper keeps an absent health member from instantiating
      // the object schema's implicit `{}` default.
      health: z.union([persistedHealth]),
    })).default([]),
  })).default([]),
  maxAttempts: z.number().step(1).min(1).max(8).default(DEFAULT_MAX_ATTEMPTS),
  cooldownMs: z.number().step(1).min(0).max(MAX_COOLDOWN_MS).default(DEFAULT_COOLDOWN_MS),
  maxConcurrentPerKey: z.number().step(1).min(1).max(64).default(DEFAULT_MAX_CONCURRENT_PER_KEY),
})

interface RuntimeConfig {
  pools: PoolProviderConfig[]
  maxAttempts: number
  cooldownMs: number
  maxConcurrentPerKey: number
}

function resolveConfig(config: Config): RuntimeConfig {
  const pools = config.pools ?? []
  const maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const cooldownMs = config.cooldownMs ?? DEFAULT_COOLDOWN_MS
  const maxConcurrentPerKey = config.maxConcurrentPerKey ?? DEFAULT_MAX_CONCURRENT_PER_KEY
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new Error('key-pool maxAttempts must be a positive integer')
  if (!Number.isSafeInteger(cooldownMs) || cooldownMs < 0) throw new Error('key-pool cooldownMs must be a non-negative integer')
  if (!Number.isSafeInteger(maxConcurrentPerKey) || maxConcurrentPerKey < 1) throw new Error('key-pool maxConcurrentPerKey must be a positive integer')
  if (pools.length > MAX_POOLS) throw new Error(`key-pool supports at most ${MAX_POOLS} pools`)
  for (const pool of pools) {
    if (pool.provider.length === 0) throw new Error('key-pool provider must be non-empty')
    if (pool.keys.length > MAX_KEYS_PER_POOL) throw new Error(`key-pool supports at most ${MAX_KEYS_PER_POOL} keys per pool`)
    const refs = new Set<string>()
    for (const key of pool.keys) {
      if (key.ref.length === 0) throw new Error(`key-pool pool '${pool.provider}' has a key with an empty reference`)
      if (refs.has(key.ref)) throw new Error(`key-pool pool '${pool.provider}' declares reference '${key.ref}' twice`)
      refs.add(key.ref)
      credentialRef(key.ref)
    }
  }
  return { pools, maxAttempts, cooldownMs, maxConcurrentPerKey }
}

export function apply(ctx: Context, config: Config): void {
  let current = resolveConfig(config)

  // Composition order matters: the broker reads the store snapshot at
  // construction, so the services exist before the first membership sync
  // republishes the populated pool into the broker's redacted snapshot.
  const store = new KeyPoolStore(ctx, {
    onHealthChange: (provider, reference, health) => persistHealth(ctx, provider, String(reference), health),
  })
  const broker = new KeyPoolBroker(ctx)
  new KeyPoolHealth(ctx, () => current.cooldownMs)
  const face = new KeyPool(
    ctx,
    () => ({ pools: current.pools.map(pool => ({ provider: pool.provider, refs: pool.keys.map(key => key.ref) })), maxAttempts: current.maxAttempts }),
    () => store.getSnapshot(),
  )
  syncMembership(current)

  /** Rebuild pool membership from configuration; surviving records keep their health. */
  function syncMembership(runtime: RuntimeConfig): void {
    void store.applySync((snapshot) => {
      const credentials = runtime.pools.flatMap(pool => pool.keys.map((key) => {
        const id = credentialId(`${pool.provider}:${key.ref}`)
        const existing = snapshot.credentials.find(candidate => candidate.id === id)
        const base = {
          id,
          pool: poolId(pool.provider),
          reference: credentialRef(key.ref),
          authKind: 'api-key' as const,
          priority: 0,
          maxConcurrent: runtime.maxConcurrentPerKey,
          enabled: key.enabled ?? true,
        }
        // Configuration owns membership and limits; the broker owns health.
        return existing === undefined
          ? { ...base, health: persistedToHealth(key.health), generation: 0 }
          : { ...existing, ...base, health: existing.health, generation: existing.generation }
      }))
      return {
        version: FORMAT_VERSION,
        generation: snapshot.generation,
        pools: runtime.pools.map(pool => ({ id: poolId(pool.provider), provider: pool.provider })),
        credentials,
      }
    })
    broker.republishSnapshot()
    face.emitChange()
  }

  installSettingsSection(ctx, KEY_POOL_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = resolveConfig(source())
      syncMembership(current)
    },
    onChange: () => {},
    validate: (value) => { resolveConfig(value) },
  })

  const tools = ctx.get('tools')
  const systemPrompt = ctx.get('systemPrompt')
  if (tools !== undefined && systemPrompt !== undefined) {
    systemPrompt.section({
      name: 'tool:key_pool_status',
      order: 112,
      text: 'Use key_pool_status to inspect API key pool health without exposing secrets.',
    })
    tools.register(defineTool({
      name: 'key_pool_status',
      description: 'Inspect configured API key pools, eligible keys, cooldowns, and redacted error status. Never returns API key values.',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { pools: { type: 'array', required: true } } },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      execute: () => Promise.resolve({ pools: face.status() }),
    }))
  }

  ctx.effect(() => () => { store.close() }, 'key-pool: store teardown')
}

/** Durable health metadata from configuration, or the empty state. Incomplete
 * persisted failures fail loudly in the store's own validation at sync. */
function persistedToHealth(persisted: PersistedKeyHealth | undefined): CredentialHealthState {
  if (persisted === undefined) return { excludedModels: [] }
  const lastFailure = persisted.lastFailure === undefined || persisted.lastFailure.disposition === undefined
    ? undefined
    : {
      disposition: persisted.lastFailure.disposition as CredentialFailureSummary['disposition'],
      code: persisted.lastFailure.code ?? '',
      at: persisted.lastFailure.at ?? 0,
    }
  return {
    excludedModels: [],
    ...persisted.cooldownUntil === undefined ? {} : { cooldownUntil: persisted.cooldownUntil },
    ...persisted.quarantineReason === undefined ? {} : { quarantineReason: persisted.quarantineReason },
    ...lastFailure === undefined ? {} : { lastFailure },
    ...persisted.lastSuccessAt === undefined ? {} : { lastSuccessAt: persisted.lastSuccessAt },
  }
}

/** Serialize health writes so concurrent completions cannot clobber the settings document. */
const healthWrites = new WeakMap<object, Promise<void>>()

async function persistHealth(ctx: Context, provider: string, reference: string, health: CredentialHealthState): Promise<void> {
  const settings = ctx.get('settings')
  if (settings === undefined) return
  const owner = settings as unknown as object
  const previous = healthWrites.get(owner) ?? Promise.resolve()
  const next = previous.then(async () => {
    const document = settings.get(KEY_POOL_SETTINGS_NAMESPACE) as Config | undefined
    if (document?.pools === undefined) return
    const pools = document.pools.map(pool => pool.provider !== provider ? pool : {
      ...pool,
      keys: pool.keys.map(key => key.ref !== reference ? key : { ...key, health: healthFromState(health) }),
    })
    await settings.update(KEY_POOL_SETTINGS_NAMESPACE, { pools })
  })
  healthWrites.set(owner, next)
  await next
  if (healthWrites.get(owner) === next) healthWrites.delete(owner)
}

function healthFromState(state: CredentialHealthState): PersistedKeyHealth {
  return {
    ...state.cooldownUntil === undefined ? {} : { cooldownUntil: state.cooldownUntil },
    ...state.quarantineReason === undefined ? {} : { quarantineReason: state.quarantineReason },
    ...state.lastFailure === undefined ? {} : { lastFailure: state.lastFailure },
    ...state.lastSuccessAt === undefined ? {} : { lastSuccessAt: state.lastSuccessAt },
  }
}

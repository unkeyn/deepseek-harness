import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'

/** Settings namespace edited by the custom web search pool card. */
export const WEB_SEARCH_POOL_NS = 'web-search-pool'

/** Supported provider templates exposed by the settings UI. */
export type ProviderPreset = 'firecrawl' | 'brave' | 'exa'

/** Where the provider's account state is read for the UI key check. */
export interface PoolCheck {
  endpoint: string
  method?: 'GET' | 'POST'
  usagePath?: string
  limitPath?: string
  remainingPath?: string
}

interface ProviderPresetConfig {
  name: string
  endpoint: string
  method: PoolProvider['method']
  queryParam: string
  requestBody: 'query' | 'exa'
  authMode: PoolProvider['authMode']
  authName: string
  responseResultsPath: string
  resultUrlPath: string
  resultTitlePath: string
  resultSnippetPath: string
  resultDatePath: string
  check?: PoolCheck
}

const PROVIDER_PRESETS: Record<ProviderPreset, ProviderPresetConfig> = {
  firecrawl: {
    name: 'Firecrawl', endpoint: 'https://api.firecrawl.dev/v2/search', method: 'POST', queryParam: 'query',
    authMode: 'bearer', authName: 'authorization', requestBody: 'query', responseResultsPath: 'data.web', resultUrlPath: 'url',
    resultTitlePath: 'title', resultSnippetPath: 'description', resultDatePath: 'publishedAt',
    check: { endpoint: 'https://api.firecrawl.dev/v2/team/credit-usage', remainingPath: 'data.remainingCredits', limitPath: 'data.planCredits' },
  },
  brave: {
    name: 'Brave Search', endpoint: 'https://api.search.brave.com/res/v1/web/search', method: 'GET', queryParam: 'q',
    authMode: 'header', authName: 'x-subscription-token', requestBody: 'query', responseResultsPath: 'web.results', resultUrlPath: 'url',
    resultTitlePath: 'title', resultSnippetPath: 'description', resultDatePath: 'age',
  },
  exa: {
    name: 'Exa', endpoint: 'https://api.exa.ai/search', method: 'POST', queryParam: 'query',
    authMode: 'header', authName: 'x-api-key', requestBody: 'exa', responseResultsPath: 'results', resultUrlPath: 'url',
    resultTitlePath: 'title', resultSnippetPath: 'highlights.0', resultDatePath: 'publishedDate',
  },
}

/** Redacted credential metadata and persisted health state. */
export interface PoolKey {
  id: string
  ref: string
  enabled: boolean
  priority: number
  maxConcurrent: number
  cooldownUntil?: number
  quarantineUntil?: number
  lastError?: string
  lastStatus?: number
}
/** One configured provider and its non-secret key metadata. */
export interface PoolProvider {
  id: string
  name: string
  priority: number
  endpoint: string
  method: 'GET' | 'POST'
  queryParam: string
  requestBody?: 'query' | 'exa'
  authMode: 'header' | 'bearer' | 'query'
  authName: string
  responseResultsPath: string
  resultUrlPath: string
  resultTitlePath: string
  resultSnippetPath: string
  resultDatePath: string
  keys: PoolKey[]
  enabled: boolean
  /** Account endpoint the Host's key check reads; absent falls back to a minimal query ping. */
  check?: PoolCheck
}
/** Settings section stored by the Host plugin. */
export interface PoolSettings { providers?: PoolProvider[]; maxAttempts?: number; cooldownMs?: number }
/** Redacted outcome of one key check the Host answered. */
export interface PoolKeyCheckState {
  valid: boolean
  status?: number
  remaining?: number
  limit?: number
  error?: string
}
/** Browser-only write draft for one key. */
export interface PoolDraftKey extends PoolKey { secret: string; originalRef: string; configured: boolean; check?: PoolKeyCheckState }
/** Browser-only provider draft with write-only key fields. */
export interface PoolDraftProvider extends Omit<PoolProvider, 'keys'> { keys: PoolDraftKey[] }
/** Reactive redacted state rendered by the pool card. */
export interface PoolCardState {
  available: boolean
  writable: boolean
  dirty: boolean
  saving: boolean
  failed: boolean
  error: string | null
  invalid: boolean
  providers: PoolDraftProvider[]
  availablePresets: ProviderPreset[]
  maxAttempts: string
  cooldownMs: string
  /** Provider id whose keys are being checked right now, when one is. */
  checking: string | null
}
/** Injected data and actions supplied to the pool card registration. */
export interface PoolCardFace {
  hooks: { webSearchPool: SnapshotStore<PoolCardState> }
  addProvider: (preset: ProviderPreset) => void
  removeProvider: (id: string) => void
  addKey: (providerId: string) => void
  removeKey: (providerId: string, keyId: string) => void
  editKey: (providerId: string, keyId: string, value: string) => void
  editGlobal: (field: 'maxAttempts' | 'cooldownMs', value: string) => void
  check: (providerId: string) => void
  save: () => void
  discard: () => void
  refresh: () => void
  refreshCredential: (ref: string) => void
}

type Draft = { providers: PoolDraftProvider[]; maxAttempts: string; cooldownMs: string }
type PoolRpc = Pick<ConnectionHandle, 'rpc'>['rpc']
type PoolCredentials = Pick<ClientRemote['credentials'], 'describe' | 'set' | 'unset'>

/** Owns editable provider drafts and write-only credential operations. */
export class WebSearchPoolCardController {
  private readonly store: SnapshotStore<PoolCardState>
  private readonly rpc: PoolRpc
  private draft: Draft = { providers: [], maxAttempts: '3', cooldownMs: '30000' }
  private removedRefs: string[] = []
  private disposed = false
  private dirty = false
  private saving = false
  private checking: string | null = null
  private error: string | null = null
  /** Set only by a refused save; a check failure is `error`, not this. */
  private failed = false
  /** Per-provider timestamp of the last silent credit refresh (throttle). */
  private readonly autoCheckedAt = new Map<string, number>()

  constructor(
    private readonly scope: SettingsScope<PoolSettings>,
    private readonly credentials: PoolCredentials,
    rpc: PoolRpc,
  ) {
    this.rpc = rpc
    this.store = createSnapshotStore(this.state())
    scope.subscribe(() => this.reloadFromScope())
    this.reloadFromScope()
  }

  /** Build the plain data and action face consumed by the pool card.
   * @returns the slot injection face.
   */
  inject(): PoolCardFace {
    return {
      hooks: { webSearchPool: this.store },
      addProvider: preset => this.addProvider(preset),
      removeProvider: id => this.removeProvider(id),
      addKey: id => this.addKey(id),
      removeKey: (providerId, keyId) => this.removeKey(providerId, keyId),
      editKey: (providerId, keyId, value) => this.editKey(providerId, keyId, value),
      editGlobal: (field, value) => this.editGlobal(field, value),
      check: providerId => { void this.check(providerId) },
      save: () => { void this.save() },
      discard: () => this.discard(),
      refresh: () => this.reloadFromScope(),
      refreshCredential: ref => { void this.refreshCredential(ref) },
    }
  }

  /** Stop publishing snapshots after the owning Cordis fiber disposes. */
  dispose(): void {
    this.disposed = true
  }

  private addProvider(preset: ProviderPreset): void {
    if (this.draft.providers.some(provider => provider.id === preset)) return
    const template = PROVIDER_PRESETS[preset]
    const keyId = uniqueId(`${preset}-key`, [])
    const keyRef = credentialRefFor(preset, 1)
    const provider: PoolDraftProvider = {
      id: preset,
      name: template.name,
      priority: 0,
      endpoint: template.endpoint,
      method: template.method,
      queryParam: template.queryParam,
      requestBody: template.requestBody,
      authMode: template.authMode,
      authName: template.authName,
      responseResultsPath: template.responseResultsPath,
      resultUrlPath: template.resultUrlPath,
      resultTitlePath: template.resultTitlePath,
      resultSnippetPath: template.resultSnippetPath,
      resultDatePath: template.resultDatePath,
      ...template.check === undefined ? {} : { check: template.check },
      keys: [{ id: keyId, ref: keyRef, enabled: true, priority: 0, maxConcurrent: 1, secret: '', originalRef: keyRef, configured: false }],
      enabled: true,
    }
    this.draft.providers.push(provider)
    this.markDirty()
    void this.refreshCredential(keyRef)
  }

  private removeProvider(id: string): void {
    const provider = this.draft.providers.find(candidate => candidate.id === id)
    if (provider === undefined) return
    this.removedRefs.push(...provider.keys.map(key => key.ref))
    this.draft.providers = this.draft.providers.filter(candidate => candidate.id !== id)
    if (this.checking === id) this.checking = null
    this.markDirty()
  }

  private addKey(providerId: string): void {
    const provider = this.draft.providers.find(candidate => candidate.id === providerId)
    if (provider === undefined) return
    const index = provider.keys.length + 1
    const id = uniqueId(`${provider.id}-key`, provider.keys.map(key => key.id))
    const ref = credentialRefFor(providerId, index)
    provider.keys.push({ id, ref, enabled: true, priority: 0, maxConcurrent: 1, secret: '', originalRef: ref, configured: false })
    this.markDirty()
    void this.refreshCredential(ref)
  }

  private removeKey(providerId: string, keyId: string): void {
    const provider = this.draft.providers.find(candidate => candidate.id === providerId)
    const key = provider?.keys.find(candidate => candidate.id === keyId)
    if (key === undefined) return
    this.removedRefs.push(key.ref)
    provider!.keys = provider!.keys.filter(candidate => candidate.id !== keyId)
    this.markDirty()
  }

  private editKey(providerId: string, keyId: string, value: string): void {
    const key = this.draft.providers.find(provider => provider.id === providerId)?.keys.find(candidate => candidate.id === keyId)
    if (key === undefined) return
    key.secret = value
    this.markDirty()
  }

  private editGlobal(field: 'maxAttempts' | 'cooldownMs', value: string): void {
    this.draft[field] = value
    this.markDirty()
  }

  /**
   * Check one provider's saved keys through the Host. The Host reads its own
   * live config, so unsaved draft edits are invisible to it — the card gates
   * the action on a clean draft instead of checking stale keys.
   */
  private async check(providerId: string): Promise<void> {
    if (this.checking !== null || this.dirty || this.saving || !this.scope.getSnapshot().writable) return
    this.checking = providerId
    this.error = null
    this.publish()
    try {
      const result = await this.rpc.call('/web-search-pool', 'webSearchPool.check', { providerId })
      if (!result.ok) {
        this.error = result.error.message
        return
      }
      const checked = readCheckResults(result.value)
      if (checked === undefined) {
        this.error = 'the key check returned an unreadable answer'
        return
      }
      for (const provider of this.draft.providers) {
        if (provider.id !== providerId) continue
        for (const key of provider.keys) {
          const state = checked.get(key.id)
          if (state !== undefined) key.check = state
        }
      }
    } catch (cause: unknown) {
      this.error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      this.checking = null
      this.publish()
    }
  }

  private async save(): Promise<void> {
    if (!this.dirty || this.saving || !this.scope.getSnapshot().writable) return
    this.saving = true
    this.failed = false
    this.error = null
    this.publish()
    try {
      for (const ref of this.removedRefs) await this.credentials.unset(ref)
      for (const provider of this.draft.providers) {
        for (const key of provider.keys) {
          if (key.secret.length > 0) await this.credentials.set(key.ref, key.secret)
          if (key.ref !== key.originalRef) {
            if (key.secret.length === 0) throw new Error(`enter a new secret for ${key.id} after changing its reference`)
            await this.credentials.unset(key.originalRef)
          }
        }
      }
      await this.scope.set('providers', this.draft.providers.map(provider => ({
        ...provider,
        keys: provider.keys.map(({ secret, originalRef, check, configured, ...key }) => key),
      })))
      await this.scope.set('maxAttempts', toPositive(this.draft.maxAttempts, 'max attempts'))
      await this.scope.set('cooldownMs', toNonNegative(this.draft.cooldownMs, 'cooldown'))
      this.removedRefs = []
      this.dirty = false
      this.reloadFromScope()
    } catch (cause: unknown) {
      this.failed = true
      this.error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      this.saving = false
      this.publish()
    }
  }

  private discard(): void {
    this.removedRefs = []
    this.dirty = false
    this.failed = false
    this.error = null
    this.reloadFromScope()
  }

  private reloadFromScope(): void {
    if (this.disposed || this.dirty) return
    const value = this.scope.getSnapshot().value
    let completedCheck = false
    this.draft = {
      providers: (value?.providers ?? []).map(provider => {
        const next = {
          ...provider,
          requestBody: provider.requestBody ?? 'query',
          keys: provider.keys.map(key => ({ ...key, secret: '', originalRef: key.ref, configured: false })),
        }
        // A provider saved by an older preset lacks the check spec its preset
        // now carries; completing it here is what turns the key badge into
        // credit numbers without re-adding the provider.
        if (!hasUsableCheck(next.check) && next.id in PROVIDER_PRESETS) {
          const preset = PROVIDER_PRESETS[next.id as ProviderPreset]
          if (preset?.check !== undefined) {
            next.check = preset.check
            completedCheck = true
          }
        }
        return next
      }),
      maxAttempts: String(value?.maxAttempts ?? 3),
      cooldownMs: String(value?.cooldownMs ?? 30000),
    }
    this.publish()
    void this.refreshCredentialStatus()
    if (completedCheck) void this.persistCheckCompletion()
    else this.autoCheckCredits()
  }

  /**
   * Persist a check spec this controller completed for a preset provider, then
   * refresh credits — the Host reads its live config, so the completed spec
   * must land before the account endpoints are asked.
   */
  private async persistCheckCompletion(): Promise<void> {
    if (this.disposed || this.dirty || this.saving || !this.scope.getSnapshot().writable) return
    try {
      await this.scope.set('providers', this.draft.providers.map(provider => ({
        ...provider,
        keys: provider.keys.map(({ secret, originalRef, check, configured, ...key }) => key),
      })))
    } catch { /* the completion retries on the next reload; never disturb the draft */ }
    this.autoCheckCredits()
  }

  /**
   * Silently refresh credit numbers for providers that publish an account
   * endpoint — the free check path. Providers without one cost a search per
   * key, so their validity waits for the explicit Check keys button.
   */
  private autoCheckCredits(): void {
    if (this.disposed || this.dirty || this.saving || !this.scope.getSnapshot().writable) return
    const now = Date.now()
    for (const provider of this.draft.providers) {
      if (!hasUsableCheck(provider.check)) continue
      if (now - (this.autoCheckedAt.get(provider.id) ?? 0) < 60_000) continue
      this.autoCheckedAt.set(provider.id, now)
      void this.check(provider.id)
    }
  }

  async refreshCredential(ref: string): Promise<void> {
    if (this.disposed || !this.draft.providers.some(provider => provider.keys.some(key => key.ref === ref))) return
    try {
      const response = await this.credentials.describe([ref])
      if (!response.ok || this.disposed) return
      const configured = response.value[ref]?.configured ?? false
      for (const provider of this.draft.providers) {
        for (const key of provider.keys) {
          if (key.ref === ref) key.configured = configured
        }
      }
      this.publish()
    } catch { /* a failed badge refresh must not disturb the editable draft */ }
  }

  private async refreshCredentialStatus(): Promise<void> {
    const refs = this.draft.providers.flatMap(provider => provider.keys.map(key => key.ref))
    if (refs.length === 0) return
    try {
      const response = await this.credentials.describe(refs)
      if (!response.ok || this.disposed || this.dirty) return
      for (const provider of this.draft.providers) {
        for (const key of provider.keys) key.configured = response.value[key.ref]?.configured ?? false
      }
      this.publish()
    } catch { /* unavailable credential status leaves the write-only field usable */ }
  }
  private markDirty(): void {
    this.dirty = true
    this.failed = false
    this.error = null
    this.publish()
  }

  private state(): PoolCardState {
    const remote = this.scope.getSnapshot()
    return {
      available: remote.status === 'ready', writable: remote.writable, dirty: this.dirty,
      saving: this.saving, failed: this.failed, error: this.error,
      invalid: this.draft.providers.some(provider => provider.name.length === 0 || provider.endpoint.length === 0 || provider.responseResultsPath.length === 0),
      availablePresets: (Object.keys(PROVIDER_PRESETS) as ProviderPreset[]).filter(preset => !this.draft.providers.some(provider => provider.id === preset)),
      // The store deep-freezes published snapshots outside production; the
      // editable draft must keep its own mutable copies.
      providers: this.draft.providers.map(provider => ({ ...provider, keys: provider.keys.map(key => ({ ...key })) })),
      maxAttempts: this.draft.maxAttempts, cooldownMs: this.draft.cooldownMs,
      checking: this.checking,
    }
  }

  private publish(): void {
    if (!this.disposed) this.store.set(this.state())
  }
}

/** Whether one check spec carries an endpoint the Host could actually ask. */
function hasUsableCheck(check: PoolCheck | undefined): boolean {
  return typeof check?.endpoint === 'string' && check.endpoint.length > 0
}

/** Read one check answer into a keyId → state map, or undefined when unreadable. */
function readCheckResults(value: unknown): Map<string, PoolKeyCheckState> | undefined {  if (typeof value !== 'object' || value === null) return undefined
  const keys = (value as { keys?: unknown }).keys
  if (!Array.isArray(keys)) return undefined
  const map = new Map<string, PoolKeyCheckState>()
  for (const entry of keys) {
    if (typeof entry !== 'object' || entry === null) return undefined
    const record = entry as Record<string, unknown>
    if (typeof record['keyId'] !== 'string' || typeof record['valid'] !== 'boolean') return undefined
    const state: PoolKeyCheckState = { valid: record['valid'] }
    if (typeof record['status'] === 'number') state.status = record['status']
    if (typeof record['remaining'] === 'number') state.remaining = record['remaining']
    if (typeof record['limit'] === 'number') state.limit = record['limit']
    if (typeof record['error'] === 'string') state.error = record['error']
    map.set(record['keyId'], state)
  }
  return map
}

function uniqueId(prefix: string, used: readonly string[]): string {
  let index = 1
  while (used.includes(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}
function credentialRefFor(providerId: string, index: number): string {
  const base = providerId === 'firecrawl' ? 'FIRECRAWL_API_KEY' : providerId === 'brave' ? 'BRAVE_API_KEY' : 'EXA_API_KEY'
  return index <= 1 ? base : `${base}_${index}`
}
function toPositive(text: string, label: string): number { const value = Number(text); if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`); return value }
function toNonNegative(text: string, label: string): number { const value = Number(text); if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`); return value }

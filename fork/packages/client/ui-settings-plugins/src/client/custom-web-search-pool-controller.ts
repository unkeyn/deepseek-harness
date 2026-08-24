import type { IApiClient } from '@deepseek-ai/dsh-client-connection/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Settings namespace edited by the custom web search pool card. */
export const WEB_SEARCH_POOL_NS = 'web-search-pool'

/** Supported provider templates exposed by the settings UI. */
export type ProviderPreset = 'firecrawl' | 'brave' | 'exa'

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
}

const PROVIDER_PRESETS: Record<ProviderPreset, ProviderPresetConfig> = {
  firecrawl: {
    name: 'Firecrawl', endpoint: 'https://api.firecrawl.ai/v1/search', method: 'GET', queryParam: 'query',
    authMode: 'header', authName: 'x-api-key', requestBody: 'query', responseResultsPath: 'results', resultUrlPath: 'url',
    resultTitlePath: 'title', resultSnippetPath: 'description', resultDatePath: 'publishedAt',
  },
  brave: {
    name: 'Brave Search', endpoint: 'https://api.search.brave.com/research/v1/web/search', method: 'GET', queryParam: 'q',
    authMode: 'header', authName: 'x-api-key', requestBody: 'query', responseResultsPath: 'results', resultUrlPath: 'url',
    resultTitlePath: 'title', resultSnippetPath: 'description', resultDatePath: 'age',
  },
  exa: {
    name: 'Exa', endpoint: 'https://api.exa.ai/search', method: 'POST', queryParam: 'query',
    authMode: 'bearer', authName: 'authorization', requestBody: 'exa', responseResultsPath: 'results', resultUrlPath: 'url',
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
}
/** Settings section stored by the Host plugin. */
export interface PoolSettings { providers?: PoolProvider[]; maxAttempts?: number; cooldownMs?: number }
/** Browser-only write draft for one key. */
export interface PoolDraftKey extends PoolKey { secret: string; originalRef: string; configured: boolean }
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
}
/** Injected data and actions supplied to the pool card registration. */
export interface PoolCardFace {
  hooks: { webSearchPool: SnapshotStore<PoolCardState> }
  addProvider: (preset: ProviderPreset) => void
  removeProvider: (id: string) => void
  addKey: (providerId: string) => void
  removeKey: (providerId: string, keyId: string) => void
  editProvider: (providerId: string, field: string, value: string) => void
  editKey: (providerId: string, keyId: string, field: string, value: string) => void
  editGlobal: (field: 'maxAttempts' | 'cooldownMs', value: string) => void
  save: () => void
  discard: () => void
  refresh: () => void
  refreshCredential: (ref: string) => void
}

type Draft = { providers: PoolDraftProvider[]; maxAttempts: string; cooldownMs: string }

/** Owns editable provider drafts and write-only credential operations. */
export class WebSearchPoolCardController {
  private readonly store: SnapshotStore<PoolCardState>
  private draft: Draft = { providers: [], maxAttempts: '3', cooldownMs: '30000' }
  private removedRefs: string[] = []
  private disposed = false
  private dirty = false
  private saving = false
  private error: string | null = null

  constructor(
    private readonly scope: SettingsScope<PoolSettings>,
    private readonly api: Pick<IApiClient, 'credentials'>,
  ) {
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
      editProvider: (providerId, field, value) => this.editProvider(providerId, field, value),
      editKey: (providerId, keyId, field, value) => this.editKey(providerId, keyId, field, value),
      editGlobal: (field, value) => this.editGlobal(field, value),
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

  private editProvider(providerId: string, field: string, value: string): void {
    const provider = this.draft.providers.find(candidate => candidate.id === providerId)
    if (provider === undefined || !(field in provider)) return
    const current = provider as unknown as Record<string, unknown>
    if (field === 'priority') current[field] = Number(value) || 0
    else if (field === 'enabled') current[field] = value === 'true'
    else current[field] = value
    this.markDirty()
  }

  private editKey(providerId: string, keyId: string, field: string, value: string): void {
    const key = this.draft.providers.find(provider => provider.id === providerId)?.keys.find(candidate => candidate.id === keyId)
    if (key === undefined) return
    if (field === 'value') key.secret = value
    else if (field === 'priority') key.priority = Number(value) || 0
    else if (field === 'maxConcurrent') key.maxConcurrent = Number(value) || 1
    else if (field === 'enabled') key.enabled = value === 'true'
    else if (field === 'ref') key.ref = value
    this.markDirty()
  }

  private editGlobal(field: 'maxAttempts' | 'cooldownMs', value: string): void {
    this.draft[field] = value
    this.markDirty()
  }

  private async save(): Promise<void> {
    if (!this.dirty || this.saving || !this.scope.getSnapshot().writable) return
    this.saving = true
    this.error = null
    this.publish()
    try {
      for (const ref of this.removedRefs) await this.api.credentials.unset({ ref })
      for (const provider of this.draft.providers) {
        for (const key of provider.keys) {
          if (key.secret.length > 0) await this.api.credentials.set({ ref: key.ref, value: key.secret })
          if (key.ref !== key.originalRef) {
            if (key.secret.length === 0) throw new Error(`enter a new secret for ${key.id} after changing its reference`)
            await this.api.credentials.unset({ ref: key.originalRef })
          }
        }
      }
      await this.scope.set('providers', this.draft.providers.map(provider => ({
        ...provider,
        keys: provider.keys.map(({ secret, originalRef, ...key }) => key),
      })))
      await this.scope.set('maxAttempts', toPositive(this.draft.maxAttempts, 'max attempts'))
      await this.scope.set('cooldownMs', toNonNegative(this.draft.cooldownMs, 'cooldown'))
      this.removedRefs = []
      this.dirty = false
      this.reloadFromScope()
    } catch (cause: unknown) {
      this.error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      this.saving = false
      this.publish()
    }
  }

  private discard(): void {
    this.removedRefs = []
    this.dirty = false
    this.error = null
    this.reloadFromScope()
  }

  private reloadFromScope(): void {
    if (this.disposed || this.dirty) return
    const value = this.scope.getSnapshot().value
    this.draft = {
      providers: (value?.providers ?? []).map(provider => ({
        ...provider,
        requestBody: provider.requestBody ?? 'query',
        keys: provider.keys.map(key => ({ ...key, secret: '', originalRef: key.ref, configured: false })),
      })),
      maxAttempts: String(value?.maxAttempts ?? 3),
      cooldownMs: String(value?.cooldownMs ?? 30000),
    }
    this.publish()
    void this.refreshCredentialStatus()
  }

  private async refreshCredential(ref: string): Promise<void> {
    if (this.disposed || !this.draft.providers.some(provider => provider.keys.some(key => key.ref === ref))) return
    try {
      const response = await this.api.credentials.describe({ refs: [ref] })
      if (!response.result.ok || this.disposed) return
      const configured = response.result.value.credentials[ref]?.configured ?? false
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
      const response = await this.api.credentials.describe({ refs })
      if (!response.result.ok || this.disposed || this.dirty) return
      for (const provider of this.draft.providers) {
        for (const key of provider.keys) key.configured = response.result.value.credentials[key.ref]?.configured ?? false
      }
      this.publish()
    } catch { /* unavailable credential status leaves the write-only field usable */ }
  }
  private markDirty(): void {
    this.dirty = true
    this.error = null
    this.publish()
  }

  private state(): PoolCardState {
    const remote = this.scope.getSnapshot()
    return {
      available: remote.status === 'ready', writable: remote.writable, dirty: this.dirty,
      saving: this.saving, failed: this.error !== null, error: this.error,
      invalid: this.draft.providers.some(provider => provider.name.length === 0 || provider.endpoint.length === 0 || provider.responseResultsPath.length === 0),
      availablePresets: (Object.keys(PROVIDER_PRESETS) as ProviderPreset[]).filter(preset => !this.draft.providers.some(provider => provider.id === preset)),
      providers: this.draft.providers, maxAttempts: this.draft.maxAttempts, cooldownMs: this.draft.cooldownMs,
    }
  }

  private publish(): void {
    if (!this.disposed) this.store.set(this.state())
  }
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

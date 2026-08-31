/**
 * Browser half of the API-key check: parse a page of pasted lines, ask the
 * Host which keys a provider accepts, and remember what was pasted.
 *
 * The Host owns the question and the answer's evidence — this side never
 * learns a provider's address, and it never sends a key it wants back. What it
 * does hold is the key itself, in plain text, because that is the point of the
 * surface: the user pastes a batch, reads off which ones work, and expects the
 * list to still be there when the panel is closed and reopened. That cache is
 * `localStorage` under this package's own key, written in plain text and read
 * back in plain text — nothing here redacts, and nothing here should.
 *
 * @module @deepseek-ai/dsh-fork-client-ui-key-check/key-check-controller
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** The Connection channel the Host's key check serves. */
const CHANNEL = '/llm-key-check'
/** Endpoint answering with the providers this host can probe. */
const PROVIDERS_ENDPOINT = 'llmKeyCheck.providers'
/** Endpoint answering with one verdict per pasted key. */
const CHECK_ENDPOINT = 'llmKeyCheck.check'

/** `localStorage` key holding the panel's cache: the pasted text and the last verdicts. */
export const STORAGE_KEY = 'dsh.fork.keycheck.v1'
/** Version tag stored alongside the cache, so a future shape change can discard one. */
const STORAGE_VERSION = 1

/** One provider this host can probe. */
export interface KeyCheckProvider {
  /** Provider route id — the only spelling a pasted line may use. */
  provider: string
  /** Selector label. */
  displayName: string
}

/** One pasted line, resolved against the provider directory. */
export interface KeyCheckEntry {
  /** Stable row id within the panel. */
  id: string
  /** Provider route id, as pasted. */
  provider: string
  /** The key, held in plain text: this surface exists to show it. */
  apiKey: string
  /** Whether the provider directory knows this provider at all. */
  known: boolean
  /** Whether the provider accepted the key; only meaningful after a run. */
  valid: boolean
  /** HTTP status of the deciding probe, once one came back. */
  status?: number
  /** Why the key was not accepted, when it was not. */
  error?: string
}

/** Reactive state rendered by the key-check panel. */
export interface KeyCheckState {
  /** Whether the two lists are expanded. */
  open: boolean
  /** The paste buffer, verbatim. */
  input: string
  /** The provider directory, once the Host has answered. */
  providers: readonly KeyCheckProvider[]
  /** Whether the directory has been fetched at least once. */
  ready: boolean
  /** Every pasted line, in paste order. */
  entries: readonly KeyCheckEntry[]
  /** Whether a check is in flight. */
  running: boolean
  /** One-line failure for the whole run, when there is one. */
  error: string | null
  /** When the last run finished. */
  checkedAt: number | null
}

/** Injected data and actions supplied to the panel registration. */
export interface KeyCheckFace {
  hooks: { keyCheck: SnapshotStore<KeyCheckState> }
  /** Toggle the panel; opening it loads the directory. */
  toggle: () => void
  /** Collapse the panel — the cache is already written. */
  hide: () => void
  /** Replace the paste buffer and re-parse it. */
  setInput: (text: string) => void
  /** Probe every known pasted key. */
  run: () => void
  /** Drop the paste buffer, the verdicts, and the cache. */
  clear: () => void
}

/** The cache as written to `localStorage`. */
interface KeyCheckCache {
  version: number
  input: string
  /** Last verdicts, so a reopened panel shows what worked before a re-run. */
  results: ReadonlyArray<{ provider: string; apiKey: string; valid: boolean }>
}

/** The storage surface this controller needs; a test supplies its own. */
export interface KeyCheckStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

type KeyCheckRpc = Pick<ConnectionHandle, 'rpc'>['rpc']

/** Split one pasted line into its provider and its key. */
export function parseLine(line: string): { provider: string; apiKey: string } | undefined {
  const trimmed = line.trim()
  if (trimmed.length === 0) return undefined
  // A tab is the format the page advertises; a space is the same paste after
  // a chat client has re-wrapped it, so both separate the two fields.
  const tab = trimmed.indexOf('\t')
  const splitAt = tab >= 0 ? tab : trimmed.search(/\s/)
  if (splitAt <= 0) return undefined
  const provider = trimmed.slice(0, splitAt).trim()
  const apiKey = trimmed.slice(splitAt + 1).trim()
  if (provider.length === 0 || apiKey.length === 0) return undefined
  return { provider, apiKey }
}

/** Read the whole paste buffer into entries, marking providers the directory does not know. */
export function parseInput(input: string, providers: readonly KeyCheckProvider[]): KeyCheckEntry[] {
  const known = new Set(providers.map(provider => provider.provider.toLowerCase()))
  return input.split('\n').flatMap((line, index) => {
    const parsed = parseLine(line)
    if (parsed === undefined) return []
    return [{
      id: `row-${index}`,
      provider: parsed.provider,
      apiKey: parsed.apiKey,
      known: known.has(parsed.provider.toLowerCase()),
      valid: false,
    }]
  })
}

/** Owns the paste buffer, the provider directory, and the verdicts. */
export class KeyCheckController {
  private readonly store: SnapshotStore<KeyCheckState>
  private readonly rpc: KeyCheckRpc
  private readonly storage: KeyCheckStorage | undefined
  private disposed = false
  private open = false
  private input = ''
  private providers: readonly KeyCheckProvider[] = []
  private ready = false
  private entries: readonly KeyCheckEntry[] = []
  private running = false
  private error: string | null = null
  private checkedAt: number | null = null

  constructor(rpc: KeyCheckRpc, storage?: KeyCheckStorage) {
    this.rpc = rpc
    this.storage = storage ?? safeLocalStorage()
    const cached = this.readCache()
    if (cached !== undefined) {
      this.input = cached.input
      // The directory has not arrived yet, so a restored line cannot be
      // marked known or unknown here; the parse runs again once it does.
      this.entries = cached.results.map((result, index) => ({
        id: `row-${index}`,
        provider: result.provider,
        apiKey: result.apiKey,
        known: true,
        valid: result.valid,
      }))
      this.checkedAt = 0
    }
    this.store = createSnapshotStore(this.state())
  }

  /** Build the plain data and action face consumed by the panel. */
  inject(): KeyCheckFace {
    return {
      hooks: { keyCheck: this.store },
      toggle: () => this.toggle(),
      hide: () => this.hide(),
      setInput: text => this.setInput(text),
      run: () => { void this.run() },
      clear: () => this.clear(),
    }
  }

  /** Stop publishing snapshots after the owning Cordis fiber disposes. */
  dispose(): void {
    this.disposed = true
  }

  /**
   * Expand or collapse the two lists.
   *
   * Opening is what fetches the directory — a closed panel asks for nothing,
   * so a user who never touches this surface never reaches the host.
   */
  private toggle(): void {
    if (this.open) {
      void this.run()
      return
    }
    this.open = true
    this.publish()
    void this.loadProviders()
  }

  /** Collapse the panel. The cache is written on every change, so hiding keeps it. */
  private hide(): void {
    this.open = false
    this.publish()
  }

  private setInput(text: string): void {
    this.input = text
    this.error = null
    this.entries = parseInput(text, this.providers)
    this.publish()
    this.writeCache()
  }

  private clear(): void {
    this.input = ''
    this.entries = []
    this.error = null
    this.checkedAt = null
    this.publish()
    try {
      this.storage?.removeItem(STORAGE_KEY)
    } catch {
      // A cache that cannot be dropped is not worth failing the interaction.
    }
  }

  /** Fetch the provider directory once per mount. */
  private async loadProviders(): Promise<void> {
    if (this.ready) return
    try {
      const result = await this.rpc.call(CHANNEL, PROVIDERS_ENDPOINT, {})
      if (this.disposed) return
      if (!result.ok) {
        // A host that answers a failure has answered: there is no directory
        // still to arrive, so staying on "pending" would be a lie the panel
        // tells forever. Say why the directory is empty instead.
        this.ready = true
        this.error = result.error.message
        this.publish()
        return
      }
      this.providers = readProviders(result.value) ?? []
      this.ready = true
      // Lines pasted before the directory arrived are re-resolved now: a
      // provider the host cannot probe is dropped from the run.
      this.entries = parseInput(this.input, this.providers)
      this.publish()
    } catch {
      // A host that cannot be reached leaves the panel usable with an empty
      // directory, which filters every line out rather than guessing at one.
      if (!this.disposed) {
        this.ready = true
        this.publish()
      }
    }
  }

  /**
   * Probe every pasted key the directory knows, and drop the rest.
   *
   * Unknown providers are filtered here as well as by the host: the host
   * refuses them too, but refusing locally is what lets the panel say
   * "not available here" without a round trip per line.
   */
  private async run(): Promise<void> {
    if (this.running || this.disposed) return
    const entries = parseInput(this.input, this.providers)
    this.entries = entries
    const targets = entries.filter(entry => entry.known)
    if (targets.length === 0) {
      this.error = this.input.trim().length === 0
        ? null
        : 'none of these providers are available here'
      this.publish()
      return
    }
    this.running = true
    this.error = null
    this.publish()
    try {
      const result = await this.rpc.call(CHANNEL, CHECK_ENDPOINT, {
        keys: targets.map(entry => ({ id: entry.id, provider: entry.provider, apiKey: entry.apiKey })),
      })
      if (this.disposed) return
      if (!result.ok) {
        this.error = result.error.message
        return
      }
      const outcomes = readOutcomes(result.value)
      if (outcomes === undefined) {
        this.error = 'the key check returned an unreadable answer'
        return
      }
      const byId = new Map(outcomes.map(outcome => [outcome.id, outcome]))
      for (const entry of entries) {
        const outcome = byId.get(entry.id)
        if (outcome === undefined) continue
        entry.valid = outcome.valid
        if (outcome.status !== undefined) entry.status = outcome.status
        if (outcome.error !== undefined) entry.error = outcome.error
      }
      this.checkedAt = Date.now()
    } catch (cause: unknown) {
      this.error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      this.running = false
      this.publish()
      this.writeCache()
    }
  }

  /** The entries worth remembering: what the user pasted and what worked. */
  private writeCache(): void {
    if (this.storage === undefined) return
    const cache: KeyCheckCache = {
      version: STORAGE_VERSION,
      input: this.input,
      results: this.entries.map(({ provider, apiKey, valid }) => ({ provider, apiKey, valid })),
    }
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(cache))
    } catch {
      // A full or unavailable store must not cost the paste buffer.
    }
  }

  private readCache(): KeyCheckCache | undefined {
    if (this.storage === undefined) return undefined
    let raw: string | null
    try {
      raw = this.storage.getItem(STORAGE_KEY)
    } catch {
      return undefined
    }
    if (raw === null) return undefined
    try {
      const parsed = JSON.parse(raw) as unknown
      if (typeof parsed !== 'object' || parsed === null) return undefined
      const record = parsed as { version?: unknown; input?: unknown; results?: unknown }
      if (record.version !== STORAGE_VERSION || typeof record.input !== 'string') return undefined
      const results = Array.isArray(record.results) ? record.results : []
      return {
        version: STORAGE_VERSION,
        input: record.input,
        results: results.flatMap(entry => {
          if (typeof entry !== 'object' || entry === null) return []
          const row = entry as { provider?: unknown; apiKey?: unknown; valid?: unknown }
          if (typeof row.provider !== 'string' || typeof row.apiKey !== 'string') return []
          return [{ provider: row.provider, apiKey: row.apiKey, valid: row.valid === true }]
        }),
      }
    } catch {
      return undefined
    }
  }

  private state(): KeyCheckState {
    return {
      open: this.open,
      input: this.input,
      providers: this.providers.map(provider => ({ ...provider })),
      ready: this.ready,
      // The store deep-freezes published snapshots outside production; the
      // run mutates entries in place, so the panel gets its own copies.
      entries: this.entries.map(entry => ({ ...entry })),
      running: this.running,
      error: this.error,
      checkedAt: this.checkedAt,
    }
  }

  private publish(): void {
    if (!this.disposed) this.store.set(this.state())
  }
}

/** Read one directory answer into a provider list. */
function readProviders(value: unknown): readonly KeyCheckProvider[] | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const providers = (value as { providers?: unknown }).providers
  if (!Array.isArray(providers)) return undefined
  const list: KeyCheckProvider[] = []
  for (const entry of providers) {
    if (typeof entry !== 'object' || entry === null) return undefined
    const record = entry as { provider?: unknown; displayName?: unknown }
    if (typeof record.provider !== 'string') return undefined
    list.push({ provider: record.provider, displayName: typeof record.displayName === 'string' ? record.displayName : record.provider })
  }
  return list
}

/** Read one check answer into the per-row verdicts. */
function readOutcomes(value: unknown): ReadonlyArray<{ id: string; valid: boolean; status?: number; error?: string }> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const outcomes = (value as { outcomes?: unknown }).outcomes
  if (!Array.isArray(outcomes)) return undefined
  const list: Array<{ id: string; valid: boolean; status?: number; error?: string }> = []
  for (const entry of outcomes) {
    if (typeof entry !== 'object' || entry === null) return undefined
    const record = entry as { id?: unknown; valid?: unknown; status?: unknown; error?: unknown }
    if (typeof record.id !== 'string' || typeof record.valid !== 'boolean') return undefined
    const outcome: { id: string; valid: boolean; status?: number; error?: string } = { id: record.id, valid: record.valid }
    if (typeof record.status === 'number') outcome.status = record.status
    if (typeof record.error === 'string') outcome.error = record.error
    list.push(outcome)
  }
  return list
}

/** The page's own `localStorage`, when the browser offers one. */
function safeLocalStorage(): KeyCheckStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

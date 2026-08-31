import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AuthorizationAttemptView,
  AuthorizationCancelValue,
  AuthorizationFlowView,
  AuthorizationStartValue,
} from '@deepseek-ai/dsh-fork-authorization-controller/types'
import type {
  OAuthAccountSnapshot,
  OAuthAccountView,
  UsageReport,
} from './types.ts'

/**
 * Partial view of the upstream authorization Remote bridge.
 *
 * The grid reuses the existing `list/start/state/answer/cancel` verbs
 * (`@deepseek-ai/dsh-fork-authorization-controller`) and adds two optional
 * sub-channel verbs that are only present when the host opts into
 * `@deepseek-ai/dsh-fork-client-ui-oauth-grid`. Hosts that don't expose the
 * new channel leave `accounts.list` / `accounts.remove` / `usage.fetch`
 * returning `null` and the UI gracefully degrades to a single-account view.
 */
export interface AuthorizationRemoteApi {
  list(): Promise<RemoteResult<readonly AuthorizationFlowView[]>>
  start(key: string, method?: string): Promise<RemoteResult<AuthorizationStartValue>>
  state(attemptId: string): Promise<RemoteResult<AuthorizationAttemptView | null>>
  answer(attemptId: string, value: string): Promise<RemoteResult<void>>
  cancel(attemptId: string): Promise<RemoteResult<AuthorizationCancelValue>>
}

export interface OAuthGridAccountsRemote {
  list(providerKey: string): Promise<RemoteResult<readonly OAuthAccountView[]>>
  remove(providerKey: string, accountId: string): Promise<RemoteResult<{ removed: boolean }>>
}

export interface OAuthGridUsageRemote {
  /**
   * Returns a fresh `UsageReport` for a single account; hosts lacking the
   * Antigravity- or Claude-style endpoint return `{ ok: false }` and the UI
   * shows the "no limits" hint instead of fabricating data.
   */
  fetch(providerKey: string, accountId: string): Promise<RemoteResult<UsageReport>>
}

export interface OAuthGridRemote {
  readonly authorization: AuthorizationRemoteApi
  readonly accounts?: OAuthGridAccountsRemote
  readonly usage?: OAuthGridUsageRemote
}

export interface OAuthGridCardState {
  readonly loaded: boolean
  readonly loading: boolean
  readonly flows: readonly AuthorizationFlowView[]
  readonly attempts: Readonly<Record<string, AuthorizationAttemptView>>
  readonly errors: Readonly<Record<string, string>>
  readonly accounts: OAuthAccountSnapshot
}

export interface OAuthGridCardFace {
  readonly useAuthorization: <T>(selector?: (state: OAuthGridCardState) => T) => T
  readonly start: (flow: AuthorizationFlowView, method: string) => void
  readonly answer: (attemptId: string, value: string) => void
  readonly cancel: (attemptId: string) => void
  readonly refreshAccounts: (providerKey: string) => Promise<void>
  readonly removeAccount: (providerKey: string, accountId: string) => Promise<void>
  readonly fetchLimits: (providerKey: string, accountId: string) => Promise<void>
}

interface ActiveAttempt {
  readonly key: string
  readonly attemptId: string
}

const REFRESH_DELAY_MS = 250

export class OAuthGridCardController {
  readonly store: SnapshotStore<OAuthGridCardState>
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly active = new Map<string, ActiveAttempt>()
  private disposed = false
  private stateValue: OAuthGridCardState = {
    loaded: false,
    loading: false,
    flows: [],
    attempts: {},
    errors: {},
    accounts: { loaded: false, accounts: [], errors: {}, reports: {} },
  }

  constructor(private readonly api: OAuthGridRemote) {
    this.store = createSnapshotStore(this.stateValue)
    void this.load()
  }

  async load(): Promise<void> {
    if (this.disposed) return
    this.setState({ loading: true })
    try {
      const response = await this.api.authorization.list()
      if (!response.ok) {
        this.setState({
          loaded: true,
          loading: false,
          flows: [],
          errors: { list: formatError(response.error) },
        })
        return
      }
      this.setState({ loaded: true, loading: false, flows: response.value, errors: {} })
    } catch (error) {
      this.setState({ loaded: true, loading: false, flows: [], errors: { list: errorMessage(error) } })
    }
  }

  start(flow: AuthorizationFlowView, method: string): void {
    if (this.disposed || this.active.has(flow.key)) return
    void this.startAsync(flow, method)
  }

  answer(attemptId: string, value: string): void {
    if (this.disposed) return
    void this.answerAsync(attemptId, value)
  }

  cancel(attemptId: string): void {
    if (this.disposed) return
    void this.cancelAsync(attemptId)
  }

  async refreshAccounts(providerKey: string): Promise<void> {
    if (this.disposed) return
    const accounts = this.api.accounts
    if (accounts === undefined) {
      this.patchAccounts({ errors: { ...this.stateValue.accounts.errors, [providerKey]: 'accounts.channel_unavailable' } })
      return
    }
    try {
      const response = await accounts.list(providerKey)
      if (!response.ok) {
        this.patchAccounts({
          errors: { ...this.stateValue.accounts.errors, [providerKey]: formatError(response.error) },
        })
        return
      }
      const filtered = response.value.filter(account => account.providerKey === providerKey)
      const preservedReports = this.preserveReports(filtered)
      this.patchAccounts({
        accounts: filtered,
        errors: dropKey(this.stateValue.accounts.errors, providerKey),
        reports: preservedReports,
      })
    } catch (error) {
      this.patchAccounts({
        errors: { ...this.stateValue.accounts.errors, [providerKey]: errorMessage(error) },
      })
    }
  }

  async removeAccount(providerKey: string, accountId: string): Promise<void> {
    if (this.disposed) return
    const accounts = this.api.accounts
    if (accounts === undefined) return
    try {
      const response = await accounts.remove(providerKey, accountId)
      if (!response.ok) {
        this.patchAccounts({
          errors: { ...this.stateValue.accounts.errors, [providerKey]: formatError(response.error) },
        })
        return
      }
      // After remove, refresh the channel — host is the source of truth.
      await this.refreshAccounts(providerKey)
    } catch (error) {
      this.patchAccounts({
        errors: { ...this.stateValue.accounts.errors, [providerKey]: errorMessage(error) },
      })
    }
  }

  async fetchLimits(providerKey: string, accountId: string): Promise<void> {
    if (this.disposed) return
    const usage = this.api.usage
    if (usage === undefined) return
    try {
      const response = await usage.fetch(providerKey, accountId)
      if (!response.ok) return
      const key = `${providerKey}#${accountId}`
      this.patchAccounts({
        reports: { ...this.stateValue.accounts.reports, [key]: response.value },
      })
    } catch {
      // Hosts lacking the usage channel stay silent. The UI shows "no limits".
    }
  }

  dispose(): void {
    this.disposed = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.active.clear()
  }

  private async startAsync(flow: AuthorizationFlowView, method: string): Promise<void> {
    try {
      const response = await this.api.authorization.start(flow.key, method)
      if (!response.ok) {
        this.setError(flow.key, formatError(response.error))
        return
      }
      const attemptId = response.value.attemptId
      this.active.set(flow.key, { key: flow.key, attemptId })
      this.mergeAttempt({ attemptId, key: flow.key, label: flow.label, method, status: 'starting', revision: 0 })
      this.schedule(attemptId, flow.key)
      await this.load()
    } catch (error) {
      this.setError(flow.key, errorMessage(error))
    }
  }

  private async answerAsync(attemptId: string, value: string): Promise<void> {
    try {
      const response = await this.api.authorization.answer(attemptId, value)
      if (!response.ok) this.setError(this.keyFor(attemptId), formatError(response.error))
      else this.schedule(attemptId, this.keyFor(attemptId))
    } catch (error) {
      this.setError(this.keyFor(attemptId), errorMessage(error))
    }
  }

  private async cancelAsync(attemptId: string): Promise<void> {
    try {
      const response = await this.api.authorization.cancel(attemptId)
      if (!response.ok) this.setError(this.keyFor(attemptId), formatError(response.error))
      else this.schedule(attemptId, this.keyFor(attemptId))
    } catch (error) {
      this.setError(this.keyFor(attemptId), errorMessage(error))
    }
  }

  private schedule(attemptId: string, key: string): void {
    if (this.disposed) return
    const previous = this.timers.get(attemptId)
    if (previous !== undefined) clearTimeout(previous)
    this.timers.set(attemptId, setTimeout(() => {
      this.timers.delete(attemptId)
      void this.poll(attemptId, key)
    }, REFRESH_DELAY_MS))
  }

  private async poll(attemptId: string, key: string): Promise<void> {
    try {
      const response = await this.api.authorization.state(attemptId)
      if (!response.ok) {
        this.setError(key, formatError(response.error))
        return
      }
      const attempt = response.value
      if (attempt === null) {
        this.finish(key, attemptId)
        return
      }
      this.mergeAttempt(attempt)
      if (attempt.status === 'authorized' || attempt.status === 'cancelled' || attempt.status === 'failed') {
        this.finish(key, attemptId)
        await this.load()
      } else {
        this.schedule(attemptId, key)
      }
    } catch (error) {
      this.setError(key, errorMessage(error))
      this.schedule(attemptId, key)
    }
  }

  private finish(key: string, attemptId: string): void {
    this.active.delete(key)
    const timer = this.timers.get(attemptId)
    if (timer !== undefined) clearTimeout(timer)
    this.timers.delete(attemptId)
  }

  private keyFor(attemptId: string): string {
    return Object.values(this.stateValue.attempts).find(attempt => attempt.attemptId === attemptId)?.key
      ?? [...this.active.values()].find(attempt => attempt.attemptId === attemptId)?.key
      ?? attemptId
  }

  private mergeAttempt(attempt: AuthorizationAttemptView): void {
    this.setState({ attempts: { ...this.stateValue.attempts, [attempt.attemptId]: attempt } })
  }

  private setError(key: string, message: string): void {
    this.setState({ errors: { ...this.stateValue.errors, [key]: message } })
  }

  private setState(patch: Partial<OAuthGridCardState>): void {
    if (this.disposed) return
    this.stateValue = { ...this.stateValue, ...patch }
    this.store.set(this.stateValue)
  }

  private patchAccounts(patch: Partial<OAuthAccountSnapshot>): void {
    if (this.disposed) return
    const accounts = { ...this.stateValue.accounts, ...patch, loaded: true }
    this.setState({ accounts })
  }

  private preserveReports(filtered: readonly OAuthAccountView[]): Readonly<Record<string, UsageReport>> {
    const keep = new Set(filtered.map(account => `${account.providerKey}#${account.accountId}`))
    const next: Record<string, UsageReport> = {}
    for (const [key, report] of Object.entries(this.stateValue.accounts.reports)) {
      if (keep.has(key)) next[key] = report
    }
    return next
  }
}

function dropKey(record: Readonly<Record<string, string>>, key: string): Record<string, string> {
  if (!(key in record)) return record as Record<string, string>
  const next: Record<string, string> = {}
  for (const [k, v] of Object.entries(record)) {
    if (k !== key) next[k] = v
  }
  return next
}

function formatError(error: { message: string; code: string }): string {
  return `${error.message} (${error.code})`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

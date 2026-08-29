import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AuthorizationAttemptView,
  AuthorizationCancelValue,
  AuthorizationFlowView,
  AuthorizationStartValue,
} from '@deepseek-ai/dsh-fork-authorization-controller/types'

export interface AuthorizationRemoteApi {
  list(): Promise<RemoteResult<readonly AuthorizationFlowView[]>>
  start(key: string, method?: string): Promise<RemoteResult<AuthorizationStartValue>>
  state(attemptId: string): Promise<RemoteResult<AuthorizationAttemptView | null>>
  answer(attemptId: string, value: string): Promise<RemoteResult<void>>
  cancel(attemptId: string): Promise<RemoteResult<AuthorizationCancelValue>>
}

export interface AuthorizationCardState {
  readonly loaded: boolean
  readonly loading: boolean
  readonly flows: readonly AuthorizationFlowView[]
  readonly attempts: Readonly<Record<string, AuthorizationAttemptView>>
  readonly errors: Readonly<Record<string, string>>
}

export interface AuthorizationCardFace {
  readonly useAuthorization: <T>(selector?: (state: AuthorizationCardState) => T) => T
  readonly start: (flow: AuthorizationFlowView, method: string) => void
  readonly answer: (attemptId: string, value: string) => void
  readonly cancel: (attemptId: string) => void
}

interface ActiveAttempt {
  readonly key: string
  readonly attemptId: string
}

export class AuthorizationCardController {
  readonly store: SnapshotStore<AuthorizationCardState>
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly active = new Map<string, ActiveAttempt>()
  private disposed = false
  private stateValue: AuthorizationCardState = {
    loaded: false,
    loading: false,
    flows: [],
    attempts: {},
    errors: {},
  }

  constructor(private readonly api: AuthorizationRemoteApi) {
    this.store = createSnapshotStore(this.stateValue)
    void this.load()
  }

  async load(): Promise<void> {
    if (this.disposed) return
    this.setState({ loading: true })
    try {
      const response = await this.api.list()
      if (!response.ok) {
        this.setState({ loaded: true, loading: false, flows: [], errors: { list: formatError(response.error) } })
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

  dispose(): void {
    this.disposed = true
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.active.clear()
  }

  private async startAsync(flow: AuthorizationFlowView, method: string): Promise<void> {
    try {
      const response = await this.api.start(flow.key, method)
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
      const response = await this.api.answer(attemptId, value)
      if (!response.ok) this.setError(this.keyFor(attemptId), formatError(response.error))
      else this.schedule(attemptId, this.keyFor(attemptId))
    } catch (error) { this.setError(this.keyFor(attemptId), errorMessage(error)) }
  }

  private async cancelAsync(attemptId: string): Promise<void> {
    try {
      const response = await this.api.cancel(attemptId)
      if (!response.ok) this.setError(this.keyFor(attemptId), formatError(response.error))
      else this.schedule(attemptId, this.keyFor(attemptId))
    } catch (error) { this.setError(this.keyFor(attemptId), errorMessage(error)) }
  }

  private schedule(attemptId: string, key: string): void {
    if (this.disposed) return
    const previous = this.timers.get(attemptId)
    if (previous !== undefined) clearTimeout(previous)
    this.timers.set(attemptId, setTimeout(() => {
      this.timers.delete(attemptId)
      void this.poll(attemptId, key)
    }, 250))
  }

  private async poll(attemptId: string, key: string): Promise<void> {
    try {
      const response = await this.api.state(attemptId)
      if (!response.ok) { this.setError(key, formatError(response.error)); return }
      const attempt = response.value
      if (attempt === null) { this.finish(key, attemptId); return }
      this.mergeAttempt(attempt)
      if (attempt.status === 'authorized' || attempt.status === 'cancelled' || attempt.status === 'failed') {
        this.finish(key, attemptId)
        await this.load()
      } else this.schedule(attemptId, key)
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

  private setState(patch: Partial<AuthorizationCardState>): void {
    if (this.disposed) return
    this.stateValue = { ...this.stateValue, ...patch }
    this.store.set(this.stateValue)
  }
}

function formatError(error: { message: string; code: string }): string {
  return `${error.message} (${error.code})`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

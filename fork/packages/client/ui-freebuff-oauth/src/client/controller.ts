/** Client-side controller for the Host-owned Freebuff OAuth lifecycle. */

import type { IApiClient } from '@deepseek-ai/dsh-fork-host-apiproxy/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Redacted account metadata rendered by the tab. */
export interface FreebuffOAuthAccountState {
  accountId: string
  displayName?: string | undefined
  status: 'active' | 'reauthenticate'
}

/** State rendered by the OAuth tab. */
export interface FreebuffOAuthState {
  status: 'loading' | 'signed-out' | 'pending' | 'connected' | 'waiting' | 'error'
  account?: FreebuffOAuthAccountState
  loginUrl?: string
  error?: string
  desktopStatus?: 'idle' | 'opening' | 'error'
  desktopError?: string
}

/** Registration-side face injected into the OAuth tab. */
export interface FreebuffOAuthFace {
  hooks: {
    oauth: SnapshotStore<FreebuffOAuthState>
  }
  beginLogin: () => void
  completeLogin: () => void
  logout: () => void
  refresh: () => void
  openDesktop: () => void
}

/** Owns the browser projection while the Host retains all OAuth secrets. */
export class FreebuffOAuthController {
  private readonly store = createSnapshotStore<FreebuffOAuthState>({ status: 'loading' })
  private disposed = false
  private busy = false

  /** @param api - browser-safe Freebuff API face. */
  constructor(private readonly api: IApiClient['freebuff']) {
    void this.refreshState()
  }

  /** Build the injected tab face. */
  inject(): FreebuffOAuthFace {
    return {
      hooks: { oauth: this.store },
      beginLogin: () => { void this.beginLogin() },
      completeLogin: () => { void this.completeLogin() },
      logout: () => { void this.logout() },
      refresh: () => { void this.refreshState() },
      openDesktop: () => { void this.openDesktop() },
    }
  }

  /** Dispose the controller's future publications. */
  dispose(): void {
    this.disposed = true
  }

  private async refreshState(): Promise<void> {
    if (this.busy || this.disposed) return
    try {
      const response = await this.api.status({})
      if (!response.result.ok) {
        this.publish({ status: 'error', error: response.result.error.message })
        return
      }
      const account = response.result.value.accounts[0]
      this.publish(account === undefined
        ? response.result.value.pending === undefined
          ? { status: 'signed-out' }
          : { status: 'pending', loginUrl: response.result.value.pending.loginUrl }
        : { status: account.status === 'active' ? 'connected' : 'error', account })
    } catch (error) {
      this.publish({ status: 'error', error: errorMessage(error) })
    }
  }

  private async beginLogin(): Promise<void> {
    if (this.busy || this.disposed) return
    this.busy = true
    try {
      const response = await this.api.beginLogin({})
      if (!response.result.ok) {
        this.publish({ status: 'error', error: response.result.error.message })
        return
      }
      this.publish({ status: 'pending', loginUrl: response.result.value.loginUrl })
    } catch (error) {
      this.publish({ status: 'error', error: errorMessage(error) })
    } finally {
      this.busy = false
    }
  }

  private async completeLogin(): Promise<void> {
    if (this.busy || this.disposed) return
    const loginUrl = this.store.getSnapshot().loginUrl
    if (loginUrl === undefined) return
    this.busy = true
    this.publish({ status: 'waiting', loginUrl })
    try {
      const response = await this.api.completeLogin({})
      if (!response.result.ok) {
        this.publish({ status: 'error', loginUrl, error: response.result.error.message })
        return
      }
      this.publish({ status: 'connected', account: response.result.value.account })
    } catch (error) {
      this.publish({ status: 'error', loginUrl, error: errorMessage(error) })
    } finally {
      this.busy = false
    }
  }

  private async logout(): Promise<void> {
    if (this.busy || this.disposed) return
    this.busy = true
    try {
      const response = await this.api.logout({})
      if (!response.result.ok) {
        this.publish({ status: 'error', error: response.result.error.message })
        return
      }
      this.publish({ status: 'signed-out' })
    } catch (error) {
      this.publish({ status: 'error', error: errorMessage(error) })
    } finally {
      this.busy = false
    }
  }

  private async openDesktop(): Promise<void> {
    if (this.disposed || this.store.getSnapshot().desktopStatus === 'opening') return
    const { desktopError: _openingError, ...openingState } = this.store.getSnapshot()
    this.publish({ ...openingState, desktopStatus: 'opening' })
    try {
      const response = await this.api.openDesktop({})
      if (!response.result.ok) {
        this.publish({ ...this.store.getSnapshot(), desktopStatus: 'error', desktopError: response.result.error.message })
        return
      }
      const { desktopError: _idleError, ...idleState } = this.store.getSnapshot()
      this.publish({ ...idleState, desktopStatus: 'idle' })
    } catch (error) {
      this.publish({ ...this.store.getSnapshot(), desktopStatus: 'error', desktopError: errorMessage(error) })
    }
  }

  private publish(state: FreebuffOAuthState): void {
    if (!this.disposed) this.store.set(state)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Freebuff OAuth methods exposed to the browser without credential values. */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Redacted account metadata safe to render in the browser. */
export interface FreebuffAccountView {
  accountId: string
  displayName?: string | undefined
  status: 'active' | 'reauthenticate'
}

/** Login URL and expiry; the Host retains the signed polling values. */
export interface FreebuffLoginView {
  loginUrl: string
  expiresAt: string
}

/** Freebuff OAuth status returned to the browser. */
export interface FreebuffStatusView {
  accounts: FreebuffAccountView[]
  pending?: FreebuffLoginView | undefined
}

/** Freebuff OAuth API. Access tokens never occur in these response types. */
export interface FreebuffApi {
  /** Read persisted account metadata and any pending browser login. */
  status(request: RpcRequest<{}>): Promise<RpcResponse<FreebuffStatusView>>

  /** Start a device login and return its browser URL. */
  beginLogin(request: RpcRequest<{}>): Promise<RpcResponse<FreebuffLoginView>>

  /** Wait for the browser approval using the Host-retained device challenge. */
  completeLogin(request: RpcRequest<{}>, signal: AbortSignal): Promise<RpcResponse<{ account: FreebuffAccountView }>>

  /** Remove the locally persisted Freebuff account. */
  logout(request: RpcRequest<{}>): Promise<RpcResponse<{}>>

  /** Open the configured DeepSeek Harness Desktop shortcut through the Host. */
  openDesktop(request: RpcRequest<{}>, signal: AbortSignal): Promise<RpcResponse<{ opened: true }>>
}

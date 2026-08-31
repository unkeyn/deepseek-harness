/** Runtime directory shared with optional Bearer extensions. */

import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { ResolvedBearerMcpBridgeProfile, ResolvedBearerProviderProfile } from './config.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    bearerProviders: BearerProviderDirectory
  }
}

/** One live Bearer route as seen by the optional MCP bridge. */
export interface BearerProviderBridgeEntry {
  provider: string
  displayName: string
  /** Wire protocol identifier; native bearer-chat routes cannot accept arbitrary tool schemas. */
  api?: string
  chatURL: string
  bridge?: ResolvedBearerMcpBridgeProfile
  tokenRefs: readonly CredentialRef[]
  /** Resolve the route token, or an explicitly selected alternate credential. */
  resolveToken(ref?: CredentialRef): Promise<string | undefined>
}

/** Read-only provider directory with a small change notification seam. */
export interface BearerProviderDirectory {
  list(): readonly BearerProviderBridgeEntry[]
  subscribe(listener: () => void): () => void
}

/** Project a resolved profile into the intentionally narrow extension API. */
export function bridgeEntry(
  profile: ResolvedBearerProviderProfile,
  resolveToken: (ref?: CredentialRef) => Promise<string | undefined>,
): BearerProviderBridgeEntry {
  return {
    provider: profile.provider,
    displayName: profile.displayName,
    api: profile.api,
    chatURL: profile.chatURL,
    ...profile.mcpBridge === undefined ? {} : { bridge: profile.mcpBridge },
    tokenRefs: [
      profile.auth.accessTokenEnv,
      ...(profile.mcpBridge?.tokenEnv === undefined ? [] : [profile.mcpBridge.tokenEnv]),
    ],
    resolveToken,
  }
}

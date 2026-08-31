/**
 * Optional Bearer-provider MCP bridge.
 *
 * Each enabled Bearer route owns one Streamable HTTP MCP client. The official
 * MCP client remains the protocol implementation; this package only resolves
 * the provider token, gives the client a stable namespace, and reconciles it
 * when settings or credentials change.
 * @module @deepseek-ai/dsh-fork-llm-bearer-mcp-bridge
 */

import { createHash } from 'node:crypto'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { BearerProviderBridgeEntry } from '@deepseek-ai/dsh-fork-llm-bearer'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { resolveMcpToken, tokenFingerprint } from './token.ts'

/** Cordis plugin name. */
export const name = 'llm-bearer-mcp-bridge'
/** The Bearer directory is supplied by the fork's Bearer route owner. */
export const inject = ['bearerProviders']

const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

interface MountedBridge {
  fingerprint: string
  fiber: Fiber
}

/** Stable MCP tool namespace for one Bearer route. */
export function bridgeServerName(provider: string): string {
  const direct = `bearer_${provider}`
  if (SERVER_NAME_PATTERN.test(direct) && direct.length <= 32) return direct
  const slug = provider.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 12) || 'provider'
  const digest = createHash('sha256').update(provider).digest('hex').slice(0, 12)
  return `bearer_${slug}_${digest}`
}

/** Mount every opted-in provider and keep mounts synchronized with live state. */
export async function apply(ctx: Context): Promise<void> {
  const directory = ctx.bearerProviders
  const mounted = new Map<string, MountedBridge>()
  let stopped = false
  let reconcileChain: Promise<void> = Promise.resolve()

  const reconcile = (): Promise<void> => {
    const run = reconcileChain.then(async () => {
      if (stopped) return
      const desired = new Map<string, { entry: BearerProviderBridgeEntry; token: string; fingerprint: string }>()
      for (const entry of directory.list()) {
        if (entry.bridge?.enabled !== true) continue
        try {
          const token = await resolveMcpToken(entry)
          desired.set(entry.provider, {
            entry,
            token,
            fingerprint: `${entry.bridge.endpoint}\0${entry.bridge.toolCallTimeoutMs}\0${tokenFingerprint(token)}`,
          })
        } catch (error: unknown) {
          ctx.logger.warn(`llm-bearer-mcp-bridge(${entry.provider}): not mounted: ${safeMessage(error)}`)
        }
      }

      for (const [provider, previous] of mounted) {
        const next = desired.get(provider)
        if (next !== undefined && next.fingerprint === previous.fingerprint) continue
        await previous.fiber.dispose()
        mounted.delete(provider)
      }

      for (const [provider, next] of desired) {
        if (mounted.has(provider)) continue
        try {
          const fiber = ctx.plugin(McpClient, {
            transport: 'streamable-http',
            serverName: bridgeServerName(provider),
            url: next.entry.bridge!.endpoint,
            headers: { Authorization: `Bearer ${next.token}` },
            toolCallTimeoutMs: next.entry.bridge!.toolCallTimeoutMs,
            // A temporary provider outage should not take down the whole Host;
            // the official client owns bounded reconnect and tool re-sync.
            failOnStartupError: false,
          })
          await fiber.await()
          mounted.set(provider, { fingerprint: next.fingerprint, fiber })
        } catch (error: unknown) {
          ctx.logger.warn(`llm-bearer-mcp-bridge(${provider}): connection not mounted: ${safeMessage(error)}`)
        }
      }
    })
    reconcileChain = run.catch((error: unknown) => {
      ctx.logger.error(`llm-bearer-mcp-bridge: reconciliation failed: ${safeMessage(error)}`)
    })
    return reconcileChain
  }

  const unsubscribe = directory.subscribe(() => { void reconcile() })
  ctx.on('credentials/reference-updated', (ref: CredentialRef) => {
    if (directory.list().some(entry => entry.bridge?.enabled === true && entry.tokenRefs.includes(ref))) void reconcile()
  })
  ctx.effect(
    () => {
      return () => {
        stopped = true
        unsubscribe()
        return reconcileChain.then(async () => {
          for (const mountedBridge of mounted.values()) await mountedBridge.fiber.dispose()
          mounted.clear()
        })
      }
    },
    'llm-bearer-mcp-bridge.connections',
  )

  await reconcile()
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error'
}

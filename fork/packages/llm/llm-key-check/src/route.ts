/**
 * The `/llm-key-check` Connection channel: the browser pastes a page of
 * `provider<TAB>key` lines, and the host answers which ones a provider
 * accepted.
 *
 * The channel is deliberately narrow. Two endpoints — the directory of
 * providers this host can ask, and a check — and a payload that carries keys
 * inbound only. No response ever contains a key: the verdict comes back
 * against the id the caller supplied, so a key that crossed the wire once
 * never crosses it again, and nothing about it lands in a log or a store.
 *
 * @module @deepseek-ai/dsh-fork-llm-key-check/route
 */

import type { ConnectionRpcHandler, ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import { checkKeys, type KeyCheckOutcome, type KeyCheckTarget } from './check.ts'
import type { KeyCheckProviderInfo, KeyCheckRoute } from './providers.ts'
import { providerDirectory } from './providers.ts'

/** Endpoint answering with the providers this host can probe. */
export const PROVIDERS_ENDPOINT = 'llmKeyCheck.providers'
/** Endpoint answering with one verdict per pasted key. */
export const CHECK_ENDPOINT = 'llmKeyCheck.check'

/** The value `llmKeyCheck.providers` answers with. */
export interface ProvidersValue {
  readonly providers: readonly KeyCheckProviderInfo[]
}

/** The value `llmKeyCheck.check` answers with. */
export interface CheckValue {
  readonly outcomes: readonly KeyCheckOutcome[]
}

/** One bad-request failure, in the shape every Connection endpoint reports. */
function badRequest(message: string, issues: object[] = []): ConnectionRpcResult<never> {
  return { ok: false, error: { code: 'bad-request', message, details: { issues } } }
}

/** One unexpected failure. The message is the handler's own; a key never reaches it. */
function internal(message: string): ConnectionRpcResult<never> {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

/** Read one non-empty trimmed string field of an untrusted record. */
function field(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Read the check payload.
 *
 * Every field is untrusted: the browser sends whatever the paste buffer held,
 * so a provider id is checked against the directory before any request is made
 * rather than trusted to name a route. Keys are carried through untouched and
 * are validated on the probe side, where the rule about what an HTTP header
 * can carry actually lives.
 * @param payload - the RPC payload.
 * @returns the parsed targets, or the failure to answer with.
 */
export function readCheckPayload(payload: unknown): { targets: readonly KeyCheckTarget[] } | ConnectionRpcResult<never> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return badRequest('payload must be an object')
  }
  const keys = (payload as { keys?: unknown }).keys
  if (!Array.isArray(keys)) return badRequest('keys must be an array')
  if (keys.length === 0) return badRequest('keys must not be empty')
  const targets: KeyCheckTarget[] = []
  for (const [index, entry] of keys.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return badRequest(`keys[${index}] must be an object`)
    }
    const record = entry as Record<string, unknown>
    const provider = field(record, 'provider')
    if (provider === undefined) return badRequest(`keys[${index}].provider must be a non-empty string`)
    const apiKey = record.apiKey
    if (typeof apiKey !== 'string') return badRequest(`keys[${index}].apiKey must be a string`)
    // The id is the caller's own correlation handle; a blank one is replaced
    // rather than rejected, so a client that omits it still gets ordered answers.
    targets.push({ id: field(record, 'id') ?? `key-${index}`, provider, apiKey })
  }
  return { targets }
}

/** Whether one value is a parsed-target result rather than a failure. */
function isTargets(
  value: { targets: readonly KeyCheckTarget[] } | ConnectionRpcResult<never>,
): value is { targets: readonly KeyCheckTarget[] } {
  return 'targets' in value
}

/**
 * Build the `/llm-key-check` handler.
 * @param routes - the route directory, read per call so a settings edit
 *   reaches the very next check without a restart.
 * @param deps - overrides a test supplies: network entry point and limits.
 * @returns the Connection RPC handler for the channel.
 */
export function createKeyCheckHandler(
  routes: () => readonly KeyCheckRoute[],
  deps: { fetch?: typeof fetch; timeoutMs?: number; concurrency?: number } = {},
): ConnectionRpcHandler {
  return async (endpoint, payload): Promise<ConnectionRpcResult<unknown>> => {
    if (endpoint === PROVIDERS_ENDPOINT) {
      const value: ProvidersValue = { providers: providerDirectory(routes()) }
      return { ok: true, value }
    }
    if (endpoint !== CHECK_ENDPOINT) {
      return { ok: false, error: { code: 'bad-request', message: `unknown endpoint ${endpoint}`, details: { issues: [] } } }
    }
    const parsed = readCheckPayload(payload)
    if (!isTargets(parsed)) return parsed
    try {
      const outcomes = await checkKeys({ routes, ...deps }, parsed.targets)
      const value: CheckValue = { outcomes }
      return { ok: true, value }
    } catch (error: unknown) {
      return internal(error instanceof Error ? error.message : String(error))
    }
  }
}

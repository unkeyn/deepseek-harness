/**
 * Configuration and explicit resolution for Bearer-authenticated chat routes.
 * @module dsh-llm-bearer/config
 */

import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-fork-llm'
import type { ResolvedRetryPolicy, RetryPolicyConfig } from '@deepseek-ai/dsh-fork-llm'

/** Default total HTTP and stream duration for one Bearer request. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 300_000
/** Context capacity used for a model whose profile omits one. */
export const DEFAULT_CONTEXT_WINDOW = 262_144
/** Output capability used for a model whose profile omits one. */
export const DEFAULT_MAX_TOKENS = 32_768
/** Default timeout for one call made through an enabled Bearer MCP bridge. */
export const DEFAULT_MCP_BRIDGE_TIMEOUT_MS = 60_000

/** Firebase Secure Token refresh settings for one Bearer route. */
export interface FirebaseBearerRefresh {
  /** Refresh implementation selected for this route. */
  type: 'firebase'
  /** Full token-refresh endpoint. The provider supplies its own URL. */
  endpoint?: string
  /** Credential reference holding the current Firebase refresh token. */
  refreshTokenEnv: string
  /** Public Firebase Web API key identifying the project. */
  apiKey: string
}

/** Bearer authorization references for one route. */
export interface BearerAuth {
  /** Authorization method selected for this plugin. */
  type: 'bearer'
  /** Credential reference holding the current Bearer access token. */
  accessTokenEnv: string
  /** Optional Firebase rotation declaration. */
  refresh?: FirebaseBearerRefresh
}

/** One model exposed by a route. */
export interface BearerModelProfile {
  /** Model id accepted by the provider, or `auto`. */
  id: string
  /** Optional selector label. */
  name?: string
  /** Combined request and response capacity. */
  contextWindow?: number
  /** Output capability advertised to request assembly. */
  maxTokens?: number
}

/** Optional MCP bridge mounted on one Bearer provider route. */
export interface BearerMcpBridgeProfile {
  /** Mount the provider's MCP endpoint as native Harness tools. */
  enabled?: boolean
  /** Exact Streamable HTTP MCP endpoint. */
  endpoint?: string
  /** Optional credential reference for a token different from the Bearer token. */
  tokenEnv?: string
  /** Automatically exchange Firebase access tokens when the server advertises it. */
  tokenExchange?: boolean
  /** Per-tool-call timeout for the mounted MCP server. */
  toolCallTimeoutMs?: number
}

/** One Bearer provider route; the containing dict key is its route id. */
export interface BearerProviderProfile {
  /** Selector label; defaults to the route id. */
  displayName?: string
  /** Explicit Bearer credential references. */
  auth: BearerAuth
  /** Wire protocol implemented by this package. */
  api: string
  /** Exact chat endpoint. */
  chatURL?: string
  /** Legacy endpoint field accepted for migration; it is treated as exact. */
  baseURL?: string
  /** Exact model-list endpoint used by the optional model fetcher. */
  modelsURL?: string
  /** Models advertised by this route. */
  models: BearerModelProfile[]
  /** Total request duration including streamed response reads. */
  timeoutMs?: number
  /** Provider-owned recovery policy. */
  retryPolicy?: RetryPolicyConfig
  /** Optional provider-specific MCP tool bridge. */
  mcpBridge?: BearerMcpBridgeProfile
}

/** Plugin configuration. */
export interface Config {
  /** Bearer provider profiles keyed by route id. */
  providers?: Record<string, BearerProviderProfile>
}

/** Validated Firebase refresh declaration. */
export interface ResolvedFirebaseBearerRefresh extends Omit<FirebaseBearerRefresh, 'refreshTokenEnv'> {
  /** Validated exact token-refresh endpoint. */
  endpoint: string
  /** Validated refresh-token reference. */
  refreshTokenEnv: CredentialRef
}

/** Validated Bearer authorization declaration. */
export interface ResolvedBearerAuth extends Omit<BearerAuth, 'accessTokenEnv' | 'refresh'> {
  /** Validated access-token reference. */
  accessTokenEnv: CredentialRef
  /** Validated refresh declaration. */
  refresh?: ResolvedFirebaseBearerRefresh
}

/** Fully resolved model metadata. */
export interface ResolvedBearerModelProfile extends BearerModelProfile {
  /** Combined request and response capacity after defaulting. */
  contextWindow: number
  /** Output capability after defaulting. */
  maxTokens: number
}

/** Validated MCP bridge settings exposed to the Bearer bridge plugin. */
export interface ResolvedBearerMcpBridgeProfile {
  enabled: true
  endpoint: string
  tokenEnv?: CredentialRef
  tokenExchange: boolean
  toolCallTimeoutMs: number
}

/** Fully resolved route facts read once per operation. */
export interface ResolvedBearerProviderProfile
  extends Omit<BearerProviderProfile, 'displayName' | 'auth' | 'models' | 'timeoutMs' | 'retryPolicy' | 'chatURL' | 'baseURL' | 'mcpBridge'> {
  /** Route id selected by `GenerateOptions.provider`. */
  provider: string
  /** Selector label after defaulting. */
  displayName: string
  /** Exact chat endpoint. */
  chatURL: string
  /** Validated credential references. */
  auth: ResolvedBearerAuth
  /** Resolved model metadata. */
  models: readonly ResolvedBearerModelProfile[]
  /** Positive finite total request duration. */
  timeoutMs: number
  /** Resolved provider recovery policy. */
  retryPolicy: ResolvedRetryPolicy
  /** Enabled MCP bridge, if this route opted into it. */
  mcpBridge?: ResolvedBearerMcpBridgeProfile
}

const firebaseRefresh: z<FirebaseBearerRefresh> = z.object({
  type: z.const('firebase').required(),
  endpoint: z.string(),
  refreshTokenEnv: z.string().role('credential-ref').required(),
  apiKey: z.string().required(),
})

const bearerAuth: z<BearerAuth> = z.object({
  type: z.const('bearer').required(),
  accessTokenEnv: z.string().role('credential-ref').required(),
  refresh: z.union([firebaseRefresh, z.const(null)]) as unknown as z<FirebaseBearerRefresh>,
})

const model: z<BearerModelProfile> = z.object({
  id: z.string().required(),
  name: z.string(),
  contextWindow: z.number().step(1).min(1).default(DEFAULT_CONTEXT_WINDOW),
  maxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS),
})

const mcpBridge: z<BearerMcpBridgeProfile> = z.object({
  enabled: z.boolean().default(false),
  endpoint: z.string(),
  tokenEnv: z.string().role('credential-ref'),
  tokenExchange: z.boolean().default(true),
  toolCallTimeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_MCP_BRIDGE_TIMEOUT_MS),
})

const profile: z<BearerProviderProfile> = z.object({
  displayName: z.string(),
  auth: bearerAuth.required(),
  api: z.string().required(),
  chatURL: z.string(),
  baseURL: z.string(),
  modelsURL: z.string(),
  models: z.array(model).required(),
  timeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_REQUEST_TIMEOUT_MS),
  retryPolicy: RetryPolicySchema,
  mcpBridge,
})

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  providers: z.dict(profile).default({}),
})

/** Validate one exact HTTP endpoint without rewriting its path. */
function httpEndpoint(value: string, provider: string, field: string): string {
  let endpoint: URL
  try {
    endpoint = new URL(value)
  } catch (error: unknown) {
    throw new Error(`llm-bearer: provider "${provider}" has an invalid ${field}`, { cause: error })
  }
  if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') {
    throw new Error(`llm-bearer: provider "${provider}" ${field} must use http or https`)
  }
  return value
}

/**
 * Validate and materialize all configured Bearer routes.
 * @param providers - raw route profiles keyed by provider id.
 * @returns validated profiles with request defaults and credential references materialized.
 */
export function resolveProfiles(
  providers: Readonly<Record<string, BearerProviderProfile>> | undefined,
): ReadonlyMap<string, ResolvedBearerProviderProfile> {
  const result = new Map<string, ResolvedBearerProviderProfile>()
  for (const [provider, source] of Object.entries(providers ?? {})) {
    if (provider.length === 0) throw new Error('llm-bearer: provider names must be non-empty')
    if (source.displayName !== undefined && source.displayName.trim().length === 0) {
      throw new Error(`llm-bearer: provider "${provider}" has an empty displayName`)
    }
    const chatURLValue = source.chatURL?.trim() || source.baseURL?.trim()
    if (chatURLValue === undefined || chatURLValue.length === 0) {
      throw new Error(`llm-bearer: provider "${provider}" needs a chatURL`)
    }
    httpEndpoint(chatURLValue, provider, 'chatURL')
    const modelsURLValue = source.modelsURL?.trim()
    if (modelsURLValue !== undefined && modelsURLValue.length > 0) {
      httpEndpoint(modelsURLValue, provider, 'modelsURL')
    }
    if (source.models.length === 0) {
      throw new Error(`llm-bearer: provider "${provider}" must declare at least one model`)
    }
    const seen = new Set<string>()
    const models = source.models.map((entry): ResolvedBearerModelProfile => {
      if (entry.id.trim().length === 0) throw new Error(`llm-bearer: provider "${provider}" has an empty model id`)
      if (seen.has(entry.id)) throw new Error(`llm-bearer: provider "${provider}" repeats model "${entry.id}"`)
      seen.add(entry.id)
      return {
        ...entry,
        contextWindow: entry.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
        maxTokens: entry.maxTokens ?? DEFAULT_MAX_TOKENS,
      }
    })
    const refresh = source.auth.refresh == null ? undefined : source.auth.refresh
    if (refresh !== undefined && (refresh.endpoint === undefined || refresh.endpoint.trim().length === 0)) {
      throw new Error(`llm-bearer: provider "${provider}" refresh endpoint must be non-empty`)
    }
    if (refresh?.endpoint !== undefined) httpEndpoint(refresh.endpoint.trim(), provider, 'refresh endpoint')
    if (refresh !== undefined && refresh.apiKey.trim().length === 0) {
      throw new Error(`llm-bearer: provider "${provider}" Firebase apiKey must be non-empty`)
    }
    const bridgeSource = source.mcpBridge?.enabled === true ? source.mcpBridge : undefined
    let bridge: ResolvedBearerMcpBridgeProfile | undefined
    if (bridgeSource !== undefined) {
      if (bridgeSource.endpoint === undefined || bridgeSource.endpoint.trim().length === 0) {
        throw new Error(`llm-bearer: provider "${provider}" MCP bridge endpoint must be non-empty`)
      }
      const toolCallTimeoutMs = bridgeSource.toolCallTimeoutMs ?? DEFAULT_MCP_BRIDGE_TIMEOUT_MS
      if (!Number.isFinite(toolCallTimeoutMs) || toolCallTimeoutMs <= 0 || toolCallTimeoutMs > MAX_TIMER_DELAY_MS) {
        throw new Error(`llm-bearer: provider "${provider}" MCP bridge toolCallTimeoutMs must be a positive timer delay`)
      }
      bridge = {
        enabled: true,
        endpoint: httpEndpoint(bridgeSource.endpoint.trim(), provider, 'MCP bridge endpoint'),
        ...bridgeSource.tokenEnv === undefined || bridgeSource.tokenEnv.trim().length === 0
          ? {}
          : { tokenEnv: credentialRef(bridgeSource.tokenEnv) },
        tokenExchange: bridgeSource.tokenExchange ?? true,
        toolCallTimeoutMs,
      }
    }
    const timeoutMs = source.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_DELAY_MS) {
      throw new Error(`llm-bearer: provider "${provider}" timeoutMs must be a positive timer delay`)
    }
    result.set(provider, {
      provider,
      displayName: source.displayName ?? provider,
      api: source.api,
      chatURL: chatURLValue,
      ...modelsURLValue === undefined || modelsURLValue.length === 0 ? {} : { modelsURL: modelsURLValue },
      auth: {
        type: 'bearer',
        accessTokenEnv: credentialRef(source.auth.accessTokenEnv),
        ...refresh === undefined ? {} : {
          refresh: {
            type: 'firebase',
            endpoint: refresh.endpoint as string,
            refreshTokenEnv: credentialRef(refresh.refreshTokenEnv),
            apiKey: refresh.apiKey,
          },
        },
      },
      models,
      timeoutMs,
      retryPolicy: resolveRetryPolicy(source.retryPolicy, `llm-bearer: provider "${provider}" retryPolicy`),
      ...bridge === undefined ? {} : { mcpBridge: bridge },
    })
  }
  return result
}

/**
 * Reject an unserviceable settings section before it is stored.
 * @param config - candidate settings section to validate completely.
 */
export function assertServiceable(config: Config): void {
  resolveProfiles(config.providers)
}

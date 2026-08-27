/**
 * Configuration and explicit resolution for Bearer-authenticated TwinMind routes.
 * @module dsh-llm-bearer/config
 */

import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { resolveRetryPolicy, RetryPolicySchema } from '@deepseek-ai/dsh-llm'
import type { ResolvedRetryPolicy, RetryPolicyConfig } from '@deepseek-ai/dsh-llm'

/** Default total HTTP and stream duration for one TwinMind request. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 300_000
/** Context capacity used for a model whose profile omits one. */
export const DEFAULT_CONTEXT_WINDOW = 262_144
/** Output capability used for a model whose profile omits one. */
export const DEFAULT_MAX_TOKENS = 32_768

/** Firebase Secure Token refresh settings for one Bearer route. */
export interface FirebaseBearerRefresh {
  /** Refresh implementation selected for this route. */
  type: 'firebase'
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

/** One TwinMind model exposed by a route. */
export interface BearerModelProfile {
  /** Model id accepted by TwinMind, or `auto`. */
  id: string
  /** Optional selector label. */
  name?: string
  /** Combined request and response capacity. */
  contextWindow?: number
  /** Output capability advertised to request assembly. */
  maxTokens?: number
}

/** One Bearer provider route; the containing dict key is its route id. */
export interface BearerProviderProfile {
  /** Selector label; defaults to the route id. */
  displayName?: string
  /** Explicit Bearer credential references. */
  auth: BearerAuth
  /** Wire protocol implemented by this package. */
  api: 'twinmind-chat'
  /** TwinMind API base or complete `/api/v3/chat` URL. */
  baseURL: string
  /** Models advertised by this route. */
  models: BearerModelProfile[]
  /** Total request duration including streamed response reads. */
  timeoutMs?: number
  /** Provider-owned recovery policy. */
  retryPolicy?: RetryPolicyConfig
}

/** Plugin configuration. */
export interface Config {
  /** Bearer provider profiles keyed by route id. */
  providers?: Record<string, BearerProviderProfile>
}

/** Validated Firebase refresh declaration. */
export interface ResolvedFirebaseBearerRefresh extends Omit<FirebaseBearerRefresh, 'refreshTokenEnv'> {
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

/** Fully resolved route facts read once per operation. */
export interface ResolvedBearerProviderProfile
  extends Omit<BearerProviderProfile, 'displayName' | 'auth' | 'models' | 'timeoutMs' | 'retryPolicy'> {
  /** Route id selected by `GenerateOptions.provider`. */
  provider: string
  /** Selector label after defaulting. */
  displayName: string
  /** Validated credential references. */
  auth: ResolvedBearerAuth
  /** Resolved model metadata. */
  models: readonly ResolvedBearerModelProfile[]
  /** Positive finite total request duration. */
  timeoutMs: number
  /** Resolved provider recovery policy. */
  retryPolicy: ResolvedRetryPolicy
}

const firebaseRefresh: z<FirebaseBearerRefresh> = z.object({
  type: z.const('firebase').required(),
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

const profile: z<BearerProviderProfile> = z.object({
  displayName: z.string(),
  auth: bearerAuth.required(),
  api: z.union(['twinmind-chat']).required(),
  baseURL: z.string().required(),
  models: z.array(model).required(),
  timeoutMs: z.number().min(Number.MIN_VALUE).max(MAX_TIMER_DELAY_MS).default(DEFAULT_REQUEST_TIMEOUT_MS),
  retryPolicy: RetryPolicySchema,
})

/** Runtime schema for {@link Config}. */
export const Config: z<Config> = z.object({
  providers: z.dict(profile).default({}),
})

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
    let baseURL: URL
    try {
      baseURL = new URL(source.baseURL)
    } catch (error: unknown) {
      throw new Error(`llm-bearer: provider "${provider}" has an invalid baseURL`, { cause: error })
    }
    if (baseURL.protocol !== 'https:' && baseURL.protocol !== 'http:') {
      throw new Error(`llm-bearer: provider "${provider}" baseURL must use http or https`)
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
    if (refresh !== undefined && refresh.apiKey.trim().length === 0) {
      throw new Error(`llm-bearer: provider "${provider}" Firebase apiKey must be non-empty`)
    }
    const timeoutMs = source.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMER_DELAY_MS) {
      throw new Error(`llm-bearer: provider "${provider}" timeoutMs must be a positive timer delay`)
    }
    result.set(provider, {
      provider,
      displayName: source.displayName ?? provider,
      api: 'twinmind-chat',
      baseURL: source.baseURL.replace(/\/+$/, ''),
      auth: {
        type: 'bearer',
        accessTokenEnv: credentialRef(source.auth.accessTokenEnv),
        ...refresh === undefined ? {} : {
          refresh: {
            type: 'firebase',
            refreshTokenEnv: credentialRef(refresh.refreshTokenEnv),
            apiKey: refresh.apiKey,
          },
        },
      },
      models,
      timeoutMs,
      retryPolicy: resolveRetryPolicy(source.retryPolicy, `llm-bearer: provider "${provider}" retryPolicy`),
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

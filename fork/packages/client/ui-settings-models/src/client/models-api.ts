/**
 * Compatibility face for the forked Models UI.
 *
 * The forked form code was intentionally kept close to the older UI contract,
 * where calls accepted one payload object and returned an RPC envelope. The
 * current application exposes the same capabilities through typed Remote
 * namespaces instead. This adapter is the only translation point: provider
 * editors, key fields, Bearer fields, and model discovery all continue to use
 * one stable local UI contract while the Host API can evolve independently.
 */

import type {
  ClientRemote,
  CredentialInfo,
  LlmConfigurableProvider,
  LlmDiscoveredModel,
  LlmProviderInfo,
  SettingsDescribeValue,
  SettingsNamespaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { JsonValue } from '@deepseek-ai/dsh-session/types'

/** Credential state exposed to the Models UI; secret values never cross here. */
export type CredentialView = CredentialInfo

/** Configurable provider row in the pre-Remote Models UI contract. */
export type ConfigurableProviderView = LlmConfigurableProvider & {
  /** Whether the provider route is currently registered and requestable. */
  active: boolean
}

/** Candidate model row returned by the discovery form. */
export type DiscoveredModelView = LlmDiscoveredModel & {
  /** Optional catalog facts added by forked discovery adapters. */
  inputModalities?: readonly string[]
  /** Optional reasoning levels added by forked discovery adapters. */
  reasoningLevels?: readonly string[]
  /** Whether a reference catalog matched the exact model id. */
  catalogMatched?: boolean
}

/** Path operation input accepted by the legacy form face. */
export type SettingsPathOpView =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'unset'; path: string[] }

/** Failure shape consumed by the existing Models form code. */
export interface ModelsError {
  code: string
  message: string
  details?: object
}

/** Result wrapper retained for the forked UI components. */
export type ModelsResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ModelsError }

/** Minimal response envelope expected by the forked form code. */
export interface ModelsResponse<T> {
  rpcId: string
  result: ModelsResult<T>
}

type SettingsWrite = {
  ns: string
  expectedRevision?: number
}

type ModelsSettings = {
  describe(payload?: Record<string, never>): Promise<ModelsResponse<SettingsDescribeValue>>
  update(payload: SettingsWrite & { patch: Record<string, unknown> }): Promise<ModelsResponse<SettingsNamespaceView>>
  replace(payload: SettingsWrite & { section: Record<string, unknown> }): Promise<ModelsResponse<SettingsNamespaceView>>
  mutate(payload: SettingsWrite & { ops: SettingsPathOpView[] }): Promise<ModelsResponse<SettingsNamespaceView>>
}

type ModelsCredentials = {
  describe(payload: { refs: string[] }): Promise<ModelsResponse<{ credentials: Record<string, CredentialView> }>>
  set(payload: { ref: string; value: string }): Promise<ModelsResponse<Record<string, never>>>
  unset(payload: { ref: string }): Promise<ModelsResponse<Record<string, never>>>
}

type ModelsLlm = {
  providers(payload: Record<string, never>): Promise<ModelsResponse<{ providers: ConfigurableProviderView[] }>>
  discoverModels(
    payload: {
      settingsNs: string
      provider?: string
      baseURL?: string
      modelsURL?: string
      api?: string
      apiKey?: string
    },
    signal?: AbortSignal,
  ): Promise<ModelsResponse<{ models: DiscoveredModelView[] }>>
}

/** Local API contract used by the forked Models components. */
export interface ModelsApi {
  settings: ModelsSettings
  credentials: ModelsCredentials
  llm: ModelsLlm
}

type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details: object } }

let responseNumber = 0

function rpcId(): string {
  responseNumber += 1
  return `models-remote-${responseNumber}`
}

function errorOf(error: unknown): ModelsError {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as { code?: unknown; message?: unknown; details?: unknown }
    return {
      code: typeof candidate.code === 'string' ? candidate.code : 'transport-error',
      message: typeof candidate.message === 'string' ? candidate.message : String(error),
      ...typeof candidate.details === 'object' && candidate.details !== null
        ? { details: candidate.details }
        : {},
    }
  }
  return { code: 'transport-error', message: String(error) }
}

async function wrap<T>(call: Promise<RemoteResult<T>>): Promise<ModelsResponse<T>> {
  try {
    const result = await call
    return result.ok
      ? { rpcId: rpcId(), result: { ok: true, value: result.value } }
      : { rpcId: rpcId(), result: { ok: false, error: result.error } }
  } catch (error) {
    return { rpcId: rpcId(), result: { ok: false, error: errorOf(error) } }
  }
}

function toJsonObject(value: Record<string, unknown>): Record<string, JsonValue> {
  return value as Record<string, JsonValue>
}

function providerDirectory(
  registered: readonly LlmProviderInfo[],
  declared: readonly LlmConfigurableProvider[],
): ConfigurableProviderView[] {
  const active = new Set(registered.map(provider => provider.id))
  const declaredIds = new Set(declared.map(provider => provider.provider))
  const rows: ConfigurableProviderView[] = declared.map(provider => ({
    ...provider,
    settingsPath: [...provider.settingsPath],
    active: active.has(provider.provider),
  }))
  for (const provider of registered) {
    if (declaredIds.has(provider.id)) continue
    rows.push({
      provider: provider.id,
      displayName: provider.name,
      settingsNs: '',
      settingsPath: [],
      active: true,
    })
  }
  return rows
}

/** Create the fork UI face over the current typed Remote service. */
export function createModelsApi(remote: ClientRemote): ModelsApi {
  return {
    settings: {
      describe: () => wrap(remote.settings.describe()),
      update: payload => wrap(remote.settings.update(
        payload.ns,
        toJsonObject(payload.patch),
        payload.expectedRevision,
      )),
      replace: payload => wrap(remote.settings.replace(
        payload.ns,
        toJsonObject(payload.section),
        payload.expectedRevision,
      )),
      mutate: payload => wrap(remote.settings.mutate(
        payload.ns,
        payload.ops as unknown as import('@deepseek-ai/dsh-api-remotes/client').SettingsPathOpView[],
        payload.expectedRevision,
      )),
    },
    credentials: {
      describe: payload => wrap(remote.credentials.describe(payload.refs)).then(response => {
        if (!response.result.ok) return response as unknown as ModelsResponse<{ credentials: Record<string, CredentialView> }>
        return { ...response, result: { ok: true, value: { credentials: response.result.value } } }
      }),
      set: payload => wrap(remote.credentials.set(payload.ref, payload.value)).then(response => {
        if (!response.result.ok) return response as unknown as ModelsResponse<Record<string, never>>
        return { ...response, result: { ok: true, value: {} } }
      }),
      unset: payload => wrap(remote.credentials.unset(payload.ref)).then(response => {
        if (!response.result.ok) return response as unknown as ModelsResponse<Record<string, never>>
        return { ...response, result: { ok: true, value: {} } }
      }),
    },
    llm: {
      providers: async () => {
        const [declared, registered] = await Promise.all([
          remote.llm.listConfigurableProviders(),
          remote.llm.listProviders(),
        ])
        if (!declared.ok) return { rpcId: rpcId(), result: { ok: false, error: declared.error } }
        if (!registered.ok) return { rpcId: rpcId(), result: { ok: false, error: registered.error } }
        return {
          rpcId: rpcId(),
          result: { ok: true, value: { providers: providerDirectory(registered.value, declared.value) } },
        }
      },
      discoverModels: (payload, signal) => wrap(remote.llm.discoverModels(
        payload.settingsNs,
        {
          ...payload.provider === undefined ? {} : { provider: payload.provider },
          // The latest upstream Client Remote still serializes only `baseURL`.
          // Mirror an exact Bearer models endpoint into that established field
          // while also retaining `modelsURL` for the fork Remote contract. The
          // fork Bearer discovery treats baseURL only as this wire-compat alias.
          ...payload.baseURL === undefined && payload.modelsURL === undefined
            ? {}
            : { baseURL: payload.baseURL ?? payload.modelsURL },
          ...payload.modelsURL === undefined ? {} : { modelsURL: payload.modelsURL },
          ...payload.api === undefined ? {} : { api: payload.api },
          ...payload.apiKey === undefined ? {} : { apiKey: payload.apiKey },
        },
        signal,
      )).then(response => {
        if (!response.result.ok) return response as unknown as ModelsResponse<{ models: DiscoveredModelView[] }>
        return {
          ...response,
          result: { ok: true, value: { models: response.result.value as DiscoveredModelView[] } },
        }
      }),
    },
  }
}

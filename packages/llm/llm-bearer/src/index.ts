/**
 * Separate Bearer-authenticated LLM plugin. It owns TwinMind routes, Firebase
 * token rotation, and the `llm-bearer` settings namespace; API-key routes stay
 * owned by `llm-pi-ai`.
 * @module @deepseek-ai/dsh-llm-bearer
 */

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type { AdapterRegistrationHandle, DirectoryRegistrationHandle, LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { BearerAdapter } from './adapter.ts'
import { BearerTokenResolver } from './bearer.ts'
import { assertServiceable, Config, resolveProfiles } from './config.ts'
import type { ResolvedBearerProviderProfile } from './config.ts'
import { discoverTwinMindModels } from './discovery.ts'

export { BearerAdapter } from './adapter.ts'
export type { BearerAdapterOptions } from './adapter.ts'
export { BearerTokenResolver } from './bearer.ts'
export type { BearerCredentialStore } from './bearer.ts'
export { Config, resolveProfiles } from './config.ts'
export type {
  BearerAuth, BearerModelProfile, BearerProviderProfile, FirebaseBearerRefresh,
  ResolvedBearerAuth, ResolvedBearerModelProfile, ResolvedBearerProviderProfile,
  ResolvedFirebaseBearerRefresh,
} from './config.ts'
export { discoverTwinMindModels } from './discovery.ts'

/** Cordis plugin name. */
export const name = 'llm-bearer'
/** Required LLM registry service. */
export const inject = ['llm']

const NS = settingsNamespace('llm-bearer')

function registrationFacts(profiles: ReadonlyMap<string, ResolvedBearerProviderProfile>): unknown {
  return [...profiles.values()]
    .map(profile => ({ provider: profile.provider, displayName: profile.displayName, retryPolicy: profile.retryPolicy }))
    .sort((left, right) => left.provider.localeCompare(right.provider))
}

function directoryEntries(profiles: ReadonlyMap<string, ResolvedBearerProviderProfile>): LlmConfigurableProvider[] {
  return [...profiles.values()].map(profile => ({
    provider: profile.provider,
    displayName: profile.displayName,
    settingsNs: NS,
    settingsPath: ['providers', profile.provider],
    declared: true,
  }))
}

/**
 * Mount the Bearer route owner and its hot-reloaded settings namespace.
 * @param ctx - Cordis context providing the LLM registry and optional settings and credentials.
 * @param config - composition-layer provider profiles.
 */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  let previousRaw: Config | undefined
  let previousResolved: ReadonlyMap<string, ResolvedBearerProviderProfile> | undefined
  const profiles = (): ReadonlyMap<string, ResolvedBearerProviderProfile> => {
    const raw = current()
    if (raw === previousRaw && previousResolved !== undefined) return previousResolved
    const resolved = resolveProfiles(raw.providers)
    previousRaw = raw
    previousResolved = resolved
    return resolved
  }
  profiles()

  const tokens = new BearerTokenResolver({
    resolve: async (ref) => {
      const credentials = ctx.get('credentials')
      return credentials === undefined
        ? launchEnvironmentOf(ctx).get(ref)?.value
        : (await credentials.resolve(ref))?.value
    },
    set: async (ref, value) => {
      const credentials = ctx.get('credentials')
      if (credentials === undefined) {
        throw new Error(`llm-bearer: ${ref} cannot be rotated without the credentials service`)
      }
      await credentials.set(ref, value)
    },
  })
  const adapter = new BearerAdapter({
    profiles,
    resolveToken: profile => tokens.resolve(profile.provider, profile.auth),
  })
  ctx.llm.registerModelDiscovery(
    NS,
    request => discoverTwinMindModels(request, async () => {
      if (request.provider === undefined) return undefined
      const profile = profiles().get(request.provider)
      return profile === undefined ? undefined : tokens.resolve(request.provider, profile.auth)
    }),
  )

  let registration: AdapterRegistrationHandle | undefined
  let directory: DirectoryRegistrationHandle | undefined
  let registeredFacts: unknown
  const ensureRegistrations = (): void => {
    const facts = registrationFacts(profiles())
    if (deepEqualJson(facts, registeredFacts)) return
    const routes = [...profiles().keys()]
    if (registration === undefined) {
      if (routes.length === 0) {
        registeredFacts = facts
        return
      }
      registration = ctx.llm.registerAdapter(routes, adapter)
      directory = ctx.llm.registerConfigurableProviders(directoryEntries(profiles()))
    } else {
      registration.replace(routes)
      if (directory === undefined) throw new Error('llm-bearer: internal directory registration is missing')
      directory.replace(directoryEntries(profiles()))
    }
    registeredFacts = facts
  }
  ensureRegistrations()

  installSettingsSection(ctx, NS, Config, config, {
    validate: assertServiceable,
    setSource: (source) => { current = source },
    onChange: () => {
      try {
        ensureRegistrations()
      } catch (error) {
        ctx.logger.error('llm-bearer: keeping the previous routes after a refused update')
        ctx.logger.error(error)
      }
    },
  })
}

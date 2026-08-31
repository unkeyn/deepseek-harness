/**
 * Models settings and product-onboarding plugin, browser half. It registers
 * the Models page plus the ordered internal-testing and official-DeepSeek
 * onboarding dialogs, whose UI shares this package's modal wrapper. The Host
 * settings and credential contracts stay behind their existing wire APIs.
 * Export discipline:
 * packages/client/AGENTS.md.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer-owned Context additions (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ctx.remote merge and the forwarded-event key face
// (settings/credentials invalidations ride the allowlist) into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { ModelsSection } from './ModelsSection.tsx'
import type { ModelsPanelEntry, ModelsSectionInjected } from './ModelsSection.tsx'
import { DeepSeekOnboardingDialog } from './DeepSeekOnboardingDialog.tsx'
import type { DeepSeekOnboardingInjected } from './DeepSeekOnboardingDialog.tsx'
import { WelcomeNotice } from './WelcomeNotice.tsx'
import type { WelcomeNoticeInjected } from './WelcomeNotice.tsx'
import { decodeWelcomeSection, WelcomeNoticeStore } from './welcome-store.ts'
import { ModelsSettingsStore } from './store.ts'
import { createModelsApi } from './models-api.ts'
import { createSettingsSchemaOperations } from './schema-operations.ts'
import type { ModelsFooterOwnerProps, SettingsModelsPanelOwnerProps } from './slot-contract.ts'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { en, zh, type ModelsKey } from './locales.ts'
import { WELCOME_NOTICE_SETTINGS_NAMESPACE } from '../onboarding-copy.ts'

export type { ModelsSectionInjected, ModelsSectionProps, ModelsPanelEntry } from './ModelsSection.tsx'
export type { ModelsKey } from './locales.ts'
export type { ModelsFooterOwnerProps, SettingsModelsPanelOwnerProps } from './slot-contract.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Models page + product-onboarding copy. */
    'settings.models': ModelsKey
  }
  interface SlotMap {
    /**
     * One feature panel beside the provider list on the Models page: a list
     * contribution carrying its own id, order, and label thunk, rendered
     * behind the section's segment switcher. Declared here — the file every
     * `./client` consumer already loads — so a plugin registering a panel
     * sees the slot's type without a second import.
     */
    'settings.models.panel': { kind: 'list'; scope: 'root'; owner: SettingsModelsPanelOwnerProps }
    /**
     * Ordered extension area below the page's segment switcher: a page-wide
     * action that is not a provider row. Without a registrant the area
     * renders nothing.
     */
    'settings.models.footer': { kind: 'list'; scope: 'root'; owner: ModelsFooterOwnerProps }
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.models'
export type { ModelsSettingsState, ProviderRow } from './store.ts'

/**
 * Refetch the page snapshot only after its first load: an unopened Models
 * page must not fetch on background invalidations.
 * @param controller - the page store.
 */
export function refreshIfLoaded(controller: ModelsSettingsStore): void {
  if (controller.store.getSnapshot().status === 'idle') return
  void controller.load()
}

/**
 * Required services (cordis fiber inject). The target slot is declared by
 * ui-settings' apply, whose activation order relative to this one is NOT
 * constrained; registration depends on each slot through `slots.inject()`.
 */
export const inject = [
  'slots', 'locale', 'remote', 'remote.credentials', 'remote.llm', 'remote.settings',
  'settingsScope', 'settingsSchema',
]

/**
 * Register the Models section once the `settings.section` declaration is on
 * the ledger, wire its store to the connection, and keep it fresh on every
 * pushed invalidation (settings, credentials, or provider topology).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-models: copy dictionaries')

  const schema = createSettingsSchemaOperations(ctx.settingsSchema)
  const modelsApi = createModelsApi(ctx.remote)
  const controller = new ModelsSettingsStore(modelsApi, schema, ctx.settingsScope.describe())
  // Registration-time text (the nav label thunk) and the inject faces share
  // one bound translate; copy freshness rides the locale revision.
  const t = ctx.locale.bind(NS) as ModelsSectionInjected['t']
  // Feature panels beside the provider list (OAuth, search providers) project
  // the same way the Plugins section projects its tabs: registration order,
  // labels resolved through each contribution's own locale.
  let panelsVersion = -1
  let panelsRevision = -1
  let panels: readonly ModelsPanelEntry[] = []
  const panelsInjected = (): { hooks: Pick<ModelsSectionInjected['hooks'], 'panels'> } => ({
    hooks: {
      panels: {
        getSnapshot: () => {
          const version = ctx.slots.getVersion('settings.models.panel')
          const revision = ctx.locale.getSnapshot().revision
          if (version !== panelsVersion || revision !== panelsRevision) {
            panelsVersion = version
            panelsRevision = revision
            panels = ctx.slots.entries('settings.models.panel')
              .map(entry => ({
                /* v8 ignore next -- list-slot registration requires id */
                id: entry.options.id ?? '',
                order: entry.options.order ?? 0,
                label: resolveSlotLabel(entry.options.label) ?? '',
              }))
              .sort((a, b) => a.order - b.order)
          }
          return panels
        },
        subscribe: (listener) => {
          const offLedger = ctx.slots.subscribe('settings.models.panel', listener)
          const offLocale = ctx.locale.subscribe(listener)
          return () => {
            offLedger()
            offLocale()
          }
        },
      },
    },
  })
  const injected = (): ModelsSectionInjected => ({
    controller,
    hooks: { snapshot: controller.store, panels: panelsInjected().hooks.panels },
    api: modelsApi,
    schema,
    t,
  })
  const deepSeekOnboardingInjected = (): DeepSeekOnboardingInjected => ({
    controller,
    hooks: { models: controller.store },
    api: modelsApi,
    schema,
    t,
  })
  // The scope's own memory mode is what keeps a remote browser process-local,
  // so the store needs no isLoopback branch of its own.
  const welcomeController = new WelcomeNoticeStore(ctx.settingsScope.bind({
    namespace: WELCOME_NOTICE_SETTINGS_NAMESPACE,
    decode: decodeWelcomeSection,
  }))
  const welcomeInjected = (): WelcomeNoticeInjected => ({
    controller: welcomeController,
    hooks: { welcome: welcomeController.store },
    t,
  })

  // Pushed invalidations converge every open surface without polling. The
  // settingsScope injection makes ui-settings activate first, and remote
  // dispatch preserves listener order; its listener therefore starts the
  // mirror refresh before this store joins that refresh. The welcome notice
  // follows its settings scope, so it needs no subscription here.
  ctx.effect(() => {
    const refreshModels = (): void => { refreshIfLoaded(controller) }
    const disposers = [
      ctx.remote.$on('settings/document-updated', () => { refreshModels() }),
      ctx.remote.$on('credentials/reference-updated', refreshModels),
      ctx.remote.$on('llm/adapters-updated', refreshModels),
      ctx.on('connection/reset', refreshModels),
    ]
    return () => {
      welcomeController.dispose()
      for (const dispose of disposers) dispose()
    }
  }, 'ui-settings-models: pushed invalidations')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'models',
    order: 10,
    label: () => t('nav'),
    inject: injected,
    children: {
      // The feature panels (OAuth, search providers) that render behind the
      // page's segment switcher.
      'settings.models.panel': { kind: 'list', scope: 'root' },
      // The page-wide area below the switcher: an action that belongs to the
      // Models page rather than to one tab of it.
      'settings.models.footer': { kind: 'list', scope: 'root' },
    },
  }, ModelsSection))
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'welcome-notice',
    order: -100,
    inject: welcomeInjected,
  }, WelcomeNotice))
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'deepseek-official',
    order: 0,
    inject: deepSeekOnboardingInjected,
  }, DeepSeekOnboardingDialog))
}

/**
 * Fork-only browser add-on for the current Models page.
 *
 * The upstream Plugins section remains the owner of the Plugins navigation and
 * its current cards. This package contributes only the fork's multi-provider
 * web-search pool to the fork `settings.models.panel` seam. Keeping the
 * add-on at a seam means upstream UI changes can be adopted without copying
 * the whole settings surface again.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { CustomWebSearchPoolCard } from './CustomWebSearchPoolCard.tsx'
import { KeyPoolProviderCard } from './KeyPoolProviderCard.tsx'
import { WebSearchPoolCardController, WEB_SEARCH_POOL_NS } from './custom-web-search-pool-controller.ts'
import { en, zh, type PluginsSettingsLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Fork search-pool copy, isolated from the upstream Plugins dictionary. */
    'fork.search': PluginsSettingsLocaleKey
  }
}

const NS = 'fork.search'

// Keep the fork Models panel seam visible to this add-on's type program while
// the package-name compatibility mapping still points other imports upstream.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.models.panel': { kind: 'list'; scope: 'root'; owner: { children?: never } }
  }
}

/** Services used by the add-on: current slots, Remote, settings, credentials, and the RPC carrier. */
export const inject = [
  'slots', 'locale', 'connection', 'remote', 'remote.credentials', 'remote.settings', 'settingsScope',
]

/** Mount the fork search-pool panel into the current Models page. */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'fork web-search pool: dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const pool = new WebSearchPoolCardController(
    ctx.settingsScope.bind({ namespace: WEB_SEARCH_POOL_NS }),
    ctx.remote.credentials,
    connection.rpc,
  )
  ctx.effect(() => () => { pool.dispose() }, 'fork web-search pool: controller')
  ctx.effect(
    () => ctx.remote.$on('credentials/reference-updated', (ref) => { pool.refreshCredential(ref) }),
    'fork web-search pool: credential invalidations',
  )

  ctx.slots.inject('settings.models.panel', () => ctx.slots.register({
    name: 'settings.models.panel',
    id: 'search',
    order: 30,
    label: () => t('webSearchPoolTitle'),
    locale: NS,
    inject: () => pool.inject(),
  }, CustomWebSearchPoolCard))

  const keyPoolApi = {
    settings: ctx.remote.settings,
    credentials: ctx.remote.credentials,
  }
  ctx.slots.inject('settings.models.provider-card', function* () {
    yield ctx.slots.register({
      name: 'settings.models.provider-card',
      key: 'llm-deepseek',
      inject: () => ({ api: keyPoolApi }),
    }, KeyPoolProviderCard)
    yield ctx.slots.register({
      name: 'settings.models.provider-card',
      key: 'llm-pi-ai',
      inject: () => ({ api: keyPoolApi }),
    }, KeyPoolProviderCard)
  })
}

/**
 * Fork-only browser add-on: an API-key check at the bottom of the Models page.
 *
 * The Host plugin `llm-key-check` owns both the provider directory and the
 * probe; this half owns the paste buffer, the two lists, and the cache. It
 * registers into `settings.models.footer`, the Models page's ordered area
 * below the segment switcher, so the CHECK button sits under the provider
 * rows without this package owning a tab of its own.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the renderer-owned Context additions (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { KeyCheckController } from './key-check-controller.ts'
import { KeyCheckPanel } from './KeyCheckPanel.tsx'
import { en, zh, type KeyCheckLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Fork key-check copy, isolated from the upstream Models dictionary. */
    'fork.keycheck': KeyCheckLocaleKey
  }
}

const NS = 'fork.keycheck'

// The footer seat is declared here as well as by the fork Models page: this
// program type-checks against the upstream Models package, whose SlotMap has
// no footer key, while the mounted page is the fork one that does. The two
// declarations are the same seat and the same shape, so they merge.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Ordered extension area below the Models page's segment switcher. */
    'settings.models.footer': { kind: 'list'; scope: 'root'; owner: { children?: never } }
  }
}

/** Services used by the panel: slots, the locale plugin, and the RPC carrier. */
export const inject = ['slots', 'locale', 'connection']

/** Mount the key-check panel into the bottom of the Models page. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'fork key check: dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new KeyCheckController(connection.rpc)
  ctx.effect(() => () => { controller.dispose() }, 'fork key check: controller')

  ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
    name: 'settings.models.footer',
    id: 'key-check',
    order: 100,
    // The panel's copy lives in this package's own namespace, so the Models
    // page dictionary stays untouched by a fork-only surface.
    locale: NS,
    inject: () => controller.inject(),
  }, KeyCheckPanel))
}

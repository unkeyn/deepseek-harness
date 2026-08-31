/**
 * Fork-only OAuth panel: 3-column provider grid with a horizontal account
 * drawer underneath.
 *
 * Activation follows the same conditional pattern as `@deepseek-ai/dsh-fork-
 * client-ui-authorization`: install the authorization Remote first, then
 * register into the `settings.models.panel` slot once both `slots` and
 * `remote.authorization` (the host's `@deepseek-ai/dsh-fork-authorization-
 * controller`) are available. Hosts without that controller keep the grid
 * dormant — no deferred activation, no fallbacks.
 *
 * Hosts that opt in additionally expose `ctx.oauthGridRemote` (a partial
 * `OAuthGridRemote`) carrying `accounts.list` / `accounts.remove` and
 * `usage.fetch` channels — when those channels are absent the grid gracefully
 * degrades to a single-account view with a "Limits are reported for Anthropic
 * and the Antigravity-style providers" hint.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import authorizationRemote from '@deepseek-ai/dsh-fork-authorization-controller/remote'
import { OAuthGridCard } from './OAuthGridCard.tsx'
import {
  OAuthGridCardController,
  type OAuthGridCardFace,
  type OAuthGridCardState,
  type OAuthGridRemote,
} from './authorization-grid-controller.ts'
import { en, zh, type OAuthGridLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'fork.oauth-grid': OAuthGridLocaleKey
  }
}

const NS = 'fork.oauth-grid'

// The active fork Models overlay owns this panel seam. Keep the augmentation
// local so this add-on does not pull the whole Models source project into its
// own TypeScript program through the upstream compatibility path.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.models.panel': { kind: 'list'; scope: 'root'; owner: { children?: never } }
  }
}

/** Host-side optional sub-channel handles for per-account listing and limits. */
declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * Hosts that provide per-account listing (`accounts.list`),
     * account removal (`accounts.remove`), or live `UsageReport`s
     * (`usage.fetch`) populate this when applying the
     * `@deepseek-ai/dsh-fork-authorization-controller` adapter. When
     * undefined the grid renders the OAuth sign-in flow only.
     */
    oauthGridRemote?: OAuthGridRemote
  }
}

export const inject = ['remote']

/** Mount the OAuth Remote namespace, then attach its grid to the Models OAuth group. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(authorizationRemote)
  const ui = ctx.inject(['slots', 'locale', 'remote.authorization'], scope => {
    scope.effect(() => scope.locale.register(NS, { en, zh }), 'fork oauth-grid: dictionaries')
    const optional = scope.get('oauthGridRemote') as OAuthGridRemote | undefined
    const remote: OAuthGridRemote = {
      authorization: scope.remote.authorization,
      ...(optional?.accounts === undefined ? {} : { accounts: optional.accounts }),
      ...(optional?.usage === undefined ? {} : { usage: optional.usage }),
    }
    const controller = new OAuthGridCardController(remote)
    const face: OAuthGridCardFace = {
      useAuthorization: <T = OAuthGridCardState>(selector?: (state: OAuthGridCardState) => T): T => {
        const snapshot = controller.store.getSnapshot()
        return selector === undefined ? snapshot as T : selector(snapshot)
      },
      start: (flow, method) => controller.start(flow, method),
      answer: (attemptId, value) => controller.answer(attemptId, value),
      cancel: attemptId => controller.cancel(attemptId),
      refreshAccounts: providerKey => controller.refreshAccounts(providerKey),
      removeAccount: (providerKey, accountId) => controller.removeAccount(providerKey, accountId),
      fetchLimits: (providerKey, accountId) => controller.fetchLimits(providerKey, accountId),
    }
    scope.effect(() => () => controller.dispose(), 'fork oauth-grid: controller')
    scope.slots.inject('settings.models.panel', () => scope.slots.register({
      name: 'settings.models.panel',
      id: 'oauth-grid',
      order: 25, // sits after the original `oauth` panel (order: 20) so both can coexist.
      label: () => scope.locale.bind(NS)('title'),
      locale: NS,
      inject: () => face,
    }, OAuthGridCard))
  })
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}

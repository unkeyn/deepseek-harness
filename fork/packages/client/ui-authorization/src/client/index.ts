/** Browser OAuth panel mounted into the current Models page OAuth group. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import authorizationRemote from '@deepseek-ai/dsh-fork-authorization-controller/remote'
import { AuthorizationCard } from './AuthorizationCard.tsx'
import { AuthorizationCardController, type AuthorizationCardFace, type AuthorizationCardState } from './authorization-controller.ts'
import { en, zh, type AuthorizationLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'fork.authorization': AuthorizationLocaleKey
  }
}

const NS = 'fork.authorization'

// The active fork Models overlay owns this panel seam. Keep the augmentation
// local so this add-on does not pull the whole Models source project into its
// own TypeScript program through the upstream compatibility path.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.models.panel': { kind: 'list'; scope: 'root'; owner: { children?: never } }
  }
}

export const inject = ['remote']

/** Mount the OAuth Remote namespace, then attach its card to the Models OAuth group. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(authorizationRemote)
  const ui = ctx.inject(['slots', 'locale', 'remote.authorization'], scope => {
    scope.effect(() => scope.locale.register(NS, { en, zh }), 'fork authorization: dictionaries')
    const controller = new AuthorizationCardController(scope.remote.authorization)
    const face: AuthorizationCardFace = {
      useAuthorization: <T = AuthorizationCardState>(selector?: (state: AuthorizationCardState) => T): T => {
        const snapshot = controller.store.getSnapshot()
        return selector === undefined ? snapshot as T : selector(snapshot)
      },
      start: (flow, method) => controller.start(flow, method),
      answer: (attemptId, value) => controller.answer(attemptId, value),
      cancel: attemptId => controller.cancel(attemptId),
    }
    scope.effect(() => () => controller.dispose(), 'fork authorization: controller')
    scope.slots.inject('settings.models.panel', () => scope.slots.register({
      name: 'settings.models.panel',
      id: 'oauth',
      order: 20,
      label: () => scope.locale.bind(NS)('title'),
      locale: NS,
      inject: () => face,
    }, AuthorizationCard))
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

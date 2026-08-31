/** Package-owned invariant companion for the OAuth grid panel. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-fork-client-ui-oauth-grid'

/** Cordis companion plugin name. */
export const name = 'client-ui-oauth-grid-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** The card owns no durable state; OAuth secrets remain on the host credential service. */
const install: InvariantInstaller = () => {}

/** Register the package's no-op ownership companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

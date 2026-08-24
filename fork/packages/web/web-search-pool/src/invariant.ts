/** Package-owned invariant companion for the custom web search pool. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-fork-web-search-pool'

export const name = 'web-search-pool-invariant'
export const inject = ['invariants']

/** No runtime invariant: provider registration, settings validation, and health persistence own the observable relations. */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

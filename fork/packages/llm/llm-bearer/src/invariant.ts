/** Package-owned invariant companion for `@deepseek-ai/dsh-fork-llm-bearer`. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-fork-llm-bearer'

/** Cordis companion plugin name. */
export const name = 'llm-bearer-invariant'
/** Service required before reserving package ownership. */
export const inject = ['invariants']

/** No runtime invariant: route and credential relations are enforced at their owning registries. */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context providing the invariant registry.
 * @returns disposer for the package reservation.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */

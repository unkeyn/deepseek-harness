/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-fork-llm-key-check`.
 * @module @deepseek-ai/dsh-fork-llm-key-check/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-fork-llm-key-check'

/** Cordis companion plugin name. */
export const name = 'llm-key-check-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package owns no event stream and no mutable
 * runtime data. The directory it probes against is re-derived from the catalog
 * and the settings document on every call rather than held, so there is no
 * state here that could drift out of agreement with anything; the channel
 * registration's lifecycle belongs to the Connection service that mounts it.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */

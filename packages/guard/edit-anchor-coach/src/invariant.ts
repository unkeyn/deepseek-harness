/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-edit-anchor-coach`.
 * @module @deepseek-ai/dsh-edit-anchor-coach/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-edit-anchor-coach'

/** Cordis companion plugin name. */
export const name = 'edit-anchor-coach-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the coach is a stateless `tools/pre-execute` listener
 * whose only observable effect is the denial text of individual doomed calls —
 * there is no package-owned event stream, registry, or snapshot that an
 * independent companion could check a relationship over.
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

/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-fork-client-ui-key-check`.
 * @module @deepseek-ai/dsh-fork-client-ui-key-check/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-fork-client-ui-key-check'

/** Cordis companion plugin name. */
export const name = 'client-ui-key-check-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this is a browser-side panel whose node half owns no
 * event stream or mutable runtime data. The paste buffer and its cache are
 * browser-local scratch the user typed and can clear, and the only host
 * relationship — a check answer agreeing with the provider directory that
 * filtered the request — is pinned by the host package's own suite.
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

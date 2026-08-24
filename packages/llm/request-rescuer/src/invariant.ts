/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-request-rescuer`.
 * @module @deepseek-ai/dsh-request-rescuer/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-request-rescuer'

/** Cordis companion plugin name. */
export const name = 'request-rescuer-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the rescue budget is derived by reading back the
 * session's own `llm/retry` events under the `rescuer:` policy-key namespace,
 * so the durable log is already the authoritative, self-checking record — a
 * companion would only restate the same read.
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

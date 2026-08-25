/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-fork-agent-model-selection`.
 * @module @deepseek-ai/dsh-fork-agent-model-selection/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-fork-agent-model-selection'

/** Cordis companion plugin name. */
export const name = 'agent-model-selection-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the service is a WeakMap holder between the gateway
 * (which installs and binds refs) and selection writers. The ref behavior
 * itself — assemble-time snapshotting and request rewrite — is enforced by the
 * core `installModelSelection` contract observed through the agent-loop
 * invariants, not by this holder.
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

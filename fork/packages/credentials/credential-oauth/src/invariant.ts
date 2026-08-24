/** Package-owned invariant companion for OAuth lifecycle metadata. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-fork-credential-oauth'
export const name = 'credential-oauth-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: token secrecy and refresh ownership are private state
 * transitions; the lifecycle tests prove that snapshots contain references only.
 */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

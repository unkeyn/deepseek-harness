/** Package-owned invariant companion for the live compaction policy service. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
const PACKAGE_NAME = '@deepseek-ai/dsh-fork-compaction-policy'
export const name = 'compaction-policy-invariant'
export const inject = ['invariants']
/** No runtime invariant: the service owns only a settings-backed scalar policy. */
const install: InvariantInstaller = () => {}
/** @param ctx - Cordis context carrying the invariant service. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

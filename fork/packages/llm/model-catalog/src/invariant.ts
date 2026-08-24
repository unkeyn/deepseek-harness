/** Package-owned invariant companion for the model catalog service. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-fork-model-catalog'
export const name = 'model-catalog-invariant'
export const inject = ['invariants']

/** No runtime invariant: the catalog is reference data whose only mutation is the one startup refresh. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

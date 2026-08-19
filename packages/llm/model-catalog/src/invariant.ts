/** Package-owned invariant companion for the model catalog service. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-model-catalog'
export const name = 'model-catalog-invariant'
export const inject = ['invariants']

/** No runtime invariant: the catalog is immutable reference data without event state. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

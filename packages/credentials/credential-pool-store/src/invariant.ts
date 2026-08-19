import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-credential-pool-store'
export const name = 'credential-pool-store-invariant'
export const inject = ['invariants']

/** No runtime invariant: snapshot validation and persistence races are provider-owned and tested at the storage boundary. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

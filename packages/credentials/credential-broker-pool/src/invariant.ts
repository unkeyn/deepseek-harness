import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
const PACKAGE_NAME = '@deepseek-ai/dsh-credential-broker-pool'
export const name = 'credential-broker-pool-invariant'
export const inject = ['invariants']
/** No runtime invariant: live lease counters are provider-private and tested through acquire/complete behavior. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

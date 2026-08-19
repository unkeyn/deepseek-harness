/** Package-owned invariant companion for the credential broker seam. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-credential-broker'
export const name = 'credential-broker-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: lease ownership and exactly-once completion are
 * implementation-owned state transitions; providers prove them in their
 * lifecycle suites without exposing live broker objects to this companion.
 */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

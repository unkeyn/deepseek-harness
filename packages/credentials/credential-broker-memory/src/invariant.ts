import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-credential-broker-memory'
export const name = 'credential-broker-memory-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: memory provider state is private and its lease
 * transitions are covered by the provider lifecycle suite.
 */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

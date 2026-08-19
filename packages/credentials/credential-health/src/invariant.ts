import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
const PACKAGE_NAME = '@deepseek-ai/dsh-credential-health'
export const name = 'credential-health-invariant'
export const inject = ['invariants']
/** No runtime invariant: classifiers are pure provider-owned policy functions pinned by their evidence matrix tests. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

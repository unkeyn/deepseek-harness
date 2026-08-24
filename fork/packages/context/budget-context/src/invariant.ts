/** Package-owned invariant companion for the budget-context plugin. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-fork-budget-context'
export const name = 'budget-context-invariant'
export const inject = ['invariants']
/**
 * No runtime invariant: the plugin owns no durable events of its own — its note
 * rides the system-prompt runtime-context snapshot, whose durability and
 * replacement pairing the agent-loop invariants already validate.
 */
const install: InvariantInstaller = () => {}
/** @param ctx - Cordis context carrying the invariant service. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

/** Package-owned invariant companion for the optional Bearer MCP bridge. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-fork-llm-bearer-mcp-bridge'

export const name = 'llm-bearer-mcp-bridge-invariant'
export const inject = ['invariants']

const install: InvariantInstaller = () => {}

/** Register the bridge's package invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))

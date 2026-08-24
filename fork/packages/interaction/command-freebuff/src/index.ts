/** Human-facing device-code login command for the Freebuff OAuth provider. */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type {
  FreebuffDeviceLoginOptions,
  FreebuffDeviceLoginResult,
  FreebuffOAuthService,
} from '@deepseek-ai/dsh-fork-credential-freebuff-oauth'

export const name = 'command-freebuff'
export const inject = ['commands', 'freebuffOAuth']

const USAGE = 'Usage: /freebuff-login [wait]'

/** Minimal OAuth service surface consumed by the command and its tests. */
export interface FreebuffLoginService {
  /** Start a device login and return the browser challenge. */
  beginLogin(options?: Pick<FreebuffDeviceLoginOptions, 'fingerprintId'>): Promise<FreebuffDeviceLoginResult['challenge']>
  /** Poll the retained challenge and persist the resulting token. */
  completePendingLogin(options?: Omit<FreebuffDeviceLoginOptions, 'fingerprintId'>): Promise<FreebuffDeviceLoginResult>
}

/** Execute one `/freebuff-login` command invocation. */
export async function executeFreebuffLoginCommand(
  service: FreebuffLoginService,
  invocation: Pick<CommandInvocation, 'rawInput' | 'signal'>,
): Promise<CommandResult> {
  const action = invocation.rawInput.trim()
  if (action !== '' && action !== 'wait') return { kind: 'error', text: USAGE }
  try {
    if (action === 'wait') {
      const result = await service.completePendingLogin({ signal: invocation.signal })
      return { kind: 'success', text: `Freebuff login completed for account ${result.account.accountId}.` }
    }
    const challenge = await service.beginLogin()
    return {
      kind: 'success',
      text: `Open ${challenge.loginUrl} in a browser, approve the device login, then run /freebuff-login wait.`,
    }
  } catch (error: unknown) {
    return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
  }
}

/** Register `/freebuff-login` in the shared command registry. */
export function apply(ctx: Context): void {
  const service = ctx.get('freebuffOAuth') as FreebuffOAuthService | undefined
  if (service === undefined) throw new Error('command-freebuff requires credential-freebuff-oauth')
  ctx.commands.register({
    name: 'freebuff-login',
    description: 'sign in to Freebuff for free models',
    input: { hint: '[wait]' },
    recordInput: false,
    handler: invocation => executeFreebuffLoginCommand(service, invocation),
  })
}

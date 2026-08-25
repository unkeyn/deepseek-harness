/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-fork-agent-modes`.
 * @module @deepseek-ai/dsh-fork-agent-modes/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

const PACKAGE_NAME = '@deepseek-ai/dsh-fork-agent-modes'

/** Cordis companion plugin name. */
export const name = 'agent-modes-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Every roster mode identifier a durable event may carry. */
const MODES = ['default', 'smol', 'big', 'agents', 'design', 'code', 'revisor', 'scout']

function validateEvent(event: SessionEvent, fail: (message: string) => void): void {
  if (event.type === 'agent-mode/selected') {
    const mode = (event.data as { mode?: unknown }).mode
    if (typeof mode !== 'string' || !MODES.includes(mode)) {
      fail(`agent-mode/selected carries invalid mode ${JSON.stringify(mode)}; expected one of ${MODES.join(', ')}`)
    }
    return
  }
  if (event.type === 'agent-mode/angel') {
    const enabled = (event.data as { enabled?: unknown }).enabled
    if (typeof enabled !== 'boolean') {
      fail(`agent-mode/angel carries invalid enabled state ${JSON.stringify(enabled)}; expected a boolean`)
    }
  }
}

/** Validate both durable agent-mode events on loaded and newly appended records. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: (message: string) => void) => {
  const seed = (session: Session): void => {
    for (const event of session.events) validateEvent(event, fail)
  }
  for (const session of ctx.sessions.list()) seed(session)
  ctx.on('session/created', (session) => { seed(session) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [, event] = args as [Session, SessionEvent]
    validateEvent(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */

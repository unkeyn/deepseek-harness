/**
 * Reasoning presentation plugin, browser half: the ThinkRow presenter for the
 * `conversation.chat.reasoning` seat declared by ui-conversation's
 * assistant-step entry. The seat renders ui-conversation's built-in Think row
 * as its fallback, so composing this plugin out restores the baseline
 * presentation — this package only upgrades it.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the reasoning seat) and
// the ReasoningOwnerProps owner type.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ThinkRow } from './ThinkRow.tsx'

/** Required services: the slot registry the seat lives in. */
export const inject = ['slots']

/**
 * Client plugin body: register the ThinkRow presenter into the reasoning seat.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.chat.reasoning', () =>
    ctx.slots.register({ name: 'conversation.chat.reasoning' }, ThinkRow))
}

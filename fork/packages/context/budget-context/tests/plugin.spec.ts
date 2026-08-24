import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as BudgetContext from '../src/index.ts'

async function context(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt).await()
  await ctx.plugin(TokenMeter).await()
  return ctx
}

/** A session whose priced surface carries roughly `chars / 4` heuristic tokens. */
function sessionWithText(chars: number): Session {
  const session = Session.create(SessionId('budget-spec'))
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'x'.repeat(chars) }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  return session
}

/** The session:budget contribution's rendered text ('' when it contributes nothing). */
async function budgetNote(ctx: Context, session: Session): Promise<string> {
  const assembly = await ctx.systemPrompt.assemble({ agent: { session } as never })
  return assembly.contexts.find(entry => entry.name === 'session:budget')?.text ?? ''
}

describe('budget-context plugin', () => {
  it('contributes nothing without a compaction policy or a session cap', async () => {
    const ctx = await context()
    await ctx.plugin(BudgetContext).await()
    expect(await budgetNote(ctx, sessionWithText(8_000))).toBe('')
  })

  it('reports the bucketed budget once usage passes the onset and stays silent below it', async () => {
    const ctx = await context()
    ctx.provide('compactionPolicy', {
      limitTokens: (sessionId: string) => sessionId === 'budget-spec' ? 1_000 : undefined,
    })
    await ctx.plugin(BudgetContext).await()

    // ~2_000 heuristic tokens against a 1_000-token cap: saturated wording.
    const note = await budgetNote(ctx, sessionWithText(8_000))
    expect(note).toContain('about 100%')
    expect(note).toContain('1000-token cap')

    // A different session without a cap renders nothing.
    expect(await budgetNote(ctx, Session.create(SessionId('other')))).toBe('')
  })

  it('honors the configured onset', async () => {
    const ctx = await context()
    ctx.provide('compactionPolicy', { limitTokens: () => 10_000 })
    await ctx.plugin(BudgetContext, { adviseFromPercent: 90 }).await()

    // ~2_000 of 10_000 tokens = 20%: below this plugin's 90% onset.
    expect(await budgetNote(ctx, sessionWithText(8_000))).toBe('')
  })
})

// @vitest-environment jsdom
// ui-reasoning browser half on a real cordis Context: the plugin registers
// the ThinkRow presenter into the conversation.chat.reasoning seat declared
// by ui-conversation's assistant-step entry, and registration disposal rides
// the plugin fiber (HMR safety). The node half and the invariant companion
// are exercised over the same Context.
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'conversation.chat.reasoning': { kind: 'single', scope: 'session' } },
  } as never, (() => null) as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return {
    fiber,
    entry: () => ctx.slots.entries('conversation.chat.reasoning')[0],
  }
}

describe('ui-reasoning browser plugin', () => {
  it('registers the ThinkRow presenter into the reasoning seat', async () => {
    const b = await bench()
    expect(b.entry()).toBeDefined()
  })

  it('drops the seat entry when the plugin fiber unloads (HMR safety)', async () => {
    const b = await bench()
    expect(b.entry()).toBeDefined()
    await b.fiber.dispose()
    expect(b.entry()).toBeUndefined()
  })
})

describe('ui-reasoning node half', () => {
  // The invariant companion is mounted by the vitest-wide invariant host on
  // every Context this suite creates; its registration is covered there.
  it('the node apply is an inert loader seat', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})

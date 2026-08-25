/** `AgentModelSelections` registry semantics: bind, lookup, and replacement. */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import AgentModelSelections from '../src/index.ts'

function fakeAgent(id: string): Agent {
  return { id } as unknown as Agent
}

function ref(current: ModelSelectionRef['current']): ModelSelectionRef {
  return { current, assembled: undefined }
}

describe('AgentModelSelections', () => {
  it('publishes the ref a gateway installed so writers reach the same object', async () => {
    const ctx = new Context()
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    await ctx.plugin(AgentModelSelections)
    const agent = fakeAgent('s1')
    const installed = ref({ provider: 'p', model: 'm' })
    ctx.agentModelSelections.bind(agent, installed)
    expect(ctx.agentModelSelections.for(agent)).toBe(installed)
    // Writes through the published ref are visible to the gateway's own copy.
    ctx.agentModelSelections.for(agent)!.current = { provider: 'p2', model: 'm2' }
    expect(installed.current).toEqual({ provider: 'p2', model: 'm2' })
  })

  it('keeps agents independent and reports unbound agents as undefined', async () => {
    const ctx = new Context()
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    await ctx.plugin(AgentModelSelections)
    const first = fakeAgent('s1')
    const second = fakeAgent('s2')
    ctx.agentModelSelections.bind(first, ref(undefined))
    expect(ctx.agentModelSelections.for(second)).toBeUndefined()
    expect(ctx.agentModelSelections.for(first)).not.toBeUndefined()
  })

  it('re-binding replaces the published ref for the same agent', async () => {
    const ctx = new Context()
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    await ctx.plugin(AgentModelSelections)
    const agent = fakeAgent('s1')
    const original = ref(undefined)
    const replacement = ref({ provider: 'p', model: 'm' })
    ctx.agentModelSelections.bind(agent, original)
    ctx.agentModelSelections.bind(agent, replacement)
    expect(ctx.agentModelSelections.for(agent)).toBe(replacement)
  })

  it('keys refs by agent identity, so a disposed agent leaves no stale lookup', async () => {
    const ctx = new Context()
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    await ctx.plugin(AgentModelSelections)
    const agent = fakeAgent('s1')
    ctx.agentModelSelections.bind(agent, ref(undefined))
    const twin = fakeAgent('s1')
    expect(ctx.agentModelSelections.for(twin)).toBeUndefined()
  })

  it('expose the deployment default model for fallback writers', async () => {
    const ctx = new Context()
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'dp', model: 'dm' }) } as never)
    await ctx.plugin(AgentModelSelections)
    expect(ctx.agentModelSelections.deploymentDefault()).toEqual({ provider: 'dp', model: 'dm' })
  })
})

/**
 * Agent-mode controller behavior: model-driven routing tool, mode delegation
 * subtypes over the subagent seam, settings-driven model and instruction
 * assignments, angel companion, commands, projection, and the durable folds.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'
import LlmRuntime, { LlmAdapter, ReasoningEffortId } from '@deepseek-ai/dsh-fork-llm'
import type { ContentBlock, GenerateOptions, LlmModelReasoningInfo, LlmResolvedModelInfo, StreamChunk, UserMessage } from '@deepseek-ai/dsh-fork-llm'
import { createUserMessage } from '@deepseek-ai/dsh-fork-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import {
  AgentModeController, AGENT_MODE_ASSIGNMENTS_NAMESPACE, ROUTED_MODES, foldAngel, foldSelected, resolveInstruction,
} from '../src/index.ts'
import { ANGEL_INSTRUCTION, BUILTIN_ROLE_INSTRUCTIONS } from '../src/instructions.ts'

class ScriptedAdapter extends LlmAdapter {
  lastOptions: GenerateOptions | undefined

  constructor(
    private readonly blocks: readonly ContentBlock[],
    private readonly reason: (StreamChunk & { type: 'finish' })['reason'] = { kind: 'stop' },
    private readonly reasoning?: LlmModelReasoningInfo,
  ) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      ...this.reasoning === undefined ? {} : { reasoning: this.reasoning },
    })
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.lastOptions = options
    for (const [index, block] of this.blocks.entries()) {
      yield { type: 'block-start', index, blockType: block.type }
      if (block.type === 'text') yield { type: 'text-delta', index, text: block.text }
      else yield { type: 'block-end', index, block }
    }
    yield { type: 'finish', reason: this.reason }
  }
}

const REASONING: LlmModelReasoningInfo = {
  efforts: [
    { id: ReasoningEffortId('off'), name: 'Off' },
    { id: ReasoningEffortId('high'), name: 'High' },
  ],
  defaultEffort: ReasoningEffortId('high'),
}

interface ToolDefinitionStub {
  name: string
  execute: (args: never, exec: never) => Promise<unknown>
}

interface Harness {
  ctx: Context
  session: Session
  agent: Agent
  inject: ReturnType<typeof vi.fn>
  ref: { current: ModelSelection | undefined; assembled: ModelSelection | undefined }
  commandsRegister: ReturnType<typeof vi.fn>
  projectionRegister: ReturnType<typeof vi.fn>
  toolsRegister: ReturnType<typeof vi.fn>
  subagentsStart: ReturnType<typeof vi.fn>
  setAssignments: (models: Record<string, { provider: string; model: string; reasoningEffort?: string }>, instructions: Record<string, string>) => void
  adapter: ScriptedAdapter
}

async function harness(config: ConstructorParameters<typeof AgentModeController>[1], options: { gateway?: boolean } = {}): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(AgentRegistry)
  const adapter = new ScriptedAdapter([{ type: 'text', text: 'independent take' }])
  ctx.llm.registerAdapter(['angel-p'], adapter)
  // Slot targets resolve through the live registry, so their providers need adapters too.
  ctx.llm.registerAdapter(['p', 'pb'], new ScriptedAdapter([], { kind: 'stop' }, REASONING))
  const ref = { current: undefined as ModelSelection | undefined, assembled: undefined as ModelSelection | undefined }
  if (options.gateway !== false) {
    ctx.provide('agentModelSelections', {
      for: () => ref,
      bind: () => undefined,
      deploymentDefault: () => ({ provider: 'default-p', model: 'default-m' }),
    } as never)
  }
  const commandsRegister = vi.fn()
  ctx.provide('commands', { register: commandsRegister } as never)
  const projectionRegister = vi.fn()
  ctx.provide('sessionProjections', { register: projectionRegister } as never)
  const toolsRegister = vi.fn()
  ctx.provide('tools', { register: toolsRegister } as never)
  const subagentsStart = vi.fn()
  ctx.provide('subagents', {
    getProvider: (name: string) => name === 'spawn' ? { name } : undefined,
    start: subagentsStart,
  } as never)
  // Minimal settings provider: installSettingsSection registers its section
  // here, and tests mutate the live value through the returned handle.
  let assignments = { models: {}, instructions: {} }
  ctx.provide('settings', {
    register: () => ({
      get: () => assignments,
      watch: () => () => undefined,
    }),
  } as never)
  const session = ctx.sessions.create()
  const inject = vi.fn()
  const agent = {
    id: session.id,
    session,
    status: 'idle',
    ctx,
    inbox: { nextTurn: [], nextStep: [] },
    options: {},
    inject,
  } as unknown as Agent
  ctx.agents.register(agent)
  await ctx.plugin(AgentModeController, config ?? {})
  return {
    ctx,
    session,
    agent,
    inject,
    ref,
    commandsRegister,
    projectionRegister,
    toolsRegister,
    subagentsStart,
    setAssignments: (models, instructions) => { assignments = { models, instructions } },
    adapter,
  }
}

function tool(harness: Harness, name: string): { execute: (args: object, exec: object) => Promise<unknown> } {
  const definition = harness.toolsRegister.mock.calls.map(call => call[0]).find(entry => entry.name === name)
  if (definition === undefined) throw new Error(`tool ${name} not registered`)
  return definition
}

function commandHandler(harness: Harness, name: string): (invocation: { agent: Agent; rawInput: string }) => Promise<{ kind: string; text?: string }> | { kind: string; text?: string } {
  const definition = harness.commandsRegister.mock.calls.map(call => call[0]).find(entry => entry.name === name)
  if (definition === undefined) throw new Error(`command ${name} not registered`)
  return definition.handler
}

function projectionUnit(harness: Harness): { init: () => unknown; apply: (state: unknown, event: { type: string; data: unknown }) => unknown; view: (state: unknown) => unknown } {
  const definition = harness.projectionRegister.mock.calls[0]?.[0]
  if (definition === undefined) throw new Error('projection unit not registered')
  return definition
}

describe('agent-mode folds', () => {
  it('fold an empty log to the default mode with angel off', () => {
    expect(foldSelected([])).toBe('default')
    expect(foldAngel([])).toBe(false)
  })

  it('fold the last committed value of each event', () => {
    const events = [
      { type: 'agent-mode/selected', data: { mode: 'smol' } },
      { type: 'agent-mode/angel', data: { enabled: true } },
      { type: 'agent-mode/selected', data: { mode: 'code' } },
      { type: 'agent-mode/angel', data: { enabled: false } },
    ] as never[]
    expect(foldSelected(events)).toBe('code')
    expect(foldAngel(events)).toBe(false)
  })
})

describe('mode selection', () => {
  it('append the event and fall back to the deployment default when no assignment exists', async () => {
    const h = await harness({})
    await h.ctx.agentModes.select(h.agent, 'design')
    expect(h.session.events.at(-1)).toMatchObject({ type: 'agent-mode/selected', data: { mode: 'design' } })
    expect(h.ref.current).toEqual({ provider: 'default-p', model: 'default-m' })
  })

  it('apply an assigned model through the gateway selection ref', async () => {
    const h = await harness({})
    h.setAssignments({ design: { provider: 'p', model: 'design-m' } }, {})
    await h.ctx.agentModes.select(h.agent, 'design')
    expect(h.ref.current).toEqual({ provider: 'p', model: 'design-m', reasoningEffort: 'high' })
  })

  it('fall back to the deployment default when the assignment fails to resolve', async () => {
    const h = await harness({})
    h.setAssignments({ scout: { provider: 'ghost', model: 'gone' } }, {})
    const applied = await h.ctx.agentModes.select(h.agent, 'scout')
    expect(applied.model).toBe('default-p/default-m')
    expect(h.ref.current).toEqual({ provider: 'default-p', model: 'default-m' })
    expect(foldSelected(h.session.events)).toBe('scout')
  })

  it('reset to the deployment default on @default', async () => {
    const h = await harness({})
    h.ref.current = { provider: 'kept', model: 'kept' }
    await h.ctx.agentModes.select(h.agent, 'default')
    expect(h.ref.current).toEqual({ provider: 'default-p', model: 'default-m' })
  })

  it('keep the session model when no gateway registry serves the composition', async () => {
    const h = await harness({}, { gateway: false })
    h.setAssignments({ scout: { provider: 'p', model: 'scout-m' } }, {})
    const applied = await h.ctx.agentModes.select(h.agent, 'scout')
    expect(applied.model).toContain('no selection registry')
    expect(h.ref.current).toBeUndefined()
    expect(foldSelected(h.session.events)).toBe('scout')
  })
})

describe('instruction resolution', () => {
  it('fall back built-in first and config override second', () => {
    const config = { roles: { revisor: { instruction: 'custom review' } } }
    expect(resolveInstruction(config, 'code')).toBe(BUILTIN_ROLE_INSTRUCTIONS.code)
    expect(resolveInstruction(config, 'revisor')).toBe('custom review')
    expect(resolveInstruction(config, 'default')).toBe('')
  })
})

describe('routing and delegation tools', () => {
  it('register select_mode and the five mode delegation subtypes', async () => {
    const h = await harness({})
    const names = h.toolsRegister.mock.calls.map(call => call[0].name)
    expect(names).toEqual(['select_mode', ...ROUTED_MODES.map(mode => `subagent_${mode}`)])
  })

  it('select_mode commits the routed mode', async () => {
    const h = await harness({})
    await tool(h, 'select_mode').execute({ mode: 'scout' }, { agent: h.agent, signal: new AbortController().signal })
    expect(foldSelected(h.session.events)).toBe('scout')
  })

  it('select_mode rejects unknown modes', async () => {
    const h = await harness({})
    await expect(tool(h, 'select_mode').execute({ mode: 'huge' }, { agent: h.agent, signal: new AbortController().signal })).rejects.toThrow(/unknown mode/)
  })

  it('delegate with the mode instruction preamble and assigned model', async () => {
    const h = await harness({})
    h.setAssignments(
      { scout: { provider: 'p', model: 'scout-m' } },
      { scout: 'Custom scout instruction.' },
    )
    h.subagentsStart.mockResolvedValue({
      id: 'child',
      result: Promise.resolve({ output: [{ type: 'text', text: 'found it' }], stopReason: 'completed' }),
      dispose: vi.fn(),
    })
    const result = await tool(h, 'subagent_scout').execute(
      { description: 'map the repo', prompt: 'list the packages' },
      { agent: h.agent, signal: new AbortController().signal },
    ) as { result: string }
    expect(result.result).toBe('found it')
    const request = h.subagentsStart.mock.calls[0][1] as { label: string; prompt: ContentBlock[]; agentOptions?: { provider: string; model: string } }
    expect(request.label).toBe('map the repo')
    expect(request.prompt.some(block => block.type === 'text' && block.text.includes('Custom scout instruction.'))).toBe(true)
    expect(request.prompt.some(block => block.type === 'text' && block.text.includes('list the packages'))).toBe(true)
    expect(request.agentOptions).toEqual({ provider: 'p', model: 'scout-m' })
  })

  it('delegate without preamble or model when nothing is assigned', async () => {
    const h = await harness({})
    h.subagentsStart.mockResolvedValue({
      id: 'child',
      result: Promise.resolve({ output: [{ type: 'text', text: 'done' }], stopReason: 'completed' }),
      dispose: vi.fn(),
    })
    await tool(h, 'subagent_default').execute(
      { description: 'general', prompt: 'do the thing' },
      { agent: h.agent, signal: new AbortController().signal },
    )
    const request = h.subagentsStart.mock.calls[0][1] as { prompt: ContentBlock[]; agentOptions?: unknown }
    expect(request.prompt).toHaveLength(1)
    expect(request.agentOptions).toBeUndefined()
  })

  it('surface abnormal subagent endings as tool failures', async () => {
    const h = await harness({})
    h.subagentsStart.mockResolvedValue({
      id: 'child',
      result: Promise.resolve({ output: [], stopReason: 'error', diagnostic: 'provider offline' }),
      dispose: vi.fn(),
    })
    await expect(tool(h, 'subagent_revisor').execute(
      { description: 'examine', prompt: 'check it' },
      { agent: h.agent, signal: new AbortController().signal },
    )).rejects.toThrow(/provider offline/)
  })
})

describe('angel toggle', () => {
  it('refuses to enable without angel config', async () => {
    const h = await harness({})
    expect(() => h.ctx.agentModes.setAngel(h.agent, true)).toThrow(/not configured/)
    expect(h.session.events.some(event => event.type === 'agent-mode/angel')).toBe(false)
  })

  it('commits the toggle when configured', async () => {
    const h = await harness({ angel: { provider: 'angel-p', model: 'angel-m' } })
    h.ctx.agentModes.setAngel(h.agent, true)
    expect(foldAngel(h.session.events)).toBe(true)
  })
})

describe('commands', () => {
  it('select a mode and report the assigned model', async () => {
    const h = await harness({})
    h.setAssignments({ design: { provider: 'p', model: 'design-m' } }, {})
    const handler = commandHandler(h, 'mode')
    const result = await handler({ agent: h.agent, rawInput: ' design ' })
    expect(result).toMatchObject({ kind: 'success' })
    expect(result.text).toContain('p/design-m')
    expect(foldSelected(h.session.events)).toBe('design')
  })

  it('reject unknown modes and bad angel arguments', async () => {
    const h = await harness({ angel: { provider: 'angel-p', model: 'angel-m' } })
    const mode = commandHandler(h, 'mode')
    await expect(mode({ agent: h.agent, rawInput: 'nope' })).resolves.toMatchObject({ kind: 'error' })
    const angel = commandHandler(h, 'angel')
    expect(angel({ agent: h.agent, rawInput: 'maybe' })).toMatchObject({ kind: 'error' })
  })

  it('toggle angel with explicit and bare arguments', async () => {
    const h = await harness({ angel: { provider: 'angel-p', model: 'angel-m' } })
    const angel = commandHandler(h, 'angel')
    await angel({ agent: h.agent, rawInput: 'on' })
    expect(foldAngel(h.session.events)).toBe(true)
    await angel({ agent: h.agent, rawInput: '' })
    expect(foldAngel(h.session.events)).toBe(false)
    await angel({ agent: h.agent, rawInput: 'off' })
    expect(foldAngel(h.session.events)).toBe(false)
  })
})

describe('the angel companion', () => {
  it('answers a committed user message and injects advisory notes', async () => {
    const h = await harness({ angel: { provider: 'angel-p', model: 'angel-m', maxTokens: 100 } })
    h.session.append('agent-mode/angel', { enabled: true })
    h.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'refactor the parser' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await vi.waitFor(() => expect(h.inject).toHaveBeenCalledTimes(1))
    const injected = h.inject.mock.calls[0][0] as UserMessage
    expect(JSON.stringify(injected.content)).toContain('Angel companion notes')
    expect(JSON.stringify(injected.content)).toContain('independent take')
    expect(h.adapter.lastOptions).toMatchObject({ provider: 'angel-p', model: 'angel-m', maxTokens: 100 })
    expect(h.adapter.lastOptions?.system).toBe(ANGEL_INSTRUCTION)
  })

  it('ignore plugin-sourced messages and disabled sessions', async () => {
    const h = await harness({ angel: { provider: 'angel-p', model: 'angel-m' } })
    h.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'not for angel' }],
      source: { kind: 'plugin', plugin: 'elsewhere' },
    }), { surfaceOp: 'append' })
    h.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'angel is off' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    await new Promise(resolve => { setTimeout(resolve, 20) })
    expect(h.adapter.lastOptions).toBeUndefined()
    expect(h.inject).not.toHaveBeenCalled()
  })

  it('drop the answer when the toggle turned off while asking', async () => {
    const h = await harness({ angel: { provider: 'angel-p', model: 'angel-m' } })
    h.session.append('agent-mode/angel', { enabled: true })
    h.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'late question' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    h.session.append('agent-mode/angel', { enabled: false })
    await vi.waitFor(() => expect(h.adapter.lastOptions).toBeDefined())
    await new Promise(resolve => { setTimeout(resolve, 20) })
    expect(h.inject).not.toHaveBeenCalled()
  })
})

describe('the agentMode projection unit', () => {
  it('fold committed events into the wire value', async () => {
    const h = await harness({})
    const unit = projectionUnit(h)
    let state = unit.init()
    expect(unit.view(state)).toEqual({ selected: 'default', angel: false })
    state = unit.apply(state, { type: 'agent-mode/selected', data: { mode: 'design' } })
    state = unit.apply(state, { type: 'agent-mode/angel', data: { enabled: true } })
    expect(unit.view(state)).toEqual({ selected: 'design', angel: true })
    const before = state
    state = unit.apply(state, { type: 'user/message', data: {} })
    expect(state).toBe(before)
  })
})

describe('load-time validation', () => {
  it('reject an angel without endpoints', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(AgentRegistry)
    await expect(ctx.plugin(AgentModeController, { angel: { provider: ' ', model: 'm' } })).rejects.toThrow(/Angel needs/)
  })

  it('reject an empty delegation provider', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(AgentRegistry)
    await expect(ctx.plugin(AgentModeController, { delegationProvider: ' ' })).rejects.toThrow(/delegationProvider/)
  })

  it('register the assignments settings namespace', async () => {
    const h = await harness({})
    void h
    expect(AGENT_MODE_ASSIGNMENTS_NAMESPACE).toBe('agent-mode-assignments')
  })
})

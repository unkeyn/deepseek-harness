/**
 * Agent modes: a per-session roster of specialized working modes the MODEL
 * selects for itself, with user-assigned models and custom instructions.
 *
 * The roster — `default`, `agents`, `design`, `revisor`, `scout` (+ legacy
 * `smol`/`big`/`code` ids still valid in old logs) — is not a manual picker.
 * The model calls `select_mode` at the start of a task that fits a mode
 * (scout: fast codebase exploration; revisor: careful examination and
 * information gathering; design: design work; agents: multi-subagent
 * coordination; default: everything else), and `subagent_<mode>` tools
 * delegate work to mode subtypes. The user assigns each mode its model and
 * optional custom instruction through the composer menu, persisted in the
 * `agent-mode-assignments` settings namespace — no config file required;
 * `roles.*.instruction` stays as a static fallback.
 *
 * Durable state is log-only: `agent-mode/selected` and `agent-mode/angel`
 * are whole-value-replace `SessionEventMap` members, so resume, fork, and
 * replay recover state from the log alone.
 *
 * @module @deepseek-ai/dsh-fork-agent-modes
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelection } from '@deepseek-ai/dsh-agent'
// Type-only edges: the optional command and projection children resolve these
// services when the composition mounts them.
import type {} from '@deepseek-ai/dsh-commands'
// Type-only edge: the `ctx.agentModelSelections` Context merge (mode writes go
// through the gateway-installed selection refs).
import type {} from '@deepseek-ai/dsh-fork-agent-model-selection'
import { BlockAssembler, boundContextSummary, createAssistantMessage, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-fork-llm'
import type { ContentBlock, GenerateOptions, LlmRuntime, Message, TextBlock } from '@deepseek-ai/dsh-fork-llm'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SubagentRun } from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
// Type-only edge: the `ctx.sessionProjections` child resolves when mounted.
import type {} from '@deepseek-ai/dsh-session-projection'
// Type-only edge: the `ctx.systemPrompt` Context merge.
import type {} from '@deepseek-ai/dsh-system-prompt'
import z from '@deepseek-ai/schemastery'
import { z as zod, type ZodType } from 'zod'
import { ANGEL_INSTRUCTION, BUILTIN_ROLE_INSTRUCTIONS } from './instructions.ts'
import type { AgentModeId, AgentModeProjection, RoutedModeId } from './types.ts'

export type { AgentModeId, AgentModeProjection, RoleModeId, RoutedModeId } from './types.ts'

/** The fixed mode roster (legacy ids stay valid in old logs and commands). */
export const AGENT_MODES = ['default', 'smol', 'big', 'agents', 'design', 'code', 'revisor', 'scout'] as const satisfies readonly AgentModeId[]

/** The modes the routing surface exposes (composer menu and select_mode). */
export const ROUTED_MODES = ['default', 'agents', 'design', 'revisor', 'scout'] as const satisfies readonly RoutedModeId[]

/** @returns whether `value` names a roster mode. */
export function isAgentModeId(value: string): value is AgentModeId {
  return (AGENT_MODES as readonly string[]).includes(value)
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * The session's selected agent mode from this point on: log-only,
     * whole-value replace. The last event wins; a log with none folds to
     * `default` through {@link foldSelected}.
     */
    'agent-mode/selected': { mode: AgentModeId }
    /**
     * Whether the angel companion answers alongside the main model from this
     * point on: log-only, whole-value replace. The last event wins; a log
     * with none folds to `false` through {@link foldAngel}.
     */
    'agent-mode/angel': { enabled: boolean }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The agent-mode controller: model-driven routing, instructions, angel. */
    agentModes: AgentModeController
  }
}

/** One role mode's static instruction fallback (the UI assignment wins). */
export interface RoleConfig {
  /** Instruction replacing the role's built-in wholesale. */
  instruction?: string
}

/** The angel companion's deployment configuration. */
export interface AngelConfig {
  /** Registered provider route the companion calls. */
  provider: string
  /** Provider-owned model id the companion calls. */
  model: string
  /** System prompt replacing the built-in angel instruction. */
  instruction?: string
  /** Optional token cap for one companion answer. */
  maxTokens?: number
  /** User/assistant messages of recent history the companion sees. @default 8 */
  historyMessages?: number
}

/** Plugin configuration. Unknown or invalid values fail at load. */
export interface AgentModesConfig {
  /** Static instruction fallbacks; the settings assignments override them. */
  roles?: {
    agents?: RoleConfig
    design?: RoleConfig
    revisor?: RoleConfig
    scout?: RoleConfig
  }
  /** The angel companion; absent config keeps the toggle off with a clear error. */
  angel?: AngelConfig
  /** The `ctx.subagents` provider name the mode delegation tools start on. @default 'spawn' */
  delegationProvider?: string
}

const roleSchema: z<RoleConfig> = z.object({
  instruction: z.string(),
})

/** Default recent-history window for one angel answer. */
const DEFAULT_ANGEL_HISTORY_MESSAGES = 8

/** Default delegation provider, matching the base composition's tool-subagent row. */
const DEFAULT_DELEGATION_PROVIDER = 'spawn'

/** Settings namespace carrying the user's per-mode model and instruction assignments. */
export const AGENT_MODE_ASSIGNMENTS_NAMESPACE = settingsNamespace('agent-mode-assignments')

/** One mode's assigned model. */
export interface ModeModelAssignment {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Optional adapter-owned reasoning effort selected with the pair. */
  reasoningEffort?: string
}

/** The user's per-mode assignments, edited from the composer menu. */
export interface ModeAssignments {
  /** Mode id → assigned model. */
  models: Record<string, ModeModelAssignment>
  /** Mode id → custom instruction replacing the built-in wholesale. */
  instructions: Record<string, string>
  /** Named snapshots of a full models+instructions configuration. */
  presets: Record<string, ModeAssignmentsSnapshot>
}

/** A named preset: one complete models+instructions configuration. */
export interface ModeAssignmentsSnapshot {
  models: Record<string, ModeModelAssignment>
  instructions: Record<string, string>
}

const MODE_MODEL_SCHEMA: z<ModeModelAssignment> = z.object({
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string(),
})

const SNAPSHOT_SCHEMA: z<ModeAssignmentsSnapshot> = z.object({
  models: z.dict(MODE_MODEL_SCHEMA),
  instructions: z.dict(z.string()),
})

/** Schema of the agent-mode assignments settings section. */
export const AGENT_MODE_ASSIGNMENTS_SCHEMA: z<ModeAssignments> = z.object({
  models: z.dict(MODE_MODEL_SCHEMA),
  instructions: z.dict(z.string()),
  presets: z.dict(SNAPSHOT_SCHEMA),
})

/** Schemastery validation for {@link AgentModesConfig}. */
export const Config: z<AgentModesConfig> = z.object({
  roles: z.object({
    agents: roleSchema,
    design: roleSchema,
    revisor: roleSchema,
    scout: roleSchema,
  }),
  angel: z.object({
    provider: z.string(),
    model: z.string(),
    instruction: z.string(),
    maxTokens: z.number().step(1).min(1),
    historyMessages: z.number().step(1).min(1),
  }),
  delegationProvider: z.string(),
})

/**
 * Fold the session's selected mode: the last `agent-mode/selected` wins,
 * `default` before the first.
 * @param events - the session's durable events.
 * @returns the folded mode id.
 */
export function foldSelected(events: readonly SessionEvent[]): AgentModeId {
  let selected: AgentModeId = 'default'
  for (const event of events) {
    if (event.type === 'agent-mode/selected') selected = event.data.mode
  }
  return selected
}

/**
 * Fold the session's angel toggle: the last `agent-mode/angel` wins, off
 * before the first.
 * @param events - the session's durable events.
 * @returns whether the companion is enabled.
 */
export function foldAngel(events: readonly SessionEvent[]): boolean {
  let enabled = false
  for (const event of events) {
    if (event.type === 'agent-mode/angel') enabled = event.data.enabled
  }
  return enabled
}

/** The projection unit's fold state; the wire value is the state itself. */
type AgentModeUnitState = AgentModeProjection

const agentModeProjectionSchema: ZodType<AgentModeProjection> = zod.object({
  selected: zod.enum(AGENT_MODES),
  angel: zod.boolean(),
})

/** The angel configuration with its default applied. */
type ResolvedAngelConfig = Omit<AngelConfig, 'historyMessages'> & { historyMessages: number }

/** The detached config the controller reads. */
interface ResolvedAgentModesConfig {
  roles: { agents?: RoleConfig; design?: RoleConfig; revisor?: RoleConfig; scout?: RoleConfig }
  angel: ResolvedAngelConfig | undefined
  delegationProvider: string
}

/** Model-facing routing guidance, rendered on every request. */
const ROUTING_SECTION = [
  'Mode routing: when a task clearly fits a specialized mode, call select_mode once at its start.',
  '- scout: fast, read-only exploration of the codebase ("where is everything").',
  '- revisor: careful examination - finding, collecting, and verifying information.',
  '- design: user-facing design work.',
  '- agents: work coordinated across several subagent delegations.',
  '- default: general work; no call needed. Return to default when specialized work ends.',
  'Each mode carries a user-configured model and instruction; the subagent_<mode> tools delegate work to a mode subtype.',
].join('\n')

/** One-line model-facing purpose of each mode delegation subtype. */
const DELEGATION_DESCRIPTIONS: Record<RoutedModeId, string> = {
  default: 'Delegate a task to a general-purpose subagent (the default mode).',
  agents: 'Delegate a task to a coordination subagent that works across several delegated subtasks.',
  design: 'Delegate a design task to a subagent focused on user-facing design quality.',
  revisor: 'Delegate careful examination to a subagent that finds, collects, and verifies information.',
  scout: 'Delegate fast, read-only codebase exploration to a scout subagent.',
  code: 'Delegate an implementation task to a code-focused subagent.',
}

/**
 * The `ctx.agentModes` controller: model-driven mode routing, the active
 * instruction prompt section, mode subagent delegation, the `/mode` and
 * `/angel` commands, the session projection, and the angel companion.
 */
export class AgentModeController extends Service {
  static inject = ['agents', 'llm', 'systemPrompt']

  static Config: z<AgentModesConfig> = Config

  private readonly config: ResolvedAgentModesConfig

  private readonly angelInflight = new Map<Session['id'], AbortController>()

  private assignmentsSource: () => ModeAssignments = () => ({ models: {}, instructions: {}, presets: {} })

  constructor(ctx: Context, config: AgentModesConfig = {}) {
    super(ctx, 'agentModes')
    this.config = resolveConfig(config)
    this.validateReferences()
    installSettingsSection(ctx, AGENT_MODE_ASSIGNMENTS_NAMESPACE, AGENT_MODE_ASSIGNMENTS_SCHEMA, { models: {}, instructions: {}, presets: {} }, {
      setSource: (current) => { this.assignmentsSource = current as () => ModeAssignments },
      onChange: () => {},
    })
    ctx.systemPrompt.section({
      name: 'agent-mode:routing',
      order: 45,
      text: ROUTING_SECTION,
    })
    ctx.systemPrompt.section({
      name: 'agent-mode:instruction',
      order: 50,
      text: (context) => {
        const agent = context.agent
        if (agent === undefined) return ''
        return this.instructionFor(foldSelected(agent.session.events))
      },
    })
    ctx.on('session/event', (session, event) => { this.onSessionEvent(session, event) })
    ctx.effect(() => () => {
      for (const controller of this.angelInflight.values()) controller.abort()
      this.angelInflight.clear()
    }, 'agent-modes: angel inflight requests')
    ctx.inject(['tools'], (toolCtx) => { this.registerRoutingTool(toolCtx) })
    ctx.inject(['tools', 'subagents'], (toolCtx) => { this.registerDelegationTools(toolCtx) })
    ctx.inject(['commands'], (commandCtx) => { this.registerCommands(commandCtx) })
    ctx.inject(['sessionProjections'], (projectionCtx) => {
      // Keep the old direct `view()` spelling on the local definition as a
      // harmless compatibility aid for fork consumers; current upstream
      // reads the nested `wire.view()` contract below.
      const definition = {
        key: 'agentMode',
        stateSchema: agentModeProjectionSchema,
        init: (): AgentModeUnitState => ({ selected: 'default', angel: false }),
        apply: (state: AgentModeUnitState, event: SessionEvent) => {
          if (event.type === 'agent-mode/selected') {
            return event.data.mode === state.selected ? state : { ...state, selected: event.data.mode }
          }
          if (event.type === 'agent-mode/angel') {
            return event.data.enabled === state.angel ? state : { ...state, angel: event.data.enabled }
          }
          return state
        },
        wire: { viewSchema: agentModeProjectionSchema, view: (state: AgentModeUnitState) => state },
        stateVersion: 1,
        view: (state: AgentModeUnitState) => state,
      } as const
      projectionCtx.sessionProjections.register<'agentMode', AgentModeUnitState>(definition)
    })
  }

  /** The session's committed mode and angel state. */
  get(agent: Agent): AgentModeProjection {
    return { selected: foldSelected(agent.session.events), angel: foldAngel(agent.session.events) }
  }

  /** The user's current per-mode assignments (live settings view). */
  assignments(): ModeAssignments {
    return this.assignmentsSource()
  }

  /**
   * Select a roster mode for the session. The mode's assigned model, when
   * one is set and resolvable, applies from the next step; an unassigned
   * mode — or one whose assignment fails to resolve — falls back to the
   * deployment default model, so a broken assignment never fails the turn.
   * @param agent - the addressed agent.
   * @param mode - the roster mode to select.
   * @returns the applied model description for tool/command surfaces.
   */
  async select(agent: Agent, mode: AgentModeId): Promise<{ model: string }> {
    const assignment = this.modelFor(mode)
    const selections = this.ctx.get('agentModelSelections')
    const ref = selections?.for(agent)
    let resolved: ModelSelection | undefined
    let note: string | undefined
    if (assignment !== undefined && ref !== undefined) {
      try {
        const call = await this.forkLlm().resolveCallConfig({
          provider: assignment.provider,
          model: assignment.model,
          ...assignment.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(assignment.reasoningEffort) },
        })
        resolved = {
          provider: call.provider,
          model: call.model,
          ...call.reasoningEffort === undefined ? {} : { reasoningEffort: call.reasoningEffort },
        }
      } catch (error: unknown) {
        // A stale assignment (unknown provider/model) must not fail the
        // routing: fall through to the deployment default like an
        // unassigned mode and say so.
        note = error instanceof Error ? error.message : String(error)
      }
    }
    if (resolved === undefined && ref !== undefined) {
      resolved = selections?.deploymentDefault()
    }
    agent.session.append('agent-mode/selected', { mode })
    if (resolved !== undefined && ref !== undefined) ref.current = resolved
    if (resolved !== undefined) {
      const effort = resolved.reasoningEffort === undefined ? '' : ` (effort ${String(resolved.reasoningEffort)})`
      return { model: `${resolved.provider}/${resolved.model}${effort}` }
    }
    return { model: note === undefined ? 'the session model (no selection registry)' : `the session model (assigned model unavailable: ${note})` }
  }

  /**
   * Enable or disable the angel companion for the session.
   * @param agent - the addressed agent.
   * @param enabled - the requested toggle state.
   * @returns the commit outcome; enabling without angel config throws.
   */
  setAngel(agent: Agent, enabled: boolean): 'committed' {
    if (enabled && this.config.angel === undefined) {
      throw new Error('Angel is not configured: set the agent-modes config angel.provider and angel.model first')
    }
    agent.session.append('agent-mode/angel', { enabled })
    return 'committed'
  }

  /** The mode's assigned model, when the user set one. */
  private modelFor(mode: AgentModeId): ModeModelAssignment | undefined {
    return this.assignmentsSource().models[mode]
  }

  /** The instruction a mode renders: settings assignment, config fallback, then built-in. */
  private instructionFor(mode: AgentModeId): string {
    return this.assignmentsSource().instructions[mode] ?? resolveInstruction(this.config, mode)
  }

  /**
   * The fork LLM runtime. The fork and official services both merge
   * `ctx.llm` and the merged property resolves to the official face here,
   * whose `Message` union predates the fork's coordinator source; the
   * composition's runtime instance is the fork row, so the call sites pin
   * the fork face to keep fork-typed messages streaming unchanged.
   */
  private forkLlm(): LlmRuntime {
    return this.ctx.llm as unknown as LlmRuntime
  }

  /** Load-time cross-reference validation beyond the per-field schema. */
  private validateReferences(): void {
    const angel = this.config.angel
    if (angel !== undefined && (angel.provider.trim() === '' || angel.model.trim() === '')) {
      throw new Error('Angel needs non-empty provider and model values')
    }
    if (this.config.delegationProvider.trim() === '') {
      throw new Error('delegationProvider needs a non-empty ctx.subagents provider name')
    }
  }

  private registerRoutingTool(toolCtx: Context): void {
    toolCtx.tools.register(defineTool({
      name: 'select_mode',
      description: 'Select the working mode for the current task. Call it once at the start of a task'
        + ' that clearly fits a specialized mode: scout (fast read-only codebase exploration),'
        + ' revisor (careful examination, finding and verifying information), design (design work),'
        + ' agents (coordination across several subagent delegations).'
        + ' General work needs no call; return to default when specialized work ends.',
      parameters: {
        mode: {
          type: 'string',
          required: true,
          description: `The mode to work in: one of ${ROUTED_MODES.join(', ')}.`,
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            selected: { type: 'string', required: true },
            model: { type: 'string', required: true },
          },
        },
        render: (_args, value) => [{
          type: 'text',
          text: `Mode "${String((value as { selected: string }).selected)}" is active from your next step, running on ${String((value as { model: string }).model)}.`,
        }],
      },
      execute: async (args, exec) => {
        const agent = exec.agent
        if (agent === undefined) throw new Error('select_mode requires a calling agent')
        const mode = args.mode.trim()
        if (!isAgentModeId(mode)) {
          throw new Error(`select_mode: unknown mode "${mode}"; available: ${ROUTED_MODES.join(', ')}`)
        }
        const applied = await this.select(agent, mode)
        return { selected: mode, model: applied.model }
      },
    }))
  }

  private registerDelegationTools(toolCtx: Context): void {
    for (const mode of ROUTED_MODES) {
      toolCtx.tools.register(defineTool({
        name: `subagent_${mode}`,
        description: DELEGATION_DESCRIPTIONS[mode],
        parameters: {
          description: {
            type: 'string',
            required: true,
            description: 'A short (3-5 word) description of the delegated task, for display.',
          },
          prompt: {
            type: 'string',
            required: true,
            description: 'The complete, self-contained task for the subagent.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              result: { type: 'string', required: true },
            },
          },
          render: (_args, value) => [{ type: 'text', text: String((value as { result: string }).result) }],
        },
        execute: async (args, exec) => this.delegate(mode, args, exec) as Promise<{ result: string }>,
      }))
    }
  }

  /** Start one mode-typed subagent on the configured provider and await its result. */
  private async delegate(
    mode: RoutedModeId,
    args: { description: string; prompt: string },
    exec: { agent?: Agent; signal: AbortSignal },
  ): Promise<{ result: string }> {
    const providerName = this.config.delegationProvider
    if (this.ctx.subagents.getProvider(providerName) === undefined) {
      throw new Error(`subagent_${mode}: no subagent provider "${providerName}" is composed`)
    }
    const agent = exec.agent
    if (agent === undefined) throw new Error(`subagent_${mode} requires a calling agent`)
    const blocks: ContentBlock[] = []
    const instruction = this.instructionFor(mode)
    if (instruction !== '') blocks.push({ type: 'text', text: `${instruction}\n\n---\n\nTask:\n\n` })
    blocks.push({ type: 'text', text: args.prompt })
    const assignment = this.modelFor(mode)
    const run: SubagentRun = await this.ctx.subagents.start(providerName, {
      label: args.description,
      prompt: blocks,
      parent: agent,
      signal: exec.signal,
      ...assignment === undefined ? {} : {
        agentOptions: {
          provider: assignment.provider,
          model: assignment.model,
        },
      },
    })
    try {
      const result = await run.result
      if (result.stopReason !== 'completed') {
        const detail = result.diagnostic === undefined ? '' : ` ${result.diagnostic}`
        throw new Error(`subagent_${mode} run ended abnormally (${result.stopReason}).${detail}`)
      }
      const text = result.output
        .filter((block): block is TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('')
        .trim()
      return { result: text === '' ? '(the subagent returned no text output)' : text }
    } finally {
      await run.dispose()
    }
  }

  private registerCommands(commandCtx: Context): void {
    commandCtx.commands.register({
      name: 'mode',
      description: 'Select the agent mode (normally the model routes itself)',
      input: { hint: `[${ROUTED_MODES.join('|')}]` },
      handler: async ({ agent, rawInput }) => {
        const name = rawInput.trim()
        if (!isAgentModeId(name)) {
          return { kind: 'error', text: `Unknown mode "${name}". Available modes: ${ROUTED_MODES.join(', ')}.` }
        }
        try {
          const applied = await this.select(agent, name)
          return { kind: 'success', text: `Mode @${name} selected — ${applied.model}.` }
        } catch (error: unknown) {
          return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
        }
      },
    })
    commandCtx.commands.register({
      name: 'angel',
      description: 'Toggle the angel companion model',
      input: { hint: '[on|off]' },
      handler: ({ agent, rawInput }) => {
        const argument = rawInput.trim()
        if (argument !== '' && argument !== 'on' && argument !== 'off') {
          return { kind: 'error', text: 'Usage: /angel [on|off].' }
        }
        const enabled = argument === '' ? !foldAngel(agent.session.events) : argument === 'on'
        try {
          this.setAngel(agent, enabled)
        } catch (error: unknown) {
          return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
        }
        return {
          kind: 'success',
          text: enabled ? 'Angel companion enabled: it answers alongside the main model.' : 'Angel companion disabled.',
        }
      },
    })
  }

  /** Angel trigger: one background companion answer per committed user message. */
  private onSessionEvent(session: Session, event: SessionEvent): void {
    if (event.type !== 'user/message') return
    if (event.data.source.kind !== 'user') return
    if (!foldAngel(session.events)) return
    const angel = this.config.angel
    if (angel === undefined) return
    const agent = this.ctx.agents.get(session.id)
    if (agent === undefined) return
    if (this.angelInflight.has(session.id)) return
    const controller = new AbortController()
    this.angelInflight.set(session.id, controller)
    void this.runAngel(agent, angel, controller.signal)
      .catch((error: unknown) => {
        this.ctx.logger.warn('dsh-fork-agent-modes: angel request failed: %o', error)
      })
      .finally(() => {
        if (this.angelInflight.get(session.id) === controller) this.angelInflight.delete(session.id)
      })
  }

  private async runAngel(agent: Agent, angel: ResolvedAngelConfig, signal: AbortSignal): Promise<void> {
    const session = agent.session
    const history = angelHistory(session, angel.historyMessages)
    if (history.length === 0) return
    const assembler = new BlockAssembler()
    const options: GenerateOptions = {
      provider: angel.provider,
      model: angel.model,
      messages: history,
      system: angel.instruction ?? ANGEL_INSTRUCTION,
      sessionId: session.id,
      signal,
      ...angel.maxTokens === undefined ? {} : { maxTokens: angel.maxTokens },
    }
    for await (const chunk of this.forkLlm().stream(options)) assembler.push(chunk)
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      throw new Error(`angel model call failed: ${finish.failure.message}`)
    }
    // Disabled or replaced while asking: the answer would arrive as a
    // surprise, so it is dropped instead of injected.
    if (signal.aborted || !foldAngel(session.events)) return
    const text = textBlocks(assembler.blocks()).map(block => block.text).join('\n').trim()
    if (text === '') return
    agent.inject(createUserMessage({
      content: [{
        type: 'text',
        text: `Angel companion notes (advisory, from ${angel.provider}/${angel.model}):\n\n${text}`,
      }],
      source: {
        kind: 'plugin',
        plugin: 'agent-modes',
        form: 'notice',
        summary: boundContextSummary(`Angel companion notes on "${lastUserExcerpt(session)}"`),
      },
    }))
  }
}

/**
 * The instruction a mode falls back to: the static config override when
 * present, the built-in role instruction otherwise, empty for modes without
 * either. The live settings assignment wins over this in the controller.
 * @param config - the plugin configuration.
 * @param mode - the active roster mode.
 * @returns the model-facing instruction text.
 */
export function resolveInstruction(config: Pick<AgentModesConfig, 'roles'>, mode: AgentModeId): string {
  if (mode === 'default' || mode === 'smol' || mode === 'big') return ''
  const override = config.roles?.[mode as 'agents' | 'design' | 'revisor' | 'scout']?.instruction
  return override ?? BUILTIN_ROLE_INSTRUCTIONS[mode]
}

/** A slot is configured only with both endpoints present (Schemastery expands absent nested objects to `{}`). */
function resolveAngel(angel: AngelConfig | undefined): ResolvedAngelConfig | undefined {
  if (angel === undefined || angel.provider === undefined || angel.model === undefined) return undefined
  return { ...angel, historyMessages: angel.historyMessages ?? DEFAULT_ANGEL_HISTORY_MESSAGES }
}

/** Load-time config resolution: detach the validated values from the caller. */
function resolveConfig(config: AgentModesConfig): ResolvedAgentModesConfig {
  return {
    roles: {
      ...config.roles?.agents === undefined ? {} : { agents: config.roles.agents },
      ...config.roles?.design === undefined ? {} : { design: config.roles.design },
      ...config.roles?.revisor === undefined ? {} : { revisor: config.roles.revisor },
      ...config.roles?.scout === undefined ? {} : { scout: config.roles.scout },
    },
    angel: resolveAngel(config.angel),
    delegationProvider: config.delegationProvider ?? DEFAULT_DELEGATION_PROVIDER,
  }
}

/** The text blocks of one content list. */
function textBlocks(content: readonly { type: string }[]): TextBlock[] {
  return content.filter((block): block is TextBlock => block.type === 'text')
}

/**
 * The companion's view of the conversation: the most recent user/assistant
 * messages rebuilt text-only, so image-only inputs and tool traffic never
 * reach a companion that may not accept them.
 */
function angelHistory(session: Session, limit: number): Message[] {
  const collected: Message[] = []
  for (const event of session.events) {
    if (event.type === 'user/message') {
      const text = textBlocks(event.data.content)
      if (text.length > 0) collected.push(createUserMessage({ content: text, source: { kind: 'user' } }))
    } else if (event.type === 'assistant/message' && event.data.interrupted !== true) {
      const text = textBlocks(event.data.message.content)
      if (text.length > 0) {
        collected.push(createAssistantMessage({
          content: text,
          source: { provider: event.data.message.source.provider, model: event.data.message.source.model },
        }))
      }
    }
  }
  return collected.slice(-limit)
}

/** The head of the triggering user message, for the injection's summary line. */
function lastUserExcerpt(session: Session): string {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event === undefined || event.type !== 'user/message') continue
    const text = textBlocks(event.data.content).map(block => block.text).join(' ').trim()
    return text === '' ? 'the latest request' : text.slice(0, 80)
  }
  return 'the latest request'
}

export default AgentModeController

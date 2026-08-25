/**
 * Cross-plugin registry of the per-agent model-selection refs installed by the
 * web API gateway. The gateway keeps ref ownership and its three-tier
 * read precedence; this service only publishes the installed ref so other
 * plugins (agent modes) can apply a selection through the SAME ref the
 * gateway reads — one writer per agent, last write wins, exactly like a
 * manual pick in the model seat.
 * @module @deepseek-ai/dsh-fork-agent-model-selection
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Registry of the gateway-installed per-agent model-selection refs. */
    agentModelSelections: AgentModelSelections
  }
}

/** The `ctx.agentModelSelections` bridge between the gateway and selection writers. */
export class AgentModelSelections extends Service {
  static inject = ['agentDefaultModel']

  private readonly refs = new WeakMap<Agent, ModelSelectionRef>()

  constructor(ctx: Context) {
    super(ctx, 'agentModelSelections')
  }

  /**
   * Publish the ref the gateway installed for one agent. Called by the
   * gateway's lazy `selectionFor` at install time; re-binding replaces the
   * published ref for that agent.
   * @param agent - the agent whose ref was installed.
   * @param ref - the gateway-owned mutable selection.
   */
  bind(agent: Agent, ref: ModelSelectionRef): void {
    this.refs.set(agent, ref)
  }

  /**
   * The gateway-installed ref for one agent.
   * @param agent - the agent to look up.
   * @returns the published ref, or undefined before the gateway installed one
   * (headless and non-web compositions never install it).
   */
  for(agent: Agent): ModelSelectionRef | undefined {
    return this.refs.get(agent)
  }

  /**
   * The deployment's default model selection (the same default the gateway's
   * selection getter falls back to).
   * @returns a detached provider/model selection.
   */
  deploymentDefault(): ModelSelection {
    return this.ctx.agentDefaultModel.currentSelection()
  }
}

export default AgentModelSelections

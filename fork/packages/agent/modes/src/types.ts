/**
 * Wire-facing types of the agent-mode domain: the fixed mode roster and the
 * session projection value. Types only — runtime vocabulary lives in the
 * package root.
 * @module @deepseek-ai/dsh-fork-agent-modes/types
 */

/** Model-slot modes: selecting one switches the session model. */
export type ModelSlotId = 'default' | 'smol' | 'big'

/** Role modes: selecting one applies the role instruction (plus any assigned model). */
export type RoleModeId = 'agents' | 'design' | 'code' | 'revisor' | 'scout'

/** The modes the routing surface exposes (the composer menu and select_mode). */
export type RoutedModeId = 'default' | RoleModeId

/** Every selectable agent-mode identifier. */
export type AgentModeId = ModelSlotId | RoleModeId

/** Committed per-session agent-mode state, folded from the session log. */
export interface AgentModeProjection {
  /** The session's selected mode; `default` before the first selection. */
  selected: AgentModeId
  /** Whether the angel companion model is enabled. */
  angel: boolean
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Agent-mode roster selection and angel toggle, folded from the session log. */
    agentMode: AgentModeProjection
  }
}

/** `agentmodes` namespace dictionaries (the composer mode selector's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger.aria': '智能体模式，当前：{name}',
} satisfies Record<string, string>

/** The agentmodes namespace key union. */
export type AgentModesKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger.aria': 'Agent mode, current: {name}',
} satisfies Record<AgentModesKey, string>

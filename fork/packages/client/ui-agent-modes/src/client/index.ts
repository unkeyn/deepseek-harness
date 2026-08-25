/**
 * Agent-mode composer panel, browser half: occupies a
 * `conversation.input.left` seat with the mode configuration menu. The menu
 * is NOT a mode picker — the model routes itself (`select_mode`) — it is
 * where the user assigns each mode its model (animated catalog submenu) and
 * a custom instruction (pencil editor), persisted through the
 * `agent-mode-assignments` settings namespace. The Angel row stays a toggle.
 */
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.left seat).
import type {} from '@deepseek-ai/dsh-fork-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the `agentMode` SessionProjectionMap merge for useProjection.
import type {} from '@deepseek-ai/dsh-fork-agent-modes/client'
import { ModeSelect, type ModeSelectInjected } from './ModeSelect.tsx'
import { en, zh, type AgentModesKey } from './locales.ts'

export type { ModeSelectInjected } from './ModeSelect.tsx'
export type { AgentModesKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The composer mode panel's copy. */
    'agentmodes': AgentModesKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'agentmodes'

/** The settings namespace the server plugin owns. */
const ASSIGNMENTS_NAMESPACE = 'agent-mode-assignments'

/** Required services: slot registry, connection (settings + catalog RPC), commands Remote, locale. */
export const inject = ['slots', 'connection', 'remote', 'remote.commands', 'locale']

/** Command failure text stays English (error-surface policy: not localized). */

/**
 * Client plugin body: register the mode panel over the settings and command
 * channels.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-agent-modes: dictionaries')

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'agent-modes',
    order: 10,
    locale: NS,
    inject: (sessionId: SessionId): ModeSelectInjected => {
      const connection = ctx.get('connection') as ConnectionHandle
      const readSection = async (): Promise<{
        models: Record<string, { provider: string; model: string; reasoningEffort?: string }>
        instructions: Record<string, string>
        presets: Record<string, { models: Record<string, { provider: string; model: string; reasoningEffort?: string }>; instructions: Record<string, string> }>
      }> => {
        const response = await connection.api.settings.describe({})
        if (!response.result.ok) throw new Error(`${response.result.error.message} (${response.result.error.code})`)
        const view = response.result.value.namespaces.find((entry: { ns: string }) => entry.ns === ASSIGNMENTS_NAMESPACE)
        const value = (view?.value ?? {}) as {
          models?: Record<string, { provider: string; model: string; reasoningEffort?: string }>
          instructions?: Record<string, string>
          presets?: Record<string, { models: Record<string, { provider: string; model: string; reasoningEffort?: string }>; instructions: Record<string, string> }>
        }
        return { models: value.models ?? {}, instructions: value.instructions ?? {}, presets: value.presets ?? {} }
      }
      const failure = (response: { result: { ok: false; error: { message: string; code: string } } | { ok: true } }): string | null =>
        response.result.ok ? null : `${response.result.error.message} (${response.result.error.code})`
      return {
        assignments: readSection,
        assignModel: async (mode, selection) => {
          const response = await connection.api.settings.update({
            ns: ASSIGNMENTS_NAMESPACE,
            patch: { models: { [mode]: selection } },
          })
          return failure(response)
        },        clearModel: async (mode) => {
          const response = await connection.api.settings.mutate({
            ns: ASSIGNMENTS_NAMESPACE,
            ops: [{ op: 'unset', path: ['models', mode] }],
          })
          return failure(response)
        },
        setInstruction: async (mode, text) => {
          const response = text === null
            ? await connection.api.settings.mutate({
                ns: ASSIGNMENTS_NAMESPACE,
                ops: [{ op: 'unset', path: ['instructions', mode] }],
              })
            : await connection.api.settings.update({
                ns: ASSIGNMENTS_NAMESPACE,
                patch: { instructions: { [mode]: text } },
              })
          return failure(response)
        },
        savePreset: async (name) => {
          const section = await readSection()
          const response = await connection.api.settings.update({
            ns: ASSIGNMENTS_NAMESPACE,
            patch: { presets: { [name]: { models: section.models, instructions: section.instructions } } },
          })
          return failure(response)
        },
        applyPreset: async (name) => {
          const section = await readSection()
          const preset = section.presets[name]
          if (preset === undefined) return `preset "${name}" does not exist`
          const response = await connection.api.settings.replace({
            ns: ASSIGNMENTS_NAMESPACE,
            section: { models: preset.models, instructions: preset.instructions, presets: section.presets },
          })
          return failure(response)
        },
        deletePreset: async (name) => {
          const response = await connection.api.settings.mutate({
            ns: ASSIGNMENTS_NAMESPACE,
            ops: [{ op: 'unset', path: ['presets', name] }],
          })
          return failure(response)
        },
        loadCatalog: async () => {
          const response = await connection.api.sessions.models({ sessionId })
          if (!response.result.ok) throw new Error(`${response.result.error.message} (${response.result.error.code})`)
          return response.result.value.groups.map(group => ({
            provider: group.id,
            name: group.name,
            models: group.models.map(model => ({
              id: model.id,
              name: model.name,
              ...model.reasoning === undefined ? {} : {
                efforts: model.reasoning.efforts.map(effort => ({ id: effort.id, name: effort.name })),
              },
            })),
          }))
        },
        setAngel: async (enabled) => {
          const result = await ctx.remote.commands.execute(sessionId, `/angel ${enabled ? 'on' : 'off'}`, [])
          if (!result.ok) return `${result.error.message} (${result.error.code})`
          if (result.value === undefined) return 'unknown command: /angel'
          return null
        },
      }
    },
  }, ModeSelect))
}

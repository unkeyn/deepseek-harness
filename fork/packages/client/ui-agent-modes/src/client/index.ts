/**
 * Agent-mode composer panel, browser half: occupies a
 * `conversation.input.left` seat with the mode configuration menu. The menu
 * is NOT a mode picker — the model routes itself (`select_mode`) — it is
 * where the user assigns each mode its model (animated catalog submenu) and
 * a custom instruction (pencil editor), persisted through the
 * `agent-mode-assignments` settings namespace. The Angel row stays a toggle.
 */
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the renderer's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ui-conversation SlotMap merge (the input.left seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
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

/** Required services: slot registry, current Remote namespaces, and locale. */
export const inject = ['slots', 'remote', 'remote.commands', 'remote.settings', 'remote.session', 'locale']

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
      const readSection = async (): Promise<{
        models: Record<string, { provider: string; model: string; reasoningEffort?: string }>
        instructions: Record<string, string>
        presets: Record<string, { models: Record<string, { provider: string; model: string; reasoningEffort?: string }>; instructions: Record<string, string> }>
      }> => {
        const response = await ctx.remote.settings.describe()
        if (!response.ok) throw new Error(`${response.error.message} (${response.error.code})`)
        const view = response.value.namespaces.find((entry: { ns: string }) => entry.ns === ASSIGNMENTS_NAMESPACE)
        const value = (view?.value ?? {}) as {
          models?: Record<string, { provider: string; model: string; reasoningEffort?: string }>
          instructions?: Record<string, string>
          presets?: Record<string, { models: Record<string, { provider: string; model: string; reasoningEffort?: string }>; instructions: Record<string, string> }>
        }
        return { models: value.models ?? {}, instructions: value.instructions ?? {}, presets: value.presets ?? {} }
      }
      const failure = (response: { ok: false; error: { message: string; code: string } } | { ok: true }): string | null =>
        response.ok ? null : `${response.error.message} (${response.error.code})`
      return {
        assignments: readSection,
        assignModel: async (mode, selection) => {
          const response = await ctx.remote.settings.update(
            ASSIGNMENTS_NAMESPACE,
            { models: { [mode]: selection } },
            undefined,
          )
          return failure(response)
        },        clearModel: async (mode) => {
          const response = await ctx.remote.settings.mutate(
            ASSIGNMENTS_NAMESPACE,
            [{ op: 'unset', path: ['models', mode] }],
            undefined,
          )
          return failure(response)
        },
        setInstruction: async (mode, text) => {
          const response = text === null
            ? await ctx.remote.settings.mutate(
                ASSIGNMENTS_NAMESPACE,
                [{ op: 'unset', path: ['instructions', mode] }],
                undefined,
              )
            : await ctx.remote.settings.update(
                ASSIGNMENTS_NAMESPACE,
                { instructions: { [mode]: text } },
                undefined,
              )
          return failure(response)
        },
        savePreset: async (name) => {
          const section = await readSection()
          const response = await ctx.remote.settings.update(
            ASSIGNMENTS_NAMESPACE,
            { presets: { [name]: { models: section.models, instructions: section.instructions } } },
            undefined,
          )
          return failure(response)
        },
        applyPreset: async (name) => {
          const section = await readSection()
          const preset = section.presets[name]
          if (preset === undefined) return `preset "${name}" does not exist`
          const response = await ctx.remote.settings.replace(
            ASSIGNMENTS_NAMESPACE,
            { models: preset.models, instructions: preset.instructions, presets: section.presets },
            undefined,
          )
          return failure(response)
        },
        deletePreset: async (name) => {
          const response = await ctx.remote.settings.mutate(
            ASSIGNMENTS_NAMESPACE,
            [{ op: 'unset', path: ['presets', name] }],
            undefined,
          )
          return failure(response)
        },
        loadCatalog: async () => {
          const response = await ctx.remote.session.modelCatalog()
          if (!response.ok) throw new Error(`${response.error.message} (${response.error.code})`)
          return response.value.groups.map(group => ({
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

import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the input.left seat and
// its InputZone owner share).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the `agentMode` SessionProjectionMap merge for useProjection.
import type {} from '@deepseek-ai/dsh-fork-agent-modes/client'
import { ModeMenu } from './ModeMenu.tsx'
import css from './ModeSelect.module.css'

/** One mode's assigned model. */
export interface ModeAssignments {
  /** Mode id → assigned model. */
  models: Record<string, { provider: string; model: string; reasoningEffort?: string }>
  /** Mode id → custom instruction replacing the built-in wholesale. */
  instructions: Record<string, string>
  /** Named presets: one complete models+instructions snapshot each. */
  presets: Record<string, { models: ModeAssignments['models']; instructions: ModeAssignments['instructions'] }>
}

/** Full mode-panel component props: runtime share (standard kit + InputZone owner) & injected share & the locale seat. */
export type ModeSelectProps =
  PropsRuntime<'conversation.input.left'> & InjectFace<ModeSelectInjected> & PropsLocale<'agentmodes'>

/** Injected business face of the composer mode panel. */
export interface ModeSelectInjected {
  /**
   * Read the current per-mode assignments.
   * @returns the models, instructions, and presets maps (empty objects when nothing is assigned).
   */
  assignments: () => Promise<ModeAssignments>
  /**
   * Load the model catalog (the same providers and models the model seat shows).
   * @returns provider groups in catalog order, with reasoning efforts when exposed.
   */
  loadCatalog: () => Promise<{
    provider: string
    name: string
    models: { id: string; name: string; efforts?: { id: string; name: string }[] }[]
  }[]>
  /**
   * Assign one mode's model.
   * @param mode - the roster mode id.
   * @param selection - the provider/model pair and optional reasoning effort to assign.
   * @returns null on success; a user-visible failure line otherwise.
   */
  assignModel: (mode: string, selection: { provider: string; model: string; reasoningEffort?: string }) => Promise<string | null>
  /**
   * Remove one mode's model assignment (back to the session's own model).
   * @param mode - the roster mode id.
   * @returns null on success; a user-visible failure line otherwise.
   */
  clearModel: (mode: string) => Promise<string | null>
  /**
   * Save or clear one mode's custom instruction.
   * @param mode - the roster mode id.
   * @param text - the instruction text, or null to restore the built-in.
   * @returns null on success; a user-visible failure line otherwise.
   */
  setInstruction: (mode: string, text: string | null) => Promise<string | null>
  /**
   * Save the current models+instructions configuration as a named preset.
   * @param name - the preset name.
   * @returns null on success; a user-visible failure line otherwise.
   */
  savePreset: (name: string) => Promise<string | null>
  /**
   * Apply one saved preset wholesale (its models and instructions win).
   * @param name - the preset name.
   * @returns null on success; a user-visible failure line otherwise.
   */
  applyPreset: (name: string) => Promise<string | null>
  /**
   * Delete one saved preset.
   * @param name - the preset name.
   * @returns null on success; a user-visible failure line otherwise.
   */
  deletePreset: (name: string) => Promise<string | null>
  /**
   * Enable or disable the angel companion by executing /angel on|off.
   * @param enabled - the requested toggle state.
   * @returns null on admitted execution; a user-visible failure line otherwise.
   */
  setAngel: (enabled: boolean) => Promise<string | null>
}

/** The routed roster: display labels are design literals, like the Access chip's `Full access`. */
const MODE_ITEMS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'agents', label: 'Agents' },
  { id: 'design', label: 'Design' },
  { id: 'revisor', label: 'Revisor' },
  { id: 'scout', label: 'Scout' },
]

function displayLabel(id: string): string {
  return MODE_ITEMS.find(item => item.id === id)?.label ?? id
}

/* The trigger glyph: a tune/sliders mark reading as "mode controls", kept
   distinct from the Access shield and the attach plus. */
const tuneGlyph = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M1.8 4.9h4.1M9.9 4.9h4.3M1.8 11.1h2.7M8.3 11.1h5.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <circle cx="8.1" cy="4.9" r="1.9" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="6.4" cy="11.1" r="1.9" stroke="currentColor" strokeWidth="1.3" />
  </svg>
)

/**
 * The composer's agent-mode panel: one icon trigger opening the mode
 * configuration menu. The model routes itself between the modes
 * (select_mode); this surface only assigns models and custom instructions.
 * Reads the host-computed `agentMode` projection for the effective mode and
 * angel state; renders nothing while the projection key is absent.
 */
export function ModeSelect({ session, useProjection, assignments, assignModel, clearModel, setInstruction, savePreset, applyPreset, deletePreset, loadCatalog, setAngel, t }: ModeSelectProps) {
  const mode = useProjection('agentMode')
  const [open, setOpen] = useState(false)
  const [angelPick, setAngelPick] = useState<boolean | null>(null)

  useEffect(() => {
    if (session.removed) {
      setOpen(false)
      setAngelPick(null)
    }
  }, [session.removed])

  // Capability absence renders nothing; the hooks above keep their order.
  if (mode === undefined) return null

  const locked = session.removed
  const angel = angelPick ?? mode.angel
  const current = displayLabel(mode.selected)

  const toggleAngel = useCallback((): void => {
    const next = !angel
    setAngelPick(next)
    void setAngel(next)
      .catch(() => false)
      .then(() => { setAngelPick(null) })
  }, [angel, setAngel])

  return (
    <span className={css.wrap}>
      <button
        type="button"
        className={css.trigger}
        aria-label={t('trigger.aria', { name: current })}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={locked}
        onClick={() => { setOpen(!open) }}
      >
        <span className={css.triggerIcon} aria-hidden>{tuneGlyph}</span>
        <span className={css.triggerLabel}>{current}</span>
        {/* Same glyph + open rotation as the sibling Access trigger. */}
        <span className={clsx(css.chevron, open && css.chevronOpen)} aria-hidden>
          <IconChevronDownOutline14 />
        </span>
      </button>
      {open && (
        <ModeMenu
          effectiveMode={mode.selected}
          angel={angel}
          assignments={assignments}
          assignModel={assignModel}
          clearModel={clearModel}
          setInstruction={setInstruction}
          savePreset={savePreset}
          applyPreset={applyPreset}
          deletePreset={deletePreset}
          loadCatalog={loadCatalog}
          onToggleAngel={toggleAngel}
          onClose={() => { setOpen(false) }}
        />
      )}
    </span>
  )
}

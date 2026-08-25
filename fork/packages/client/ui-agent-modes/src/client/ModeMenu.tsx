import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { IconCheckOutline14, IconCloseOutline16, IconEditOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModeAssignments } from './ModeSelect.tsx'
import css from './ModeSelect.module.css'

/** The routed roster: display labels are design literals. */
const MODE_ITEMS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'agents', label: 'Agents' },
  { id: 'design', label: 'Design' },
  { id: 'revisor', label: 'Revisor' },
  { id: 'scout', label: 'Scout' },
]

/** One catalog provider group as the menu renders it. */
interface CatalogGroup {
  provider: string
  name: string
  models: { id: string; name: string; efforts?: { id: string; name: string }[] }[]
}

/** The right pane's content: catalog, instruction editor, or preset manager. */
type Pane =
  | { readonly kind: 'catalog'; readonly mode: string }
  | { readonly kind: 'editor'; readonly mode: string }
  | { readonly kind: 'presets' }

/** The catalog row currently showing its reasoning-effort list. */
interface EffortPick {
  provider: string
  modelId: string
}

export interface ModeMenuProps {
  /** The session's effective mode, shown as the checked row. */
  effectiveMode: string
  /** The session's committed angel state. */
  angel: boolean
  assignments: () => Promise<ModeAssignments>
  assignModel: (mode: string, selection: { provider: string; model: string }) => Promise<string | null>
  clearModel: (mode: string) => Promise<string | null>
  setInstruction: (mode: string, text: string | null) => Promise<string | null>
  savePreset: (name: string) => Promise<string | null>
  applyPreset: (name: string) => Promise<string | null>
  deletePreset: (name: string) => Promise<string | null>
  loadCatalog: () => Promise<CatalogGroup[]>
  onToggleAngel: () => void
  onClose: () => void
}

/**
 * The two-pane mode configuration card. The left pane lists the routed
 * modes with their assigned model (dimmed), a pencil editor entry, and the
 * Angel toggle; the right pane — model catalog, instruction editor, or
 * preset manager — slides in from the right. Nothing here activates a mode:
 * the model routes itself.
 */
export function ModeMenu({ effectiveMode, angel, assignments, assignModel, clearModel, setInstruction, savePreset, applyPreset, deletePreset, loadCatalog, onToggleAngel, onClose }: ModeMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [assignmentsState, setAssignmentsState] = useState<ModeAssignments | null>(null)
  const [pane, setPane] = useState<Pane | null>(null)
  const [catalog, setCatalog] = useState<CatalogGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    assignments().then((value) => {
      if (alive) setAssignmentsState(value)
    }).catch((reason: unknown) => {
      if (alive) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { alive = false }
  }, [assignments])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && event.target instanceof Node && !rootRef.current.contains(event.target)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  // The catalog loads once per menu lifetime, on the first pane that needs it.
  useEffect(() => {
    if (pane === null || pane.kind !== 'catalog' || catalog !== null) return
    let alive = true
    loadCatalog().then((groups) => {
      if (alive) setCatalog(groups)
    }).catch((reason: unknown) => {
      if (alive) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { alive = false }
  }, [pane, catalog, loadCatalog])

  /** Run one write, surface its failure, and refresh from the authoritative store. */
  const write = (operation: () => Promise<string | null>): void => {
    void operation()
      .then((failure) => {
        if (failure !== null) {
          setError(failure)
          return undefined
        }
        return assignments().then((value) => { setAssignmentsState(value) })
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
  }

  const openCatalog = (mode: string): void => {
    setPane({ kind: 'catalog', mode })
  }

  /** The pencil toggles the editor; while any pinned pane is open, hover does nothing. */
  const toggleEditor = (mode: string): void => {
    if (pane !== null && pane.kind === 'editor' && pane.mode === mode) setPane(null)
    else setPane({ kind: 'editor', mode })
  }

  const hoverCatalog = (mode: string): void => {
    // A pinned pane (editor or presets) owns the right side until its own
    // gesture closes it; hovering the rows must not fight it.
    if (pane !== null && pane.kind !== 'catalog') return
    if (pane !== null && pane.mode === mode) return
    openCatalog(mode)
  }

  const pickModel = (mode: string, provider: string, model: string, reasoningEffort?: string): void => {
    write(async () => assignModel(mode, { provider, model, ...reasoningEffort === undefined ? {} : { reasoningEffort } }))
  }

  const resetModel = (mode: string): void => {
    write(async () => clearModel(mode))
  }

  const saveInstruction = (mode: string, text: string): void => {
    const trimmed = text.trim()
    write(async () => setInstruction(mode, trimmed === '' ? null : trimmed))
    setPane({ kind: 'catalog', mode })
  }

  const angelState = angel

  return (
    <div ref={rootRef} className={css.card} role="menu" aria-label="Agent modes">
      <div className={css.modesPane}>
        {MODE_ITEMS.map((item) => {
          const assigned = assignmentsState?.models[item.id]
          const custom = assignmentsState?.instructions[item.id] !== undefined
          const editorOpen = pane !== null && pane.kind === 'editor' && pane.mode === item.id
          return (
            <div
              key={item.id}
              className={clsx(css.modeRow, pane !== null && pane.kind === 'catalog' && pane.mode === item.id && css.modeRowActive)}
              role="menuitem"
              tabIndex={0}
              onMouseEnter={() => { hoverCatalog(item.id) }}
              onKeyDown={(event) => { if (event.key === 'Enter') openCatalog(item.id) }}
            >
              <span className={css.modeRowMain}>
                <span className={css.modeName}>
                  {item.label}
                  {effectiveMode === item.id && (
                    <span className={css.modeCheck} aria-hidden>
                      <IconCheckOutline14 />
                    </span>
                  )}
                </span>
                {assigned !== undefined && <span className={css.assignedModel}>{assigned.model}</span>}
              </span>
              <button
                type="button"
                className={clsx(css.pencil, (custom || editorOpen) && css.pencilCustom)}
                aria-label={`Edit ${item.label} instruction`}
                aria-pressed={editorOpen}
                title="Custom instruction"
                onMouseDown={(event) => { event.stopPropagation() }}
                onClick={(event) => {
                  event.stopPropagation()
                  toggleEditor(item.id)
                }}
              >
                <IconEditOutline16 />
              </button>
            </div>
          )
        })}
        <div className={css.separator} role="separator" />
        <div
          className={css.modeRow}
          role="menuitemcheckbox"
          aria-checked={angelState}
          tabIndex={0}
          onClick={() => { onToggleAngel() }}
          onKeyDown={(event) => { if (event.key === 'Enter') onToggleAngel() }}
        >
          <span className={css.modeRowMain}>
            <span className={css.checkbox} aria-hidden>{angelState && <IconCheckOutline14 />}</span>
            <span className={css.modeName}>Angel</span>
          </span>
        </div>
        <div
          className={clsx(css.modeRow, pane !== null && pane.kind === 'presets' && css.modeRowActive)}
          role="menuitem"
          tabIndex={0}
          onClick={() => { setPane(pane !== null && pane.kind === 'presets' ? null : { kind: 'presets' }) }}
          onKeyDown={(event) => { if (event.key === 'Enter') setPane(pane !== null && pane.kind === 'presets' ? null : { kind: 'presets' }) }}
        >
          <span className={css.modeRowMain}>
            <span className={css.modeName}>Presets</span>
          </span>
        </div>
        {error !== null && <div className={css.error} role="status">{error}</div>}
      </div>
      {pane !== null && (
        <div className={css.subPane} key={`${pane.kind}:${pane.kind === 'presets' ? '' : pane.mode}`}>
          {pane.kind === 'catalog' ? (
            <CatalogPane
              mode={pane.mode}
              catalog={catalog}
              assigned={assignmentsState?.models[pane.mode]}
              onPick={(provider, model, effort) => { pickModel(pane.mode, provider, model, effort) }}
              onReset={() => { resetModel(pane.mode) }}
            />
          ) : pane.kind === 'editor' ? (
            <EditorPane
              mode={pane.mode}
              initial={assignmentsState?.instructions[pane.mode] ?? ''}
              onSave={(text) => { saveInstruction(pane.mode, text) }}
              onClose={() => { setPane(null) }}
            />
          ) : (
            <PresetsPane
              presets={assignmentsState?.presets ?? {}}
              onSave={(name) => { write(async () => savePreset(name)) }}
              onApply={(name) => { write(async () => applyPreset(name)) }}
              onDelete={(name) => { write(async () => deletePreset(name)) }}
            />
          )}
        </div>
      )}
    </div>
  )
}

function CatalogPane({ mode, catalog, assigned, onPick, onReset }: {
  mode: string
  catalog: CatalogGroup[] | null
  assigned: { provider: string; model: string; reasoningEffort?: string } | undefined
  onPick: (provider: string, model: string, reasoningEffort?: string) => void
  onReset: () => void
}) {
  const [effortPick, setEffortPick] = useState<EffortPick | null>(null)
  return (
    <>
      <div className={css.subHead}>
        <span className={css.subTitle}>{`Model for ${mode}`}</span>
        {assigned !== undefined && (
          <button type="button" className={css.resetLink} onClick={onReset}>reset</button>
        )}
      </div>
      <div className={css.catalogScroll}>
        {catalog === null && <div className={css.catalogLoading}>loading…</div>}
        {catalog !== null && catalog.length === 0 && <div className={css.catalogLoading}>no providers</div>}
        {catalog?.map(group => (
          <div key={group.provider} className={css.providerGroup}>
            <div className={css.providerName}>{group.name}</div>
            {group.models.map((model) => {
              const selected = assigned !== undefined && assigned.provider === group.provider && assigned.model === model.id
              const effortsOpen = effortPick !== null && effortPick.provider === group.provider && effortPick.modelId === model.id
              return (
                <div key={model.id}>
                  <button
                    type="button"
                    className={clsx(css.modelRow, selected && css.modelRowSelected)}
                    onClick={() => {
                      if (model.efforts !== undefined && model.efforts.length > 0) {
                        setEffortPick(effortsOpen ? null : { provider: group.provider, modelId: model.id })
                        return
                      }
                      onPick(group.provider, model.id)
                    }}
                  >
                    <span className={css.modelName}>{model.name}</span>
                    {selected && (
                      <span className={css.modelRowMeta}>
                        {assigned?.reasoningEffort !== undefined && <span className={css.assignedModel}>{assigned.reasoningEffort}</span>}
                        <span className={css.modeCheck} aria-hidden><IconCheckOutline14 /></span>
                      </span>
                    )}
                  </button>
                  {effortsOpen && (
                    <div className={css.effortList}>
                      <button
                        type="button"
                        className={clsx(css.effortRow, assigned !== undefined && assigned.provider === group.provider && assigned.model === model.id && assigned.reasoningEffort === undefined && css.effortRowSelected)}
                        onClick={() => { onPick(group.provider, model.id); setEffortPick(null) }}
                      >
                        <span className={css.modelName}>Default</span>
                      </button>
                      {model.efforts?.map(effort => (
                        <button
                          key={effort.id}
                          type="button"
                          className={clsx(css.effortRow, selected && assigned?.reasoningEffort === effort.id && css.effortRowSelected)}
                          onClick={() => { onPick(group.provider, model.id, effort.id); setEffortPick(null) }}
                        >
                          <span className={css.modelName}>{effort.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </>
  )
}

function EditorPane({ mode, initial, onSave, onClose }: {
  mode: string
  initial: string
  onSave: (text: string) => void
  onClose: () => void
}) {
  const [text, setText] = useState(initial)
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => { ref.current?.focus() }, [])
  return (
    <>
      <div className={css.subHead}>
        <span className={css.subTitle}>{`Instruction for ${mode}`}</span>
        <button type="button" className={css.editorClose} aria-label="Close editor" onClick={onClose}>
          <IconCloseOutline16 />
        </button>
      </div>
      <textarea
        ref={ref}
        className={css.editorArea}
        value={text}
        placeholder="Empty = built-in instruction"
        rows={6}
        onChange={(event) => { setText(event.target.value) }}
      />
      <div className={css.editorActions}>
        <button type="button" className={css.editorButton} onClick={() => { onSave(text) }}>Save</button>
      </div>
    </>
  )
}

function PresetsPane({ presets, onSave, onApply, onDelete }: {
  presets: ModeAssignments['presets']
  onSave: (name: string) => void
  onApply: (name: string) => void
  onDelete: (name: string) => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const names = Object.keys(presets).sort((a, b) => a.localeCompare(b))
  return (
    <>
      <div className={css.subHead}>
        <span className={css.subTitle}>Presets</span>
      </div>
      <div className={css.presetSaveRow}>
        <input
          className={css.presetInput}
          value={name}
          placeholder="Preset name"
          onChange={(event) => { setName(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && name.trim() !== '') {
              onSave(name.trim())
              setName('')
            }
          }}
        />
        <button
          type="button"
          className={css.editorButton}
          disabled={name.trim() === ''}
          onClick={() => {
            onSave(name.trim())
            setName('')
          }}
        >
          Save
        </button>
      </div>
      <div className={css.catalogScroll}>
        {names.length === 0 && <div className={css.catalogLoading}>no presets saved</div>}
        {names.map((presetName) => (
          <div key={presetName} className={css.presetRow}>
            <span className={css.modelName}>{presetName}</span>
            <span className={css.presetRowActions}>
              <button type="button" className={css.resetLink} onClick={() => { onApply(presetName) }}>apply</button>
              <button type="button" className={css.presetDelete} aria-label={`Delete ${presetName}`} onClick={() => { onDelete(presetName) }}>
                <IconCloseOutline16 />
              </button>
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

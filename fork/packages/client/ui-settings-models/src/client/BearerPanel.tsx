/**
 * Bearer provider panel for the Models > Bearer disclosure group.
 *
 * The panel owns only Bearer routes. API-key routes stay in the API group,
 * while OAuth and Search continue to arrive through their feature panels.
 * This keeps the Bearer tab useful even when a deployment has no profile yet.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconPlusOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { BearerProviderCard } from './CustomProviderCard.tsx'
import { ProviderEditor } from './ProviderEditor.tsx'
import type { ModelsSettingsState, ModelsSettingsStore, ProviderRow } from './store.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'
import type { ModelsApi } from './models-api.ts'

type ModelsWire = ModelsApi

async function removeBearerProfile(
  api: Pick<ModelsApi, 'settings' | 'credentials'>,
  controller: ModelsSettingsStore,
  target: ReturnType<typeof targetOf>,
): Promise<string | undefined> {
  try {
    for (const ref of target.credentialRefs ?? []) {
      const response = await api.credentials.unset({ ref })
      if (!response.result.ok) return response.result.error.message
    }
    const response = await api.settings.mutate({
      ns: target.settingsNs,
      ops: [{ op: 'unset', path: [...target.settingsPath] }],
    })
    if (!response.result.ok) return response.result.error.message
    await controller.load()
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

export interface BearerPanelProps {
  controller: ModelsSettingsStore
  useSnapshot: SnapshotSelectorHook<ModelsSettingsState>
  api: ModelsWire
  schema: SettingsSchemaOperations
  t: (key: keyof typeof en) => string
  readOnly: boolean
}

function targetOf(row: ProviderRow) {
  return {
    provider: row.entry.provider,
    displayName: row.entry.displayName,
    settingsNs: row.entry.settingsNs,
    settingsPath: row.entry.settingsPath,
    credentialRefs: row.credentialRefs,
  }
}

/** Render Bearer provider rows and the dedicated route-creation form. */
export function BearerPanel(props: BearerPanelProps): ReactNode {
  const state = props.useSnapshot(snapshot => snapshot)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | undefined>(undefined)
  const [removeTarget, setRemoveTarget] = useState<ProviderRow | undefined>(undefined)
  const [removeFailure, setRemoveFailure] = useState<string | undefined>(undefined)
  const bearerRows = state.rows.filter(row => row.entry.settingsNs === 'llm-bearer' && row.configured)
  const namespace = state.namespaces.get('llm-bearer')

  const closeEditor = (changed: boolean): void => {
    setEditing(undefined)
    if (changed) void props.controller.load()
  }

  const confirmRemove = (): void => {
    if (removeTarget === undefined) return
    const target = targetOf(removeTarget)
    void removeBearerProfile(props.api, props.controller, target).then((failure) => {
      if (failure === undefined) {
        setRemoveTarget(undefined)
        setRemoveFailure(undefined)
      } else {
        setRemoveFailure(failure)
      }
    })
  }

  if (state.status === 'error') {
    return <p className={styles['error']}>{state.error ?? tFallback(props.t, 'groupUnavailable')}</p>
  }

  return (
    <div className={styles['panel']}>
      {bearerRows.length === 0 && !adding
        ? <p className={styles['advancedHint']}>{props.t('groupBearerDescription')}</p>
        : null}
      <ul className={styles['rows']}>
        {bearerRows.map(row => {
          const target = targetOf(row)
          const rowNamespace = state.namespaces.get(target.settingsNs)
          if (rowNamespace === undefined) return null
          const open = editing === row.entry.provider
          const configured = row.credentials?.every(credential => credential.configured)
            ?? row.credential?.configured
          return (
            <li key={row.entry.provider} className={styles['rowCard']}>
              <div className={styles['rowHead']}>
                <span className={styles['rowIdentity']}>
                  <span className={styles['rowName']}>{row.entry.displayName}</span>
                  {configured
                    ? <span className={`${styles['credentialDot']} ${styles['credentialDotConfigured']}`} role="img" aria-label={props.t('credentialConfigured')} />
                    : <span className={`${styles['credentialDot']} ${styles['credentialDotMissing']}`} role="img" aria-label={props.t('credentialMissing')} />}
                </span>
                <span className={styles['rowActions']}>
                  <button type="button" className={styles['secondaryButton']} onClick={() => { setEditing(open ? undefined : row.entry.provider) }}>
                    {props.t('edit')}
                  </button>
                  {row.removable
                    ? <button type="button" className={styles['dangerButton']} disabled={!state.writable} onClick={() => { setRemoveFailure(undefined); setRemoveTarget(row) }}>{props.t('remove')}</button>
                    : null}
                </span>
              </div>
              {open
                ? <ProviderEditor
                  key={row.entry.provider}
                  provider={row.entry.provider}
                  displayName={row.entry.displayName}
                  namespace={rowNamespace}
                  schema={props.schema}
                  settingsPath={row.entry.settingsPath}
                  api={props.api}
                  t={props.t}
                  readOnly={!state.writable}
                  onClose={closeEditor}
                />
                : null}
            </li>
          )
        })}
      </ul>
      {adding && namespace !== undefined
        ? (
          <div className={styles['addCard']}>
            <BearerProviderCard
              taken={state.rows.map(row => row.entry.provider)}
              revision={namespace.revision}
              api={props.api}
              t={props.t}
              readOnly={!state.writable}
              onClose={(changed) => { setAdding(false); if (changed) void props.controller.load() }}
            />
          </div>
        )
        : (
          <div className={styles['addActions']}>
            <button type="button" className={styles['addButton']} disabled={namespace === undefined || !state.writable} onClick={() => { setAdding(true) }}>
              <IconPlusOutline16 size={14} />
              {props.t('bearerAdd')}
            </button>
          </div>
        )}
      <Modal
        open={removeTarget !== undefined}
        onClose={() => { setRemoveTarget(undefined); setRemoveFailure(undefined) }}
        title={removeTarget === undefined ? '' : props.t('deleteTitle').replace('{provider}', removeTarget.entry.displayName)}
        closeLabel={props.t('close')}
        description={props.t('deleteDescriptionWithCredential').replace('{provider}', removeTarget?.entry.displayName ?? '')}
        className={styles['deleteDialog'] as string}
        footer={(
          <>
            <Button variant="outline" onClick={() => { setRemoveTarget(undefined); setRemoveFailure(undefined) }}>{props.t('cancel')}</Button>
            <Button variant="outline" className={styles['deleteConfirm']} onClick={confirmRemove}>{props.t('remove')}</Button>
          </>
        )}
      >
        {removeFailure === undefined ? null : <p className={styles['error']}>{removeFailure}</p>}
      </Modal>
    </div>
  )
}

function tFallback(t: BearerPanelProps['t'], key: keyof typeof en): string {
  return t(key)
}

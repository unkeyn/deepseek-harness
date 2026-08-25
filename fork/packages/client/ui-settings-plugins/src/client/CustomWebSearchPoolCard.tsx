/**
 * The search-providers panel, drawn in the Models page's provider vocabulary:
 * one outlined row per configured provider (name, key count, credential dot,
 * Edit/Remove), the expanded row carrying the write-only key editor, a dashed
 * add-provider affordance, the pool-wide advanced options behind a disclosure,
 * and the shared Discard/Save footer. Key checks run through the Host and show
 * per-key validity and credit numbers without ever receiving a key literal.
 */

import { useState } from 'react'
import clsx from 'clsx'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconPlusOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PoolCardFace, PoolDraftKey, PoolDraftProvider, ProviderPreset } from './custom-web-search-pool-controller.ts'
// Type-only: the Models page panel slot this card renders in.
import type {} from '@deepseek-ai/dsh-fork-client-ui-settings-models/client'
import css from './web-search-pool-card.module.css'

/** Props bound by the Models page `settings.models.panel` slot. */
export type CustomWebSearchPoolCardProps = PropsRuntime<'settings.models.panel'> & PropsLocale<'settings.plugins'> & InjectFace<PoolCardFace>

const presetLabel: Record<ProviderPreset, 'webSearchPoolFirecrawl' | 'webSearchPoolBrave' | 'webSearchPoolExa'> = {
  firecrawl: 'webSearchPoolFirecrawl',
  brave: 'webSearchPoolBrave',
  exa: 'webSearchPoolExa',
}

/** Render the search provider and multi-key pool settings panel. */
export function CustomWebSearchPoolCard(props: CustomWebSearchPoolCardProps) {
  const state = props.useWebSearchPool(snapshot => snapshot)
  const [editingId, setEditingId] = useState<string | undefined>(undefined)
  const [adding, setAdding] = useState(false)
  if (!state.available) return null
  const disabled = !state.writable || state.saving
  return (
    <div className={css.panel}>
      {!state.writable ? <p className={css.readOnly} role="status">{props.t('readOnly')}</p> : null}
      <ul className={css.rows}>
        {state.providers.map(provider => (
          <ProviderRow
            key={provider.id}
            provider={provider}
            open={!adding && editingId === provider.id}
            checking={state.checking === provider.id}
            checkGated={state.dirty}
            t={props.t}
            disabled={disabled}
            onToggle={(id) => { setAdding(false); setEditingId(current => current === id ? undefined : id) }}
            onEditKey={props.editKey}
            onAddKey={props.addKey}
            onRemoveKey={props.removeKey}
            onRemove={props.removeProvider}
            onCheck={props.check}
          />
        ))}
      </ul>
      <div className={css.addBlock}>
        {adding
          ? (
            <div className={css.addCard}>
              <div className={css.field}>
                <span className={css.fieldLabel} id="web-search-pool-provider-type-label">{props.t('webSearchPoolAddProvider')}</span>
                <select
                  className={`${css.input} ${css.selectInput}`}
                  aria-labelledby="web-search-pool-provider-type-label"
                  disabled={disabled}
                  value=""
                  onChange={(event) => {
                    const value = event.target.value
                    if (value !== '') {
                      props.addProvider(value as ProviderPreset)
                      setAdding(false)
                      setEditingId(value)
                    }
                  }}
                >
                  <option value="">{props.t('webSearchPoolChooseProvider')}</option>
                  {state.availablePresets.map(preset => (
                    <option value={preset} key={preset}>{props.t(presetLabel[preset])}</option>
                  ))}
                </select>
              </div>
            </div>
          )
          : state.availablePresets.length > 0
            ? (
              <div className={css.addActions}>
                <button
                  type="button"
                  className={css.addButton}
                  disabled={disabled}
                  onClick={() => { setEditingId(undefined); setAdding(true) }}
                >
                  <IconPlusOutline16 size={14} />
                  {props.t('webSearchPoolAddProvider')}
                </button>
              </div>
            )
            : null}
      </div>
      <details className={css.customized}>
        <summary className={css.customizedSummary}>{props.t('webSearchPoolAdvanced')}</summary>
        <div className={css.customizedBody}>
          <NumberField
            id="web-search-pool-max-attempts"
            label={props.t('webSearchPoolMaxAttempts')}
            hint={props.t('webSearchPoolMaxAttemptsHint')}
            invalidLabel={props.t('invalidNumber')}
            text={state.maxAttempts}
            invalid={!isPositiveInteger(state.maxAttempts)}
            disabled={disabled}
            onEdit={value => props.editGlobal('maxAttempts', value)}
          />
          <NumberField
            id="web-search-pool-cooldown"
            label={props.t('webSearchPoolCooldown')}
            hint={props.t('webSearchPoolCooldownHint')}
            invalidLabel={props.t('invalidNumber')}
            text={state.cooldownMs}
            invalid={!isNonNegativeInteger(state.cooldownMs)}
            disabled={disabled}
            onEdit={value => props.editGlobal('cooldownMs', value)}
          />
        </div>
      </details>
      {state.error !== null ? <p role="status" className={css.error}>{state.error}</p> : null}
      {state.failed ? <p role="status" className={css.error}>{props.t('saveFailed')}</p> : null}
      <div className={css.editorActions}>
        <button
          type="button"
          className={css.secondaryButton}
          disabled={!state.dirty || state.saving}
          onClick={props.discard}
        >
          {props.t('discard')}
        </button>
        <button
          type="button"
          className={css.primaryButton}
          disabled={!state.dirty || state.invalid || state.saving}
          onClick={props.save}
        >
          {props.t(state.saving ? 'saving' : 'save')}
        </button>
      </div>
    </div>
  )
}

/** One configured provider: a collapsed row that expands into its key editor. */
function ProviderRow(props: {
  provider: PoolDraftProvider
  open: boolean
  checking: boolean
  checkGated: boolean
  t: CustomWebSearchPoolCardProps['t']
  disabled: boolean
  onToggle: (providerId: string) => void
  onEditKey: PoolCardFace['editKey']
  onAddKey: PoolCardFace['addKey']
  onRemoveKey: PoolCardFace['removeKey']
  onRemove: PoolCardFace['removeProvider']
  onCheck: PoolCardFace['check']
}) {
  const { provider, t } = props
  const configured = provider.keys.some(key => key.configured)
  const keyCount = provider.keys.length === 1 ? t('webSearchPoolOneKey') : t('webSearchPoolKeyCount').replace('{count}', String(provider.keys.length))
  const stateLabel = configured ? t('webSearchPoolKeyReady') : t('webSearchPoolKeyUnset')
  return (
    <li className={css.rowCard}>
      <div className={css.rowHead}>
        <span className={css.rowIdentity}>
          <span className={css.rowName}>{provider.name}</span>
          {provider.keys.length > 0 ? <span className={css.rowTag}>{keyCount}</span> : null}
          <span
            className={`${css.credentialDot} ${configured ? css.credentialDotConfigured : css.credentialDotMissing}`}
            role="img"
            aria-label={stateLabel}
            title={stateLabel}
          />
        </span>
        <span className={css.rowActions}>
          <button
            type="button"
            className={css.secondaryButton}
            aria-label={`${t('webSearchPoolEdit')}: ${provider.name}`}
            onClick={() => props.onToggle(provider.id)}
          >
            {t('webSearchPoolEdit')}
          </button>
          <button
            type="button"
            className={css.dangerButton}
            disabled={props.disabled}
            aria-label={`${t('webSearchPoolRemoveProvider')}: ${provider.name}`}
            title={t('webSearchPoolRemoveProvider')}
            onClick={() => props.onRemove(provider.id)}
          >
            {t('webSearchPoolRemoveProvider')}
          </button>
        </span>
      </div>
      {props.open
        ? (
          <div className={css.editor}>
            <div className={css.editorHeader}>
              <span className={css.editorTitle}>{provider.name}</span>
              <span className={css.editorRoute}>{provider.endpoint}</span>
            </div>
            <div className={css.keysHeader}>
              <div className={css.keysHeaderText}>
                <h4 className={css.keysTitle}>{t('webSearchPoolKeysTitle')}</h4>
                <p className={css.keysHint}>{t('webSearchPoolKeysHint')}</p>
              </div>
              <div className={css.keysActions}>
                <button
                  type="button"
                  className={css.linkButton}
                  disabled={props.disabled || props.checking || props.checkGated}
                  title={props.checkGated ? t('webSearchPoolCheckDirty') : undefined}
                  onClick={() => props.onCheck(provider.id)}
                >
                  {props.checking ? t('webSearchPoolChecking') : t('webSearchPoolCheck')}
                </button>
                <button
                  type="button"
                  className={css.linkButton}
                  disabled={props.disabled}
                  onClick={() => props.onAddKey(provider.id)}
                >
                  <IconPlusOutline16 size={14} />
                  {t('webSearchPoolAddKey')}
                </button>
              </div>
            </div>
            {provider.keys.length === 0
              ? <p className={css.emptyKeys}>{t('webSearchPoolNoKeys')}</p>
              : (
                <div className={css.keyList}>
                  {provider.keys.map((key, index) => (
                    <KeyRow
                      key={key.id}
                      providerId={provider.id}
                      apiKey={key}
                      index={index}
                      t={t}
                      disabled={props.disabled}
                      onEdit={props.onEditKey}
                      onRemove={props.onRemoveKey}
                    />
                  ))}
                </div>
              )}
          </div>
        )
        : null}
    </li>
  )
}

/** One write-only key: labelled password input, remove affordance, and its state. */
function KeyRow(props: {
  providerId: string
  apiKey: PoolDraftKey
  index: number
  t: CustomWebSearchPoolCardProps['t']
  disabled: boolean
  onEdit: PoolCardFace['editKey']
  onRemove: PoolCardFace['removeKey']
}) {
  const { apiKey: key, t } = props
  const badge = keyBadge(key, t)
  return (
    <div className={css.field}>
      <div className={css.fieldHead}>
        <span className={css.fieldLabel}>{`${t('webSearchPoolKey')} ${props.index + 1}`}</span>
        <span className={clsx(css.keyState, badge.tone)}>{badge.text}</span>
      </div>
      <div className={css.keyRow}>
        <input
          id={`${props.providerId}-${key.id}`}
          className={css.input}
          type="password"
          autoComplete="off"
          value={key.secret}
          placeholder={key.configured ? t('webSearchPoolKeyReady') : t('webSearchPoolKeyUnset')}
          aria-label={`${t('webSearchPoolKey')} ${props.index + 1}`}
          disabled={props.disabled}
          onChange={(event) => { props.onEdit(props.providerId, key.id, event.target.value) }}
        />
        <button
          type="button"
          className={`${css.iconButton} ${css.iconButtonDanger}`}
          disabled={props.disabled}
          aria-label={`${t('webSearchPoolRemoveKey')}: ${props.index + 1}`}
          title={t('webSearchPoolRemoveKey')}
          onClick={() => props.onRemove(props.providerId, key.id)}
        >
          <IconTrashOutline16 size={14} />
        </button>
      </div>
      <p className={css.hint}>{key.check?.error ?? key.lastError ?? t('webSearchPoolKeyHint')}</p>
    </div>
  )
}

/** The badge text and tone one key's check and health state renders with. */
function keyBadge(key: PoolDraftKey, t: CustomWebSearchPoolCardProps['t']): { text: string; tone: string | undefined } {
  const check = key.check
  if (check !== undefined) {
    if (check.valid) {
      const credits = check.remaining !== undefined && check.limit !== undefined
        ? ` · ${t('webSearchPoolCredits').replace('{remaining}', String(check.remaining)).replace('{limit}', String(check.limit))}`
        : ''
      return { text: `${t('webSearchPoolCheckValid')}${credits}`, tone: css.keyStateOk }
    }
    return { text: t('webSearchPoolCheckInvalid'), tone: css.keyStateBad }
  }
  if (key.lastError !== undefined) return { text: key.lastError, tone: css.keyStateBad }
  if (key.quarantineUntil !== undefined) return { text: t('webSearchPoolKeyQuarantined'), tone: css.keyStateBad }
  if (key.cooldownUntil !== undefined) return { text: t('webSearchPoolKeyCooling'), tone: undefined }
  return { text: key.configured ? t('webSearchPoolKeyReady') : t('webSearchPoolKeyUnset'), tone: undefined }
}

/** One advanced numeric field in the section's label-over-input vocabulary. */
function NumberField(props: {
  id: string
  label: string
  hint: string
  invalidLabel: string
  text: string
  invalid: boolean
  disabled: boolean
  onEdit: (value: string) => void
}) {
  return (
    <div className={css.field}>
      <span className={css.fieldLabel}>{props.label}</span>
      <input
        id={props.id}
        className={css.input}
        type="text"
        inputMode="numeric"
        value={props.text}
        aria-label={props.label}
        aria-invalid={props.invalid}
        disabled={props.disabled}
        onChange={(event) => { props.onEdit(event.target.value) }}
      />
      <p className={props.invalid ? css.error : css.hint}>{props.invalid ? props.invalidLabel : props.hint}</p>
    </div>
  )
}

function isPositiveInteger(value: string): boolean {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0
}

function isNonNegativeInteger(value: string): boolean {
  const number = Number(value)
  return Number.isSafeInteger(number) && number >= 0
}

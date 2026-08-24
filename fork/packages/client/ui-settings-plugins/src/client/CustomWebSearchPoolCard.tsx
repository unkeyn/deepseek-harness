import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconPlusOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { SecretField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { PoolCardFace, PoolDraftProvider, ProviderPreset } from './custom-web-search-pool-controller.ts'
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

/** Render the search provider and multi-key pool settings card. */
export function CustomWebSearchPoolCard(props: CustomWebSearchPoolCardProps) {
  const state = props.useWebSearchPool(snapshot => snapshot)
  const disabled = !state.writable || state.saving
  return <PluginCard
    t={props.t}
    titleKey="webSearchPoolTitle"
    descriptionKey="webSearchPoolDescription"
    defaultOpen
    state={{ available: state.available, writable: state.writable, dirty: state.dirty, invalid: state.invalid, saving: state.saving, failed: state.failed }}
    onSave={props.save}
    onDiscard={props.discard}
  >
    <div className={css.providers}>
      {state.providers.map(provider => (
        <ProviderEditor
          key={provider.id}
          provider={provider}
          t={props.t}
          disabled={disabled}
          onEditKey={props.editKey}
          onAddKey={props.addKey}
          onRemoveKey={props.removeKey}
          onRemove={props.removeProvider}
        />
      ))}
    </div>
    {state.availablePresets.length > 0
      ? (
        <div className={css.addProviderRow}>
          <label className={css.addProviderLabel} htmlFor="web-search-pool-provider-type">
            {props.t('webSearchPoolAddProvider')}
          </label>
          <select
            className={css.providerSelect}
            id="web-search-pool-provider-type"
            disabled={disabled}
            defaultValue=""
            onChange={(event) => {
              const value = event.target.value
              if (value !== '') props.addProvider(value as ProviderPreset)
              event.currentTarget.value = ''
            }}
          >
            <option value="">{props.t('webSearchPoolChooseProvider')}</option>
            {state.availablePresets.map(preset => (
              <option value={preset} key={preset}>{props.t(presetLabel[preset])}</option>
            ))}
          </select>
        </div>
      )
      : null}
    <details className={css.advanced}>
      <summary>{props.t('webSearchPoolAdvanced')}</summary>
      <div className={css.advancedGrid}>
        <ValueField
          id="web-search-pool-max-attempts"
          label={props.t('webSearchPoolMaxAttempts')}
          hint={props.t('webSearchPoolMaxAttemptsHint')}
          overriddenLabel={props.t('overridden')}
          resetLabel={props.t('reset')}
          invalidLabel={props.t('invalidNumber')}
          numeric
          disabled={disabled}
          text={state.maxAttempts}
          overridden={false}
          invalid={!isPositiveInteger(state.maxAttempts)}
          onEdit={value => props.editGlobal('maxAttempts', value)}
          onReset={() => props.editGlobal('maxAttempts', '3')}
        />
        <ValueField
          id="web-search-pool-cooldown"
          label={props.t('webSearchPoolCooldown')}
          hint={props.t('webSearchPoolCooldownHint')}
          overriddenLabel={props.t('overridden')}
          resetLabel={props.t('reset')}
          invalidLabel={props.t('invalidNumber')}
          numeric
          disabled={disabled}
          text={state.cooldownMs}
          overridden={false}
          invalid={!isNonNegativeInteger(state.cooldownMs)}
          onEdit={value => props.editGlobal('cooldownMs', value)}
          onReset={() => props.editGlobal('cooldownMs', '30000')}
        />
      </div>
    </details>
    {state.error !== null ? <p role="status" className={css.error}>{state.error}</p> : null}
  </PluginCard>
}

function ProviderEditor(props: {
  provider: PoolDraftProvider
  t: CustomWebSearchPoolCardProps['t']
  disabled: boolean
  onEditKey: PoolCardFace['editKey']
  onAddKey: PoolCardFace['addKey']
  onRemoveKey: PoolCardFace['removeKey']
  onRemove: PoolCardFace['removeProvider']
}) {
  const { provider, t, disabled } = props
  return (
    <fieldset className={css.provider}>
      <div className={css.providerHeader}>
        <legend className={css.providerTitle}>{provider.name}</legend>
        <button
          className={css.iconButton}
          type="button"
          disabled={disabled}
          aria-label={`${t('webSearchPoolRemoveProvider')}: ${provider.name}`}
          title={t('webSearchPoolRemoveProvider')}
          onClick={() => props.onRemove(provider.id)}
        >
          <IconTrashOutline16 size={15} />
        </button>
      </div>
      <div className={css.keysHeader}>
        <div>
          <h4>{t('webSearchPoolKeysTitle')}</h4>
          <p>{t('webSearchPoolKeysHint')}</p>
        </div>
        <button className={css.secondaryButton} type="button" disabled={disabled} onClick={() => props.onAddKey(provider.id)}>
          <IconPlusOutline16 size={14} />
          {t('webSearchPoolAddKey')}
        </button>
      </div>
      {provider.keys.length === 0
        ? <p className={css.emptyKeys}>{t('webSearchPoolNoKeys')}</p>
        : (
          <div className={css.keyList}>
            {provider.keys.map((key, index) => (
              <div className={css.keyRow} key={key.id}>
                <div className={css.keyMain}>
                  <SecretField
                    id={`${provider.id}-${key.id}`}
                    label={`${t('webSearchPoolKey')} ${index + 1}`}
                    hint={key.lastError ?? (key.quarantineUntil !== undefined
                      ? t('webSearchPoolKeyQuarantined')
                      : key.cooldownUntil !== undefined ? t('webSearchPoolKeyCooling') : t('webSearchPoolKeyHint'))}
                    disabled={disabled}
                    text={key.secret}
                    configured={key.configured}
                    stateLabel={key.lastError ?? (key.quarantineUntil !== undefined
                      ? t('webSearchPoolKeyQuarantined')
                      : key.cooldownUntil !== undefined ? t('webSearchPoolKeyCooling')
                        : key.configured ? t('webSearchPoolKeyReady') : t('webSearchPoolKeyUnset'))}
                    onEdit={value => props.onEditKey(provider.id, key.id, value)}
                  />
                </div>
                <button
                  className={css.iconButton}
                  type="button"
                  disabled={disabled}
                  aria-label={`${t('webSearchPoolRemoveKey')}: ${index + 1}`}
                  title={t('webSearchPoolRemoveKey')}
                  onClick={() => props.onRemoveKey(provider.id, key.id)}
                >
                  <IconTrashOutline16 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
    </fieldset>
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

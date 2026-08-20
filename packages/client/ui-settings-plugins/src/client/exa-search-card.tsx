/**
 * The Exa search provider's card: its endpoint, its per-request search budget,
 * and the key — which is written through the credentials domain, never into
 * the settings section, so the literal never rides a response.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SecretField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { ExaSearchCardFace } from './exa-search-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the Exa search card. */
export type ExaSearchCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<ExaSearchCardFace>

/**
 * Render the Exa search card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function ExaSearchCard(props: ExaSearchCardProps) {
  const { t } = props
  const state = props.useExaSearchCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="exaSearchTitle"
      descriptionKey="exaSearchDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SecretField
        id="plugin-config-exa-search-key"
        label={t('exaSearchApiKey')}
        hint={t('exaSearchApiKeyHint')}
        // The credentials domain accepts a key even when the settings document
        // itself is read-only; they are separate stores with separate refusals.
        // Its own writability is what disables this control — a key sourced
        // from the process environment cannot be written from here.
        disabled={!state.apiKeyWritable}
        text={state.apiKey.text}
        configured={state.apiKeyConfigured}
        stateLabel={state.apiKeyConfigured ? t('exaSearchApiKeySet') : t('exaSearchApiKeyUnset')}
        onEdit={(text) => { props.edit('apiKey', text) }}
      />
      <ValueField
        id="plugin-config-exa-search-endpoint"
        label={t('exaSearchBaseUrl')}
        hint={t('exaSearchBaseUrlHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.baseURL}
        onEdit={(text) => { props.edit('baseURL', text) }}
        onReset={() => { props.resetField('baseURL') }}
      />
      <ValueField
        id="plugin-config-exa-search-search-type"
        label={t('exaSearchSearchType')}
        hint={t('exaSearchSearchTypeHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.searchType}
        onEdit={(text) => { props.edit('searchType', text) }}
        onReset={() => { props.resetField('searchType') }}
      />
      <ValueField
        id="plugin-config-exa-search-num-results"
        label={t('exaSearchNumResults')}
        hint={t('exaSearchNumResultsHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.numResults}
        onEdit={(text) => { props.edit('numResults', text) }}
        onReset={() => { props.resetField('numResults') }}
      />
      <ValueField
        id="plugin-config-exa-search-highlights-per-result"
        label={t('exaSearchHighlightsPerResult')}
        hint={t('exaSearchHighlightsPerResultHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.highlightsPerResult}
        onEdit={(text) => { props.edit('highlightsPerResult', text) }}
        onReset={() => { props.resetField('highlightsPerResult') }}
      />
    </PluginCard>
  )
}

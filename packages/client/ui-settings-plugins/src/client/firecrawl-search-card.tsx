/**
 * The Firecrawl search provider's card: its endpoint, its per-request search budget,
 * and the key — which is written through the credentials domain, never into
 * the settings section, so the literal never rides a response.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SecretField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { FirecrawlSearchCardFace } from './firecrawl-search-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the Firecrawl search card. */
export type FirecrawlSearchCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<FirecrawlSearchCardFace>

/**
 * Render the Firecrawl search card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function FirecrawlSearchCard(props: FirecrawlSearchCardProps) {
  const { t } = props
  const state = props.useFirecrawlSearchCard(snapshot => snapshot)
  const disabled = !state.writable
  return (
    <PluginCard
      t={t}
      titleKey="firecrawlSearchTitle"
      descriptionKey="firecrawlSearchDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <SecretField
        id="plugin-config-firecrawl-search-key"
        label={t('firecrawlSearchApiKey')}
        hint={t('firecrawlSearchApiKeyHint')}
        // The credentials domain accepts a key even when the settings document
        // itself is read-only; they are separate stores with separate refusals.
        // Its own writability is what disables this control — a key sourced
        // from the process environment cannot be written from here.
        disabled={!state.apiKeyWritable}
        text={state.apiKey.text}
        configured={state.apiKeyConfigured}
        stateLabel={state.apiKeyConfigured ? t('firecrawlSearchApiKeySet') : t('firecrawlSearchApiKeyUnset')}
        onEdit={(text) => { props.edit('apiKey', text) }}
      />
      <ValueField
        id="plugin-config-firecrawl-search-endpoint"
        label={t('firecrawlSearchBaseUrl')}
        hint={t('firecrawlSearchBaseUrlHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        disabled={disabled}
        {...state.baseURL}
        onEdit={(text) => { props.edit('baseURL', text) }}
        onReset={() => { props.resetField('baseURL') }}
      />
      <ValueField
        id="plugin-config-firecrawl-search-max-uses"
        label={t('firecrawlSearchMaxUses')}
        hint={t('firecrawlSearchMaxUsesHint')}
        overriddenLabel={t('overridden')}
        resetLabel={t('reset')}
        invalidLabel={t('invalidNumber')}
        numeric
        disabled={disabled}
        {...state.maxUses}
        onEdit={(text) => { props.edit('maxUses', text) }}
        onReset={() => { props.resetField('maxUses') }}
      />
    </PluginCard>
  )
}

/**
 * Cards that declare either an API-key pi-ai route or a dedicated Bearer
 * route, with one settings write followed by write-only credential storage.
 *
 * This is a create, not an edit, which is why it is its own card rather than
 * the provider editor with extra fields: the route id is being *chosen* here,
 * and the settings address does not exist until it is. One `settings.mutate`
 * sets the whole profile at `providers.<route>`; the key travels separately
 * through `credentials/set` under the reference the profile records, exactly as
 * an existing provider's key does.
 *
 * The three fields a hand-declared route cannot default — endpoint, protocol,
 * and at least one model — are required here rather than at load, so the
 * failure names the field while the user is still looking at it.
 *
 * There is deliberately no reasoning-effort control, here or on the editor
 * card: effort is a per-MODEL capability, and the models under one provider
 * disagree about it, so a provider-scoped control can only be set to a value
 * some of them reject. The composer's model picker offers each model its own
 * levels instead.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { JsonValue } from '@deepseek-ai/dsh-api-remotes/client'
import { apiKeyFailure } from './apiKey.ts'
import { EditorFooter } from './EditorFooter.tsx'
import { validateDeepSeekModels } from './DeepSeekModelsEditor.tsx'
import { ModelListEditor } from './ModelListEditor.tsx'
import type { ModelDraft } from './ModelListEditor.tsx'
<<<<<<< HEAD
import { deriveBearerRef, deriveKeyRef, deriveRefreshRef, messageOf } from './store.ts'
import { twinMindCredentialsFromCookieJson } from './twinMindCookieImport.ts'
=======
import { deriveKeyRef, messageOf } from './store.ts'
import type { ModelsWire } from './store.ts'
>>>>>>> upstream/master
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** The settings namespace a hand-declared provider is written into. */
const API_KEY_NS = 'llm-pi-ai'
const BEARER_NS = 'llm-bearer'

/** TwinMind's public web-client defaults; secrets are never embedded here. */
const TWINMIND_BASE_URL = 'https://api2.twinmind.com'
const TWINMIND_FIREBASE_API_KEY = 'AIzaSyD2Sd_NP3vA4rwvoroKqDefpXZeCMDXcIQ'

type AuthMethod = 'api-key' | 'bearer'

/**
 * A route id usable as a settings key AND as the stem of a credential name.
 * The leading letter is the second half of that: `deriveKeyRef` uppercases the
 * id and replaces every non-alphanumeric run with `_`, and a credential
 * reference is a POSIX shell identifier, which cannot start with a digit. A
 * digit-leading id passes every check this card makes and then fails at the
 * credential seam with a raw regular expression the user cannot act on.
 */
const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** Props of {@link CustomProviderCard}. */
export interface CustomProviderCardProps {
  /** Route ids already declared, so the card refuses to shadow one. */
  taken: readonly string[]
  /** Wire protocols the adapter can serve, in the order it reports them. */
  protocols: readonly string[]
  /** Fixed credential family for this entry point. */
  authorization?: AuthMethod
  /** Settings namespace owned by the selected adapter family. */
  namespace?: string
  /**
   * Revision of the owning provider namespace this card opened at, sent with
   * the create so a route another tab declared meanwhile is a refusal rather
   * than a silent overwrite of its whole profile.
   */
  revision: number
  /** Wire faces for the write and for interrogating the endpoint. */
  api: ModelsWire
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable writes (read-only settings provider). */
  readOnly: boolean
  /** Close the card; `changed` reports whether a provider was created. */
  onClose: (changed: boolean) => void
}

/**
 * Render the custom-provider creation card.
 * @param props - existing routes, protocol choices, wire faces, and copy.
 * @returns the creation card.
 */
export function CustomProviderCard(props: CustomProviderCardProps): ReactNode {
  const { taken, protocols, api, t } = props
<<<<<<< HEAD
  const authMethod = props.authorization ?? 'api-key'
  const namespace = props.namespace ?? API_KEY_NS
  const bearer = authMethod === 'bearer'
  // Captured at mount, like the editor's: the write must be judged against the
  // section this card was drafted over, not whatever it grew into meanwhile.
=======
  // The write is checked against the revision on which this draft was opened.
>>>>>>> upstream/master
  const [openedAt] = useState(() => props.revision)
  const [route, setRoute] = useState(bearer ? 'twinmind' : '')
  const [displayName, setDisplayName] = useState(bearer ? 'TwinMind' : '')
  const [baseURL, setBaseURL] = useState(bearer ? TWINMIND_BASE_URL : '')
  const [protocol, setProtocol] = useState(protocols[0] ?? '')
  const [keyDraft, setKeyDraft] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(bearer)
  const [refreshDraft, setRefreshDraft] = useState('')
  const [firebaseApiKey, setFirebaseApiKey] = useState(bearer ? TWINMIND_FIREBASE_API_KEY : '')
  const [models, setModels] = useState<readonly ModelDraft[]>(bearer ? [{ id: 'auto' }] : [])
  const [cookieDraft, setCookieDraft] = useState('')
  const [cookieFailure, setCookieFailure] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  /**
   * The profile write landed. Only the key write can still be outstanding, so
   * the fields that describe the provider are settled and the retry path is
   * the credential alone.
   */
  const [committed, setCommitted] = useState(false)
  const [primaryStored, setPrimaryStored] = useState(false)
  const [refreshStored, setRefreshStored] = useState(false)
  const disabled = props.readOnly || busy
  /** Everything but the key stops being editable once the provider exists. */
  const profileDisabled = disabled || committed

  const routeInvalid = route.length > 0 && !ROUTE_PATTERN.test(route)
  const routeTaken = taken.includes(route)
  // Rows are checked by the same per-row validator the editor cards use, so a
  // bad row is named by its position here too. Capacities have route-level
  // fallbacks; what a route cannot default is at least one model.
  const modelFailure = validateDeepSeekModels(models)
  const keyFailure = apiKeyFailure(keyDraft)
  // The typed key with paste whitespace removed. A blank field yields an empty
  // string, which the create path reads as "no key supplied" — a route may
  // legitimately authenticate through the provider's own ambient discovery.
  const keyValue = keyDraft.trim()
  const refreshValue = refreshDraft.trim()
  const bearerMissing = authMethod === 'bearer' && keyValue.length === 0
  const refreshMissing = authMethod === 'bearer' && autoRefresh && refreshValue.length === 0
  const firebaseApiKeyMissing = authMethod === 'bearer' && autoRefresh && firebaseApiKey.trim().length === 0
  const ready = route.length > 0 && !routeInvalid && !routeTaken
    && baseURL.length > 0 && models.length > 0 && modelFailure === undefined
    && keyFailure === undefined && !bearerMissing && !refreshMissing && !firebaseApiKeyMissing
  // The one blocked gate worth a line under the form. A satisfied card says
  // nothing at all rather than printing an empty paragraph.
  const hint = failure !== undefined || ready
    // The key field prints its own failure directly beneath itself, so a card
    // blocked only by the key stays silent here rather than answering with the
    // next unmet gate — which is satisfied, and reads as a second, false fault.
    || keyFailure !== undefined || bearerMissing || refreshMissing || firebaseApiKeyMissing
    // Same for the route id, and it must be tested rather than assumed: the
    // fallback arm below reads "no models yet", so an unmet route gate would
    // fall through to it and contradict the filled-in list right above.
    || route.length === 0 || routeInvalid || routeTaken
    ? undefined
    : baseURL.length === 0
      ? t('customNeedsBaseUrl')
      : modelFailure !== undefined
        ? `${t('model')} ${String(modelFailure.index + 1)}: ${t(modelFailure.key)}`
        : t('customNeedsModels')

  /** Perform the create, returning a failure message or undefined. */
  const createOnce = async (): Promise<string | undefined> => {
    const keyRef = authMethod === 'bearer' ? deriveBearerRef(route) : deriveKeyRef(route)
    const refreshRef = deriveRefreshRef(route)
    const storesKey = authMethod === 'bearer' || keyValue.length > 0
    if (!committed) {
      let credentialProfile: Record<string, unknown> = {}
      if (storesKey) {
        if (authMethod === 'bearer') {
          credentialProfile = {
            auth: {
              type: 'bearer',
              accessTokenEnv: keyRef,
              ...autoRefresh ? {
                refresh: {
                  type: 'firebase',
                  refreshTokenEnv: refreshRef,
                  apiKey: firebaseApiKey.trim(),
                },
              } : {},
            },
          }
        } else {
          credentialProfile = { apiKeyEnv: keyRef }
        }
      }
      const profile = {
        ...displayName.length === 0 ? {} : { displayName },
        // The profile names the conventional reference only when this card is
        // about to store a key, matching the editor: a route declared with the
        // key left blank keeps its provider-native auth path (a credential
        // chain, ADC) instead of resolving a reference nothing ever sets.
        ...credentialProfile,
        api: protocol,
        baseURL,
        models: models.map(model => ({ ...model })),
      }
<<<<<<< HEAD
      const response = await api.settings.mutate({
        ns: namespace,
        ops: [{ op: 'set', path: ['providers', route], value: profile }],
        // `taken` is a snapshot too, so the id check alone cannot see a route
        // declared after this card opened; the revision makes that race a
        // `settings-conflict` instead of a write over the other profile.
        expectedRevision: openedAt,
      })
      if (!response.result.ok) return response.result.error.message
=======
      // `taken` is a snapshot too, so the id check alone cannot see a route
      // declared after this card opened; the revision makes that race a
      // `settings-conflict` instead of a write over the other profile.
      const response = await api.settings.mutate(
        NS,
        [{ op: 'set', path: ['providers', route], value: profile as JsonValue }],
        openedAt,
      )
      if (!response.ok) return response.error.message
>>>>>>> upstream/master
      // The provider now exists. A retry after the key write below fails must
      // not re-run this mutate: the revision it holds is the one this write
      // just superseded, so the Host would answer `settings-conflict` and the
      // key could never be stored from this card at all.
      setCommitted(true)
    }
<<<<<<< HEAD
    if (storesKey && !primaryStored) {
      const stored = await api.credentials.set({ ref: keyRef, value: keyValue })
      // The profile landed; saying the key did not is the only honest report,
      // and the retry above now goes straight back to this write.
      if (!stored.result.ok) return stored.result.error.message
      setPrimaryStored(true)
    }
    if (authMethod === 'bearer' && autoRefresh && !refreshStored) {
      const stored = await api.credentials.set({ ref: refreshRef, value: refreshValue })
      if (!stored.result.ok) return stored.result.error.message
      setRefreshStored(true)
=======
    if (storesKey) {
      const stored = await api.credentials.set(keyRef, keyValue)
      // The profile landed; saying the key did not is the only honest report,
      // and the retry above now goes straight back to this write.
      if (!stored.ok) return stored.error.message
>>>>>>> upstream/master
    }
    return undefined
  }

  const create = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const outcome = await createOnce()
      if (outcome !== undefined) {
        setFailure(outcome)
        return
      }
      props.onClose(true)
    } catch (error) {
      // A transport failure rejects rather than answering; without this the
      // card would stay busy with nothing shown.
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles['editor']}>
      <div className={styles['editorHeader']}>
        <span className={styles['editorTitle']}>{t(bearer ? 'bearerCustomTitle' : 'customTitle')}</span>
      </div>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('customRoute')}</span>
        <input
          className={styles['input']}
          type="text"
          value={route}
          placeholder="acme-gateway"
          aria-label={t('customRoute')}
          disabled={profileDisabled}
          onChange={(event) => { setRoute(event.target.value) }}
        />
      </div>
      {/* A rejected id reads as a fault, not as guidance — the same split the
          key field below already makes between its failure and its hint. */}
      {routeInvalid || routeTaken
        ? <p className={styles['error']}>{t(routeInvalid ? 'customRouteInvalid' : 'customRouteTaken')}</p>
        : <p className={styles['advancedHint']}>{t('customRouteHint')}</p>}
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('customDisplayName')}</span>
        <input
          className={styles['input']}
          type="text"
          value={displayName}
          placeholder={route.length === 0 ? t('customDisplayName') : route}
          aria-label={t('customDisplayName')}
          disabled={profileDisabled}
          onChange={(event) => { setDisplayName(event.target.value) }}
        />
      </div>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('baseUrl')}</span>
        <input
          className={styles['input']}
          type="text"
          value={baseURL}
          placeholder={t('customBaseUrlPlaceholder')}
          aria-label={t('baseUrl')}
          disabled={profileDisabled}
          onChange={(event) => { setBaseURL(event.target.value) }}
        />
      </div>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t('customApi')}</span>
        <select
          className={`${styles['input']} ${styles['selectInput']}`}
          value={protocol}
          aria-label={t('customApi')}
          disabled={profileDisabled}
          onChange={(event) => { setProtocol(event.target.value) }}
        >
          {protocols.map(choice => <option key={choice} value={choice}>{choice}</option>)}
        </select>
      </div>
      {bearer
        ? (
          <div className={styles['field']}>
            <span className={styles['fieldLabel']}>{t('cookieImport')}</span>
            <textarea
              className={styles['textarea']}
              value={cookieDraft}
              placeholder={t('cookieImportPlaceholder')}
              aria-label={t('cookieImport')}
              disabled={disabled}
              onChange={(event) => { setCookieDraft(event.target.value); setCookieFailure(undefined) }}
            />
            <button
              type="button"
              className={styles['secondaryButton']}
              disabled={disabled || cookieDraft.trim().length === 0}
              onClick={() => {
                try {
                  const imported = twinMindCredentialsFromCookieJson(cookieDraft)
                  setKeyDraft(imported.accessToken)
                  setRefreshDraft(imported.refreshToken)
                  setAutoRefresh(true)
                  setCookieDraft('')
                  setCookieFailure(undefined)
                } catch (error) {
                  setCookieFailure(messageOf(error))
                }
              }}
            >
              {t('cookieImportAction')}
            </button>
            {cookieFailure === undefined
              ? <p className={styles['advancedHint']}>{t('cookieImportHint')}</p>
              : <p className={styles['error']}>{cookieFailure}</p>}
          </div>
        )
        : null}
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{t(authMethod === 'bearer' ? 'bearerInput' : 'keyInput')}</span>
        <input
          className={styles['input']}
          type="password"
          autoComplete="off"
          value={keyDraft}
          placeholder={t(authMethod === 'bearer' ? 'bearerPlaceholder' : 'keyPlaceholder')}
          aria-label={t(authMethod === 'bearer' ? 'bearerInput' : 'keyInput')}
          disabled={disabled}
          onChange={(event) => { setKeyDraft(event.target.value) }}
        />
        {/* A create card has no stored key to keep, so the blank case says
            what a blank field means here instead: this route may authenticate
            through the provider's own ambient discovery or OAuth. */}
        {keyFailure === undefined
          ? bearerMissing ? <p className={styles['error']}>{t('bearerRequired')}</p> : null
          : <p className={styles['error']}>{t(keyFailure === 'keyBlank' ? 'keyBlankNew' : keyFailure)}</p>}
      </div>
      {authMethod === 'bearer'
        ? (
          <>
            <label className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('autoRefresh')}</span>
              <input
                type="checkbox"
                checked={autoRefresh}
                disabled={profileDisabled}
                onChange={(event) => { setAutoRefresh(event.target.checked) }}
              />
            </label>
            {autoRefresh
              ? (
                <>
                  <div className={styles['field']}>
                    <span className={styles['fieldLabel']}>{t('refreshInput')}</span>
                    <input
                      className={styles['input']}
                      type="password"
                      autoComplete="off"
                      value={refreshDraft}
                      placeholder={t('refreshPlaceholder')}
                      aria-label={t('refreshInput')}
                      disabled={disabled}
                      onChange={(event) => { setRefreshDraft(event.target.value) }}
                    />
                    {refreshMissing ? <p className={styles['error']}>{t('refreshRequired')}</p> : null}
                  </div>
                  <div className={styles['field']}>
                    <span className={styles['fieldLabel']}>{t('firebaseApiKey')}</span>
                    <input
                      className={styles['input']}
                      type="text"
                      value={firebaseApiKey}
                      aria-label={t('firebaseApiKey')}
                      disabled={profileDisabled}
                      onChange={(event) => { setFirebaseApiKey(event.target.value) }}
                    />
                    {firebaseApiKeyMissing ? <p className={styles['error']}>{t('firebaseApiKeyRequired')}</p> : null}
                  </div>
                </>
              )
              : null}
          </>
        )
        : null}
      <ModelListEditor
        models={models}
        onChange={setModels}
        probe={{
          settingsNs: namespace,
          baseURL,
          api: protocol,
          ...keyValue.length === 0 ? {} : { apiKey: keyValue },
        }}
        probeBlocked={keyFailure === 'keyBlank' ? 'keyBlankNew' : keyFailure}
        api={api}
        t={t}
        disabled={profileDisabled}
      />
      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
      {/* Only the gates with something to say render; the route-id gate has its
          own field-level hint, so its blocked state would print an empty line. */}
      {hint === undefined ? null : <p className={styles['advancedHint']}>{hint}</p>}
      <EditorFooter
        t={t}
        busy={busy}
        submitDisabled={disabled || !ready}
        submitLabelKey="create"
        submitBusyLabelKey="creating"
        onCancel={() => { props.onClose(committed) }}
        onSubmit={() => { void create() }}
      />
    </div>
  )
}

/** Props for the separate Bearer-provider entry point. */
export type BearerProviderCardProps = Omit<
  CustomProviderCardProps,
  'authorization' | 'namespace' | 'protocols'
>

/** Render the dedicated Bearer provider card owned by `llm-bearer`. */
export function BearerProviderCard(props: BearerProviderCardProps): ReactNode {
  return (
    <CustomProviderCard
      {...props}
      authorization="bearer"
      namespace={BEARER_NS}
      protocols={['twinmind-chat']}
    />
  )
}

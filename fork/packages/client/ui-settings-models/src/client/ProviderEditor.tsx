/**
 * One provider's editor card, hand-written per adapter family: the primary
 * field is a single write-only **API key** input (the page never asks for an
 * environment-variable name — a typed key stores through `credentials.set`
 * under the profile's reference, deriving `<ROUTE>_API_KEY` when the profile
 * has none. The pi-ai profile records that derivation as `apiKeyEnv` only when
 * a key is entered; a blank key materializes a reference-free profile for
 * provider-native authentication);
 * the collapsed 自定义设置 area carries the per-family extras (`baseURL` for
 * both families, DeepSeek's id/name/context-window model catalog, and the
 * display name and wire protocol of a pi-ai route the adapter does not ship —
 * the two fields the create card asked that route for, editable here for the
 * same reason).
 * Reasoning effort is deliberately absent: it is a per-MODEL capability, and
 * the models under one provider disagree about it, so a provider-scoped
 * control can only be set to a value some of them reject. The composer's
 * model picker offers each model its own levels; `settings.yaml` keeps the
 * profile field for a deployment that knows its route. Everything else stays
 * owned by `settings.yaml`. Profile edits land as minimal `settings.mutate`
 * path ops against the stored section — the card names only the fields it can
 * see instead of rebuilding the whole subtree from a partial descriptor.
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-api-remotes/client'
import { IconPlusOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  DeepSeekModelsEditor, modelDrafts, validateDeepSeekModels,
} from './DeepSeekModelsEditor.tsx'
import { apiKeyFailure } from './apiKey.ts'
import { EditorFooter } from './EditorFooter.tsx'
import { ModelListEditor } from './ModelListEditor.tsx'
import {
  bearerCredentialsFromCookieJson, refreshImportedFirebaseCredentials,
} from './bearerCookieImport.ts'
import { deriveKeyRef, deriveRefreshRef, messageOf, protocolChoices } from './store.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import type { CredentialView, ModelsApi, SettingsPathOpView } from './models-api.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** The settings namespace the key-pool plugin owns; absence hides extra keys. */
const KEY_POOL_NS = 'key-pool'

/** One staged additional API key row. */
interface ExtraKeyDraft {
  id: string
  ref: string
  secret: string
  configured: boolean
}

/** The key-pool document shape this editor reads and writes. */
interface KeyPoolPools {
  pools?: Array<{ provider: string; keys: Array<{ ref: string; enabled?: boolean }> }>
}

/** Per-adapter-family curated field sets (unknown namespaces get the hint alone). */
type EditorLayout = 'deepseek' | 'pi-ai' | 'unknown'

/** The public DeepSeek endpoint shown as the deepseek base-URL placeholder. */
const DEEPSEEK_PUBLIC_BASE_URL = 'https://api.deepseek.com'

/** Props of {@link ProviderEditor}. */
export interface ProviderEditorProps {
  /** Provider route id. */
  provider: string
  /** Display name for the card title. */
  displayName: string
  /** Hide the title row (the add card renders its own provider select). */
  hideTitle?: boolean
  /**
   * Whether the adapter reports this route as hand-declared — absent from its
   * installed catalog. Such a route carries its own wire protocol, chosen when
   * it was created and editable here for the same reason; a catalog route's
   * models each carry theirs, so a route-level protocol there could only
   * override every one of them and the card does not offer it.
   */
  declared?: boolean
  /** The owning namespace view (schema, layers, secrets). */
  namespace: SettingsNamespaceView
  /** Settings-owned synchronous schema and immutable path operations. */
  schema: SettingsSchemaOperations
  /** Path from the section root to this provider's profile. */
  settingsPath: readonly string[]
  /** Wire faces for writes and for interrogating a provider endpoint. */
  api: ModelsApi
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable writes (read-only settings provider). */
  readOnly: boolean
  /** Render only the credential field and actions, without provider settings. */
  credentialOnly?: boolean
  /** Require a newly entered credential before this editor can submit. */
  credentialRequired?: boolean
  /** Give the credential field initial focus when this editor mounts. */
  autoFocusCredential?: boolean
  /** Override the dismiss action copy. */
  cancelLabel?: keyof typeof en
  /** Override the idle commit action copy. */
  submitLabel?: keyof typeof en
  /** Override the in-flight commit action copy. */
  submitBusyLabel?: keyof typeof en
  /** Close the editor; `changed` reports whether an Apply committed. */
  onClose: (changed: boolean) => void
}

/** A user-section subtree as a plain draft object (absent → empty). */
function draftAt(
  schema: SettingsSchemaOperations,
  namespace: SettingsNamespaceView,
  path: readonly string[],
): Record<string, unknown> {
  const subtree = schema.getPath(namespace.user, path)
  if (typeof subtree !== 'object' || subtree === null || Array.isArray(subtree)) return {}
  return structuredClone(subtree) as Record<string, unknown>
}

/**
 * The minimal path ops carrying `after` over `before`, both as the card sees
 * them. Only keys the card observed are named; fields absent from both sides
 * produce no op, which is why edits are path-addressed rather than a rebuilt
 * section.
 * @param base - path of the edited subtree inside the user section.
 * @param before - the subtree as loaded, or undefined when it is new.
 * @param after - the subtree as edited.
 * @returns ordered set/unset ops; empty when nothing changed.
 */
export function pathOps(
  base: readonly string[],
  before: unknown,
  after: Record<string, unknown>,
): SettingsPathOpView[] {
  const previous = typeof before === 'object' && before !== null && !Array.isArray(before)
    ? before as Record<string, unknown>
    : {}
  const ops: SettingsPathOpView[] = []
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(previous[key]) === JSON.stringify(value)) continue
    ops.push({ op: 'set', path: [...base, key], value })
  }
  for (const key of Object.keys(previous)) {
    if (!(key in after)) ops.push({ op: 'unset', path: [...base, key] })
  }
  return ops
}

/** The editor layout the owning namespace selects. */
function layoutOf(ns: string): EditorLayout {
  if (ns === 'llm-deepseek') return 'deepseek'
  if (ns === 'llm-pi-ai' || ns === 'llm-bearer') return 'pi-ai'
  return 'unknown'
}

/** The credential reference this profile resolves keys through. */
function refFor(
  schema: SettingsSchemaOperations,
  namespace: SettingsNamespaceView,
  path: readonly string[],
  provider: string,
): string {
  const profile = schema.getPath(namespace.value, path)
  const named = typeof profile === 'object' && profile !== null
    ? (profile as { apiKeyEnv?: unknown }).apiKeyEnv
    : undefined
  if (typeof named === 'string' && named.length > 0) return named
  const auth = typeof profile === 'object' && profile !== null ? (profile as { auth?: unknown }).auth : undefined
  const access = typeof auth === 'object' && auth !== null
    ? (auth as { accessTokenEnv?: unknown }).accessTokenEnv
    : undefined
  return typeof access === 'string' && access.length > 0 ? access : deriveKeyRef(provider)
}

/** Firebase refresh reference selected by an effective Bearer profile. */
function refreshRefFor(profile: unknown): string | undefined {
  if (typeof profile !== 'object' || profile === null) return undefined
  const auth = (profile as { auth?: unknown }).auth
  if (typeof auth !== 'object' || auth === null) return undefined
  const refresh = (auth as { refresh?: unknown }).refresh
  if (typeof refresh !== 'object' || refresh === null) return undefined
  const ref = (refresh as { refreshTokenEnv?: unknown }).refreshTokenEnv
  return typeof ref === 'string' && ref.length > 0 ? ref : undefined
}

/** Whether the effective profile explicitly selected Bearer authorization. */
function isBearerProfile(profile: unknown): boolean {
  if (typeof profile !== 'object' || profile === null) return false
  const auth = (profile as { auth?: unknown }).auth
  return typeof auth === 'object' && auth !== null && (auth as { type?: unknown }).type === 'bearer'
}

/**
 * Render one provider's editing card.
 * @param props - the addressed profile plus wire faces and copy.
 * @returns the editor card.
 */
export function ProviderEditor(props: ProviderEditorProps): ReactNode {
  const { namespace, schema, settingsPath, api, t } = props
  const [draft, setDraft] = useState<Record<string, unknown>>(() => draftAt(schema, namespace, settingsPath))
  const [keyDraft, setKeyDraft] = useState('')
  const [refreshDraft, setRefreshDraft] = useState('')
  const [cookieDraft, setCookieDraft] = useState('')
  const [cookieFailure, setCookieFailure] = useState<string | undefined>(undefined)
  const [manualCredentialsOpen, setManualCredentialsOpen] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(
    () => refreshRefFor(schema.getPath(namespace.value, settingsPath)) !== undefined,
  )
  const [keyState, setKeyState] = useState<CredentialView | undefined>(undefined)
  const [refreshState, setRefreshState] = useState<CredentialView | undefined>(undefined)
  const [extraKeys, setExtraKeys] = useState<ExtraKeyDraft[]>([])
  const [removedExtraRefs, setRemovedExtraRefs] = useState<string[]>([])
  const [keyPoolView, setKeyPoolView] = useState<{ revision: number; writable: boolean } | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  // A settings success advances both retry baselines immediately. Keeping the
  // derived fields in the draft prevents a pushed namespace refresh from
  // turning them into deletions when the following credential write is retried.
  const [committedOriginal, setCommittedOriginal] = useState<unknown>(
    () => schema.getPath(namespace.user, settingsPath),
  )
  const [expectedRevision, setExpectedRevision] = useState(() => namespace.revision)
  const root = useMemo(() => schema.rehydrate(namespace.schema), [namespace.schema, schema])
  const node = useMemo(() => schema.nodeAtPath(root, settingsPath), [root, schema, settingsPath])
  const fallback = schema.getPath(namespace.value, settingsPath)
  const disabled = props.readOnly || busy
  const layout = layoutOf(namespace.ns)
  const keyRef = refFor(schema, namespace, settingsPath, props.provider)
  const bearer = namespace.ns === 'llm-bearer' || isBearerProfile(fallback)
  const configuredRefreshRef = refreshRefFor(fallback)
  const refreshRef = autoRefresh ? configuredRefreshRef ?? deriveRefreshRef(props.provider) : undefined
  // The same schema read the create card makes, so the choices offered here
  // and there cannot drift apart: both come from the adapter's own `Config`.
  // Only the pi-ai layout has a per-route protocol for the read to find, and
  // it rehydrates the whole section schema, so the other layouts skip it.
  const protocols = useMemo(
    () => layout === 'pi-ai' ? protocolChoices(namespace, schema) : [],
    [layout, namespace, schema],
  )

  useEffect(() => {
    let stale = false
    setKeyState(undefined)
    setRefreshState(undefined)
    // The key state is a placeholder hint, not a precondition for editing:
    // neither a business rejection nor a transport failure may reach the
    // browser as an unhandled rejection, so the card simply renders without
    // the "already configured" hint.
    const refs = refreshRef === undefined ? [keyRef] : [keyRef, refreshRef]
    void api.credentials.describe({ refs }).then(
      (response) => {
        if (stale || !response.result.ok) return
        setKeyState(response.result.value.credentials[keyRef])
        if (refreshRef !== undefined) setRefreshState(response.result.value.credentials[refreshRef])
      },
      () => undefined,
    )
    return () => { stale = true }
  }, [api.credentials, keyRef, refreshRef])

  // The additional keys live in the key-pool namespace, not in this profile.
  // A deployment without the key-pool plugin has no such namespace and the
  // section stays hidden; the primary reference is the pool's first entry and
  // is edited by the field above, so only the rest of the pool shows here.
  useEffect(() => {
    let stale = false
    setKeyPoolView(undefined)
    setExtraKeys([])
    setRemovedExtraRefs([])
    void api.settings.describe({}).then(async (response) => {
      if (stale || !response.result.ok) return
      const poolNs = response.result.value.namespaces.find(candidate => candidate.ns === KEY_POOL_NS)
      if (poolNs === undefined) return
      // The document-level write flag governs the pool membership write; the
      // namespace view itself carries no per-section flag.
      setKeyPoolView({ revision: poolNs.revision, writable: response.result.value.writable })
      const pools = (poolNs.value as KeyPoolPools | undefined)?.pools
      const refs = (pools?.find(pool => pool.provider === props.provider)?.keys ?? [])
        .map(key => key.ref)
        .filter(ref => ref !== keyRef)
      setExtraKeys(refs.map((ref, index) => ({ id: `extra-${index + 1}`, ref, secret: '', configured: false })))
      if (refs.length === 0) return
      const badges = await api.credentials.describe({ refs })
      if (stale || !badges.result.ok) return
      const badgeView = badges.result.value
      setExtraKeys(current => current.map(key => ({
        ...key,
        configured: badgeView.credentials[key.ref]?.configured ?? false,
      })))
    }, () => undefined)
    return () => { stale = true }
  }, [api, keyRef, props.provider])

  const stringAt = (source: unknown, key: string): string | undefined => {
    const value = schema.getPath(source, [key])
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined
  }
  const stringPathAt = (source: unknown, path: readonly string[]): string | undefined => {
    const value = schema.getPath(source, path)
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined
  }
  const setField = (key: string, next: string | undefined): void => {
    // A value of nothing but whitespace is cleared, not stored: `stringAt`
    // already reports it as absent, so the field would otherwise render empty
    // while the draft still carried the spaces into `settings.yaml`, where
    // both adapters would accept that non-empty string as a real value.
    const value = next === undefined || next.trim().length === 0 ? undefined : next
    setDraft(current => value === undefined
      ? schema.deletePath(current, [key])
      : schema.setPath(current, [key], value))
  }
  const setNestedField = (path: readonly string[], next: string | undefined): void => {
    const value = next === undefined || next.trim().length === 0 ? undefined : next
    setDraft(current => value === undefined
      ? schema.deletePath(current, path)
      : schema.setPath(current, path, value))
  }
  const setRefreshEnabled = (enabled: boolean): void => {
    setAutoRefresh(enabled)
    setDraft(current => {
      if (!enabled) return schema.deletePath(current, ['auth', 'refresh'])
      const effective = schema.getPath(fallback, ['auth', 'refresh'])
      const seed = typeof effective === 'object' && effective !== null
        ? structuredClone(effective)
        : { type: 'firebase', refreshTokenEnv: deriveRefreshRef(props.provider) }
      return schema.setPath(current, ['auth', 'refresh'], seed)
    })
  }

  // The model list is validated by the same per-row checker for both families,
  // so a bad row is named by its position rather than by a blanket message.
  const modelFailure = validateDeepSeekModels(schema.getPath(draft, ['models']))
  const keyFailure = apiKeyFailure(keyDraft)
  const refreshFailure = apiKeyFailure(refreshDraft)
  const refreshEndpointValue = stringPathAt(draft, ['auth', 'refresh', 'endpoint'])
    ?? stringPathAt(fallback, ['auth', 'refresh', 'endpoint'])
  const refreshApiKeyValue = stringPathAt(draft, ['auth', 'refresh', 'apiKey'])
    ?? stringPathAt(fallback, ['auth', 'refresh', 'apiKey'])
  const refreshEndpointMissing = bearer && autoRefresh && refreshEndpointValue === undefined
  const refreshApiKeyMissing = bearer && autoRefresh && refreshApiKeyValue === undefined
  const refreshCredentialMissing = bearer && autoRefresh
    && refreshDraft.trim().length === 0 && refreshState?.configured !== true
  // What a probe or a write must carry: the typed key with paste whitespace
  // removed. A blank field yields an empty string, which both call sites read
  // as "no key supplied" rather than as a key — that is how a card whose
  // provider already has a stored key is edited without re-entering it.
  const keyValue = keyDraft.trim()
  const credentialRequiredFailure = props.credentialRequired === true
    && keyDraft.length > 0 && keyValue.length === 0
    ? 'keyRequired' as const
    : undefined
  const shownKeyFailure = credentialRequiredFailure ?? keyFailure
  // What the form currently shows, which is what an interrogation must ask:
  // an edited-but-unsaved endpoint, and a key typed but not yet stored.
  const probeApi = stringAt(draft, 'api') ?? stringAt(fallback, 'api')
  const probeBaseURL = stringAt(draft, 'baseURL') ?? stringAt(fallback, 'baseURL')
  const probeModelsURL = stringAt(draft, 'modelsURL') ?? stringAt(fallback, 'modelsURL')
  const probe = {
    settingsNs: namespace.ns,
    // Naming the route lets an adapter that already describes it answer from
    // its own registry — better metadata, no network call, no endpoint needed.
    provider: props.provider,
    ...bearer
      ? probeModelsURL === undefined ? {} : { modelsURL: probeModelsURL }
      : probeBaseURL === undefined ? {} : { baseURL: probeBaseURL },
    ...probeApi === undefined ? {} : { api: probeApi },
    ...keyValue.length === 0 ? {} : { apiKey: keyValue },
  }
  /**
   * The write for this card, or a failure message. Every edit travels as
   * path ops against the STORED section: the draft comes from the redacted
   * descriptor, so a wholesale replace rebuilt from it could delete fields
   * outside the card. Ops name only the fields this card can see.
   */
  const applyOnce = async (): Promise<string | undefined> => {
    const ns = namespace.ns
    // A pi-ai profile names the conventional reference only when this page is
    // about to store a key. Otherwise the provider keeps its native auth path.
    const next = layout === 'pi-ai' && !bearer && stringAt(draft, 'apiKeyEnv') === undefined
      && stringAt(fallback, 'apiKeyEnv') === undefined && keyValue.length > 0
      ? schema.setPath(draft, ['apiKeyEnv'], keyRef)
      : draft
    if (props.credentialOnly !== true) {
      // The same checker gates the submit button, so a card cannot reach this
      // with a bad row; it stays because the schema check below would refuse
      // the write with a message naming a path instead of the row, and because
      // nothing but this function decides what is written.
      const failure = validateDeepSeekModels(schema.getPath(next, ['models']))
      /* v8 ignore next 3 -- unreachable from the card: the same failure disables submit */
      if (failure !== undefined) {
        return `${t('model')} ${String(failure.index + 1)}: ${t(failure.key)}`
      }
    }
    /* v8 ignore next -- apply is only reachable from the rendered card, which required a resolved node */
    if (props.credentialOnly !== true && node !== undefined && settingsPath.length === 0) {
      const sectionError = schema.validate(node, next)
      if (sectionError !== undefined) return sectionError
    }
    const materializesNativeProfile = layout === 'pi-ai'
      && fallback === undefined
      && committedOriginal === undefined
      && Object.keys(next).length === 0
    const ops: SettingsPathOpView[] = props.credentialOnly === true
      ? []
      : materializesNativeProfile
        ? [{ op: 'set', path: [...settingsPath], value: {} }]
        : pathOps(settingsPath, committedOriginal, next)
    if (ops.length > 0) {
      const response = await api.settings.mutate({ ns, ops, expectedRevision })
      if (!response.result.ok) {
        return response.result.error.code === 'settings-conflict'
          ? t('conflict')
          : response.result.error.message
      }
      setCommittedOriginal(schema.getPath(response.result.value.user, settingsPath))
      setExpectedRevision(response.result.value.revision)
      setDraft(next)
    }
    if (keyValue.length > 0) {
      const stored = await api.credentials.set({ ref: keyRef, value: keyValue })
      if (!stored.result.ok) return stored.result.error.message
    }
    const refreshValue = refreshDraft.trim()
    if (refreshRef !== undefined && refreshValue.length > 0) {
      const stored = await api.credentials.set({ ref: refreshRef, value: refreshValue })
      if (!stored.result.ok) return stored.result.error.message
    }
    // Additional keys: removed references leave the credential store first
    // (idempotent), new values store under their derived references, and the
    // pool membership is one set op over the freshly described document —
    // the revision it carries is the one this write is fenced against.
    if (keyPoolView !== undefined) {
      for (const ref of removedExtraRefs) {
        const unset = await api.credentials.unset({ ref })
        if (!unset.result.ok) return unset.result.error.message
      }
      for (const key of extraKeys) {
        const value = key.secret.trim()
        if (value.length === 0) continue
        const stored = await api.credentials.set({ ref: key.ref, value })
        if (!stored.result.ok) return stored.result.error.message
      }
      const described = await api.settings.describe({})
      if (!described.result.ok) return described.result.error.message
      const poolNs = described.result.value.namespaces.find(candidate => candidate.ns === KEY_POOL_NS)
      if (poolNs !== undefined) {
        const others = ((poolNs.value as KeyPoolPools | undefined)?.pools ?? [])
          .filter(pool => pool.provider !== props.provider)
        // The primary key is the pool's first entry; a provider with no extra
        // key needs no pool at all.
        const kept = extraKeys.filter(key => key.ref !== keyRef)
        const nextPools = kept.length === 0
          ? others
          : [...others, {
            provider: props.provider,
            keys: [{ ref: keyRef }, ...kept.map(key => ({ ref: key.ref, enabled: true }))],
          }]
        const mutated = await api.settings.mutate({
          ns: KEY_POOL_NS,
          ops: [{ op: 'set', path: ['pools'], value: nextPools }],
          expectedRevision: poolNs.revision,
        })
        if (!mutated.result.ok) {
          return mutated.result.error.code === 'settings-conflict' ? t('conflict') : mutated.result.error.message
        }
      }
    }
    setKeyDraft('')
    setRefreshDraft('')
    setExtraKeys(current => current.map(key => ({ ...key, secret: '', configured: key.secret.trim().length > 0 || key.configured })))
    setRemovedExtraRefs([])
    return undefined
  }

  const apply = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const failure = await applyOnce()
      if (failure !== undefined) {
        setFailure(failure)
        return
      }
      props.onClose(true)
    } catch (error) {
      // A transport failure (disconnect, a request the host refuses) rejects
      // rather than answering; without this the card would stay busy forever
      // with no error shown.
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  if (node === undefined) {
    // A directory entry addressing a position its schema cannot resolve is a
    // host-side inconsistency; showing it beats a blank card.
    return <p className={styles['error']}>{`${props.provider}: unresolvable settings path`}</p>
  }

  const keyLocked = keyState?.writable === false

  /**
   * The catalog beneath the user layer: what the composition entry pinned, or
   * else the schema default that `resolve` would supply. The effective value
   * cannot answer this — it still carries the stored override until the unset
   * is applied, so reading it would echo that override straight back the
   * moment reset drops it, leaving the rows unchanged until a reload.
   */
  const inheritedModels = (): unknown => {
    const pinned = schema.getPath(namespace.base, [...settingsPath, 'models'])
    return pinned ?? schema.nodeAtPath(root, [...settingsPath, 'models'])?.meta.default
  }

  /**
   * The curated fields of one known adapter family. The family arrives
   * narrowed so the per-family branches below are total: an unknown namespace
   * renders the hint instead and never reaches this body.
   */
  const curatedFields = (family: 'deepseek' | 'pi-ai'): ReactNode => {
    // What a hand-declared route names for itself and nothing else can supply.
    // A whole-section `llm-deepseek` profile is a composition fact with no
    // per-route identity for its schema to carry, hence the family test.
    const ownsIdentity = family === 'pi-ai' && props.declared === true
    const customModels = schema.getPath(draft, ['models'])
    const modelsOverridden = schema.hasPath(draft, ['models'])
    const models = modelDrafts(modelsOverridden ? customModels : inheritedModels())
    const defaultContextWindow = schema.getPath(fallback, ['defaultContextWindow'])
    const defaultMaxTokens = schema.getPath(fallback, ['maxTokens'])
    const keyPlaceholder = keyLocked
      ? t('keyEnvLocked')
      : keyState?.configured === true && props.credentialRequired !== true
        ? t('keyStored')
        : family === 'pi-ai' ? t('keyPlaceholderNative') : t('keyPlaceholder')
    /** What both family editors take: the rows, whose layer owns them, and the two writes. */
    const catalogProps = {
      models,
      overridden: modelsOverridden,
      t,
      disabled,
      onChange: (next: Record<string, unknown>[]) => {
        setDraft(current => schema.setPath(current, ['models'], next))
      },
      onReset: () => { setDraft(current => schema.deletePath(current, ['models'])) },
    }
    return (
      <>
        {bearer
          ? (
            <>
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
                  onClick={async () => {
                    setBusy(true)
                    try {
                      const imported = await refreshImportedFirebaseCredentials(
                        bearerCredentialsFromCookieJson(cookieDraft),
                      )
                      setKeyDraft(imported.accessToken)
                      if (imported.refreshToken !== undefined) {
                        setRefreshDraft(imported.refreshToken)
                        setRefreshEnabled(true)
                        setManualCredentialsOpen(true)
                      }
                      setCookieDraft('')
                      setCookieFailure(undefined)
                    } catch (error) {
                      setCookieFailure(messageOf(error))
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  {t('cookieImportAction')}
                </button>
                {cookieFailure === undefined
                  ? <p className={styles['advancedHint']}>{t('cookieImportHint')}</p>
                  : <p className={styles['error']}>{cookieFailure}</p>}
              </div>
              <button
                type="button"
                className={styles['linkButton']}
                aria-expanded={manualCredentialsOpen}
                disabled={disabled}
                onClick={() => { setManualCredentialsOpen(open => !open) }}
              >
                {t('manualCredentials')}
              </button>
              {manualCredentialsOpen
                ? (
                  <div className={styles['manualCredentials']}>
                    <p className={styles['advancedHint']}>{t('manualCredentialsHint')}</p>
                    <div className={styles['field']}>
                      <span className={styles['fieldLabel']}>{t('bearerInput')}</span>
                      <input
                        className={styles['input']}
                        type="password"
                        autoComplete="off"
                        value={keyDraft}
                        placeholder={keyPlaceholder}
                        aria-label={t('bearerInput')}
                        aria-invalid={shownKeyFailure !== undefined}
                        disabled={disabled || keyLocked}
                        onChange={(event) => { setKeyDraft(event.target.value) }}
                      />
                      {shownKeyFailure === undefined ? null : <p className={styles['error']}>{t(shownKeyFailure)}</p>}
                    </div>
                    <label className={styles['checkboxField']}>
                      <input
                        className={styles['checkbox']}
                        type="checkbox"
                        checked={autoRefresh}
                        disabled={disabled}
                        onChange={(event) => { setRefreshEnabled(event.target.checked) }}
                      />
                      <span>{t('autoRefresh')}</span>
                    </label>
                    {autoRefresh
                      ? (
                        <>
                          <div className={styles['field']}>
                            <span className={styles['fieldLabel']}>{t('refreshEndpoint')}</span>
                            <input
                              className={styles['input']}
                              type="url"
                              value={refreshEndpointValue ?? ''}
                              placeholder={t('refreshEndpointPlaceholder')}
                              aria-label={t('refreshEndpoint')}
                              disabled={disabled}
                              onChange={(event) => { setNestedField(['auth', 'refresh', 'endpoint'], event.target.value) }}
                            />
                            {refreshEndpointMissing ? <p className={styles['error']}>{t('refreshEndpointRequired')}</p> : null}
                          </div>
                          <div className={styles['field']}>
                            <span className={styles['fieldLabel']}>{t('refreshInput')}</span>
                            <input
                              className={styles['input']}
                              type="password"
                              autoComplete="off"
                              value={refreshDraft}
                              placeholder={refreshState?.configured === true ? t('keyStored') : t('refreshPlaceholder')}
                              aria-label={t('refreshInput')}
                              disabled={disabled || refreshState?.writable === false}
                              onChange={(event) => { setRefreshDraft(event.target.value) }}
                            />
                            {refreshFailure === undefined
                              ? refreshCredentialMissing ? <p className={styles['error']}>{t('refreshRequired')}</p> : null
                              : <p className={styles['error']}>{t(refreshFailure)}</p>}
                          </div>
                          <div className={styles['field']}>
                            <span className={styles['fieldLabel']}>{t('refreshApiKey')}</span>
                            <input
                              className={styles['input']}
                              type="text"
                              value={refreshApiKeyValue ?? ''}
                              aria-label={t('refreshApiKey')}
                              disabled={disabled}
                              onChange={(event) => { setNestedField(['auth', 'refresh', 'apiKey'], event.target.value) }}
                            />
                            {refreshApiKeyMissing ? <p className={styles['error']}>{t('refreshApiKeyRequired')}</p> : null}
                          </div>
                        </>
                      )
                      : null}
                  </div>
                )
                : null}
            </>
          )
          : (
            <div className={styles['field']}>
              <span className={styles['fieldLabel']}>{t('keyInput')}</span>
              <input
                className={styles['input']}
                type="password"
                autoComplete="off"
                value={keyDraft}
                placeholder={keyPlaceholder}
                aria-label={t('keyInput')}
                aria-invalid={shownKeyFailure !== undefined}
                required={props.credentialRequired === true}
                autoFocus={props.autoFocusCredential === true}
                disabled={disabled || keyLocked}
                onChange={(event) => { setKeyDraft(event.target.value) }}
              />
              {shownKeyFailure === undefined ? null : <p className={styles['error']}>{t(shownKeyFailure)}</p>}
            </div>
          )}
        {bearer || keyPoolView === undefined || props.credentialOnly === true ? null : (
          <>
            {extraKeys.map((key, index) => (
              <div className={styles['field']} key={key.id}>
                <span className={styles['fieldLabel']}>{`${t('keyInput')} ${index + 2}`}</span>
                <div className={styles['keyRow']}>
                  <input
                    className={styles['input']}
                    type="password"
                    autoComplete="off"
                    value={key.secret}
                    placeholder={key.configured ? t('keyStored') : t('keyPlaceholder')}
                    aria-label={`${t('keyInput')} ${index + 2}`}
                    disabled={disabled || keyLocked}
                    onChange={(event) => {
                      const value = event.target.value
                      setExtraKeys(current => current.map(candidate => candidate.id === key.id ? { ...candidate, secret: value } : candidate))
                    }}
                  />
                  <button
                    type="button"
                    className={styles['iconButton']}
                    aria-label={`${t('removeKey')} ${index + 2}`}
                    title={t('removeKey')}
                    disabled={disabled}
                    onClick={() => {
                      setRemovedExtraRefs(current => [...current, key.ref])
                      setExtraKeys(current => current.filter(candidate => candidate.id !== key.id))
                    }}
                  >
                    <IconTrashOutline16 size={14} />
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              className={styles['linkButton']}
              disabled={disabled || keyLocked || !keyPoolView.writable}
              onClick={() => {
                setExtraKeys((current) => {
                  // The next free numbered reference after the primary one,
                  // so removals cannot make a later add collide with a row
                  // that is still on the card.
                  const used = new Set(current.map(candidate => candidate.ref))
                  let index = current.length + 2
                  while (used.has(`${keyRef}_${index}`)) index += 1
                  const ref = `${keyRef}_${index}`
                  return [...current, { id: ref, ref, secret: '', configured: false }]
                })
              }}
            >
              <IconPlusOutline16 size={14} />
              {t('addKey')}
            </button>
          </>
        )}
        {props.credentialOnly === true ? null : <details className={styles['customized']}>
          <summary className={styles['customizedSummary']}>{t('customized')}</summary>
          <div className={styles['customizedBody']}>
            {/* The name and the protocol are the create card's two remaining
                profile fields; a route the adapter ships defaults both from
                its catalog entry and neither belongs on its card. */}
            {ownsIdentity
              ? (
                <div className={styles['field']}>
                  <span className={styles['fieldLabel']}>{t('customDisplayName')}</span>
                  <input
                    className={styles['input']}
                    type="text"
                    value={stringAt(draft, 'displayName') ?? ''}
                    // What this route is called the moment the field is
                    // cleared, which is the layer beneath the one this field
                    // edits: a `cordis.yml` may pin a name for a route the
                    // catalog does not ship, and only when nothing does is
                    // the answer the route id. Reading the effective value
                    // instead would echo the stored override back as the
                    // thing clearing restores.
                    placeholder={stringAt(schema.getPath(namespace.base, settingsPath), 'displayName')
                      ?? props.provider}
                    aria-label={t('customDisplayName')}
                    disabled={disabled}
                    onChange={(event) => { setField('displayName', event.target.value) }}
                  />
                </div>
              )
              : null}
            {bearer
              ? (
                <>
                  <div className={styles['field']}>
                    <span className={styles['fieldLabel']}>{t('chatEndpoint')}</span>
                    <input
                      className={styles['input']}
                      type="url"
                      value={stringAt(draft, 'chatURL') ?? stringAt(draft, 'baseURL') ?? ''}
                      placeholder={stringAt(fallback, 'chatURL') ?? stringAt(fallback, 'baseURL') ?? t('chatEndpointPlaceholder')}
                      aria-label={t('chatEndpoint')}
                      disabled={disabled}
                      onChange={(event) => {
                        setField('chatURL', event.target.value)
                        setDraft(current => schema.deletePath(current, ['baseURL']))
                      }}
                    />
                  </div>
                  <div className={styles['field']}>
                    <span className={styles['fieldLabel']}>{t('modelsEndpoint')}</span>
                    <input
                      className={styles['input']}
                      type="url"
                      value={stringAt(draft, 'modelsURL') ?? ''}
                      placeholder={stringAt(fallback, 'modelsURL') ?? t('modelsEndpointPlaceholder')}
                      aria-label={t('modelsEndpoint')}
                      disabled={disabled}
                      onChange={(event) => { setField('modelsURL', event.target.value) }}
                    />
                    <p className={styles['advancedHint']}>{t('modelsEndpointHint')}</p>
                  </div>
                </>
              )
              : (
                <div className={styles['field']}>
                  <span className={styles['fieldLabel']}>{t('baseUrl')}</span>
                  <input
                    className={styles['input']}
                    type="text"
                    value={stringAt(draft, 'baseURL') ?? ''}
                    placeholder={family === 'deepseek'
                      ? DEEPSEEK_PUBLIC_BASE_URL
                      : stringAt(fallback, 'baseURL') ?? t('baseUrlDefault')}
                    aria-label={t('baseUrl')}
                    disabled={disabled}
                    onChange={(event) => {
                      setField('baseURL', event.target.value === '' ? undefined : event.target.value)
                    }}
                  />
                </div>
              )}
            {/* The protocol sits beside the endpoint it describes, as it does
                on the create card. */}
            {ownsIdentity
              ? (
                <div className={styles['field']}>
                  <span className={styles['fieldLabel']}>{t('customApi')}</span>
                  <select
                    className={`${styles['input']} ${styles['selectInput']}`}
                    value={probeApi ?? ''}
                    aria-label={t('customApi')}
                    disabled={disabled}
                    onChange={(event) => { setField('api', event.target.value) }}
                  >
                    {/* A profile naming no protocol — hand-written into
                        settings.yaml with no model to need one — selects
                        nothing rather than reading as if it had picked the
                        first choice. The option is named because a screen
                        reader announces it either way, and an empty one is
                        announced as a choice with no identity. */}
                    {probeApi === undefined ? <option value="">{t('customApiUnset')}</option> : null}
                    {protocols.map(choice => <option key={choice} value={choice}>{choice}</option>)}
                  </select>
                </div>
              )
              : null}
            {/* Both families edit the same rows through the same contract; only
                the extras differ — DeepSeek's inherited capacities, pi-ai's
                endpoint interrogation. */}
            {family === 'deepseek'
              ? (
                <DeepSeekModelsEditor
                  {...catalogProps}
                  defaultContextWindow={typeof defaultContextWindow === 'number'
                    ? defaultContextWindow
                    : undefined}
                  defaultMaxTokens={typeof defaultMaxTokens === 'number' ? defaultMaxTokens : undefined}
                />
              )
              : <ModelListEditor {...catalogProps} probe={probe} probeBlocked={keyFailure} api={api} />}
          </div>
        </details>}
      </>
    )
  }

  return (
    <div className={props.credentialOnly === true ? styles['addBlock'] : styles['editor']}>
      {props.hideTitle === true
        ? null
        : (
          <div className={styles['editorHeader']}>
            <span className={styles['editorTitle']}>{props.displayName}</span>
            {props.provider !== props.displayName
              ? <span className={styles['editorRoute']}>{props.provider}</span>
              : null}
          </div>
        )}
      {layout === 'unknown'
        ? <p className={styles['advancedHint']}>{`${t('advancedHint')} (${namespace.ns})`}</p>
        : curatedFields(layout)}
      {failure !== undefined ? <p className={styles['error']}>{failure}</p> : null}
      {props.credentialOnly === true || modelFailure === undefined
        ? null
        : (
          <p className={styles['advancedHint']}>
            {`${t('model')} ${String(modelFailure.index + 1)}: ${t(modelFailure.key)}`}
          </p>
        )}
      <EditorFooter
        t={t}
        busy={busy}
        submitDisabled={disabled || layout === 'unknown'
          || (props.credentialOnly !== true && modelFailure !== undefined)
          || shownKeyFailure !== undefined
          || refreshFailure !== undefined
          || refreshEndpointMissing
          || refreshApiKeyMissing
          || refreshCredentialMissing
          || (props.credentialRequired === true && keyValue.length === 0)}
        submitLabel={props.submitLabel ?? 'apply'}
        submitBusyLabel={props.submitBusyLabel ?? 'applying'}
        {...props.cancelLabel === undefined ? {} : { cancelLabel: props.cancelLabel }}
        onCancel={() => { props.onClose(false) }}
        onSubmit={() => { void apply() }}
      />
    </div>
  )
}

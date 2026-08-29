/**
 * Provider-row add-on for the fork key pool.
 *
 * The current upstream Models page owns provider editing. This small card is
 * only the extra-key seam: it never copies or replaces the upstream editor,
 * and it stores secret values through the existing credentials Remote.
 */

import { useEffect, useState } from 'react'
import type { ClientRemote, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'

type SettingsApi = Pick<ClientRemote['settings'], 'describe' | 'mutate'>
type CredentialsApi = Pick<ClientRemote['credentials'], 'describe' | 'set' | 'unset'>

export interface KeyPoolProviderCardInjected {
  api: { settings: SettingsApi; credentials: CredentialsApi }
}

export type KeyPoolProviderCardProps =
  PropsRuntime<'settings.models.provider-card'> & InjectFace<KeyPoolProviderCardInjected>

interface PoolKeyDraft {
  ref: string
  secret: string
  configured: boolean
  primary?: boolean
}

interface PoolValue {
  pools?: Array<{ provider: string; keys: Array<{ ref: string; enabled?: boolean }> }>
}

function deriveKeyRef(provider: string): string {
  return `${provider.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}_API_KEY`
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Render and persist additional API keys for one LLM provider route. */
export function KeyPoolProviderCard(props: KeyPoolProviderCardProps) {
  const { api } = props
  const provider = props.provider.provider
  const primaryRef = deriveKeyRef(provider)
  const [keys, setKeys] = useState<PoolKeyDraft[]>([])
  const [revision, setRevision] = useState<number | undefined>(undefined)
  const [writable, setWritable] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)

  const load = async (): Promise<void> => {
    setFailure(undefined)
    try {
      const response = await api.settings.describe()
      if (!response.ok) throw new Error(response.error.message)
      const namespace = response.value.namespaces.find(item => item.ns === 'key-pool')
      if (namespace === undefined) {
        setKeys([{ ref: primaryRef, secret: '', configured: props.keyConfigured, primary: true }])
        setLoaded(true)
        return
      }
      const value = (namespace.value ?? {}) as PoolValue
      const configured = value.pools?.find(item => item.provider === provider)?.keys ?? []
      const refs = configured.length === 0 ? [primaryRef] : configured.map(item => item.ref)
      const badges = await api.credentials.describe(refs)
      if (!badges.ok) throw new Error(badges.error.message)
      setKeys(refs.map((ref, index) => ({
        ref,
        secret: '',
        configured: badges.value[ref]?.configured ?? (index === 0 && props.keyConfigured),
        primary: index === 0 && ref === primaryRef,
      })))
      setRevision(namespace.revision)
      setWritable(response.value.writable)
      setLoaded(true)
      setDirty(false)
    } catch (error) {
      setFailure(messageOf(error))
    }
  }

  useEffect(() => {
    void load()
    return () => undefined
  }, [provider, primaryRef, props.keyConfigured])

  const addKey = (): void => {
    setKeys(current => {
      let index = current.length + 1
      const used = new Set(current.map(key => key.ref))
      let ref = `${primaryRef}_${index}`
      while (used.has(ref)) ref = `${primaryRef}_${++index}`
      return [...current, { ref, secret: '', configured: false }]
    })
    setDirty(true)
  }

  const removeKey = (ref: string): void => {
    if (ref === primaryRef) return
    setKeys(current => current.filter(key => key.ref !== ref))
    setDirty(true)
  }

  const save = async (): Promise<void> => {
    if (!loaded || !writable || busy) return
    setBusy(true)
    setFailure(undefined)
    try {
      for (const key of keys) {
        const value = key.secret.trim()
        if (value.length === 0) continue
        const stored = await api.credentials.set(key.ref, value)
        if (!stored.ok) throw new Error(stored.error.message)
      }
      const latest = await api.settings.describe()
      if (!latest.ok) throw new Error(latest.error.message)
      const namespace = latest.value.namespaces.find(item => item.ns === 'key-pool')
      if (namespace === undefined) throw new Error('The key-pool plugin is not available in this profile')
      const oldValue = (namespace.value ?? {}) as PoolValue
      const others = (oldValue.pools ?? []).filter(item => item.provider !== provider)
      const active = keys.length > 1 || keys.some(key => key.ref !== primaryRef)
      const nextPools = active
        ? [...others, { provider, keys: keys.map(key => ({ ref: key.ref, enabled: true })) }]
        : others
      const ops: SettingsPathOpView[] = [{ op: 'set', path: ['pools'], value: nextPools }]
      const updated = await api.settings.mutate('key-pool', ops, namespace.revision)
      if (!updated.ok) throw new Error(updated.error.message)
      const removed = new Set(
        (oldValue.pools?.find(item => item.provider === provider)?.keys ?? [])
          .map(key => key.ref)
          .filter(ref => !keys.some(key => key.ref === ref) && ref !== primaryRef),
      )
      for (const ref of removed) {
        const unset = await api.credentials.unset(ref)
        if (!unset.ok) throw new Error(unset.error.message)
      }
      setKeys(current => current.map(key => ({ ...key, secret: '', configured: key.configured || key.secret.trim().length > 0 })))
      setRevision(updated.value.revision)
      setDirty(false)
    } catch (error) {
      setFailure(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <details style={{ margin: '0.5rem 0' }}>
      <summary style={{ cursor: 'pointer' }}>
        API key pool{keys.length > 1 ? ` (${keys.length})` : ''}
      </summary>
      <div style={{ display: 'grid', gap: '0.5rem', padding: '0.5rem 0' }}>
        <p style={{ margin: 0, opacity: 0.75 }}>
          Keep multiple keys for this provider and rotate automatically after limits or failures.
        </p>
        {keys.map((key, index) => (
          <div key={key.ref} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="password"
              autoComplete="off"
              value={key.secret}
              placeholder={key.configured ? `Key ${index + 1} configured` : `API key ${index + 1}`}
              aria-label={`API key ${index + 1}`}
              disabled={busy || !writable}
              onChange={event => {
                const secret = event.target.value
                setKeys(current => current.map(item => item.ref === key.ref ? { ...item, secret } : item))
                setDirty(true)
              }}
              style={{ flex: 1 }}
            />
            {!key.primary && (
              <button type="button" disabled={busy || !writable} onClick={() => removeKey(key.ref)}>
                Remove
              </button>
            )}
          </div>
        ))}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" disabled={busy || !writable} onClick={addKey}>Add key</button>
          <button type="button" disabled={busy || !writable || !dirty} onClick={() => { void save() }}>Save keys</button>
          <button type="button" disabled={busy} onClick={() => { void load() }}>Refresh</button>
        </div>
        {revision === undefined && loaded ? <p style={{ margin: 0, opacity: 0.75 }}>The pool is not configured yet; saving a second key enables it.</p> : null}
        {failure === undefined ? null : <p role="alert" style={{ margin: 0 }}>{failure}</p>}
      </div>
    </details>
  )
}

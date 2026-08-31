// @vitest-environment jsdom
/** The controller: what it asks the Host, and what it keeps when the panel closes. */

import { describe, expect, it, vi } from 'vitest'
import {
  KeyCheckController,
  STORAGE_KEY,
  type KeyCheckFace,
  type KeyCheckState,
  type KeyCheckStorage,
} from '../src/client/key-check-controller.ts'

/** A key that is easy to assert survived a round trip verbatim. */
const KEY_A = 'nvapi-aaaaaaaaaaaaaaaaaaaaaaaa'
const KEY_B = 'nvapi-bbbbbbbbbbbbbbbbbbbbbbbb'

/** An in-memory stand-in for `localStorage`. */
function storage(): KeyCheckStorage & { document: Map<string, string> } {
  const document = new Map<string, string>()
  return {
    document,
    getItem: key => document.get(key) ?? null,
    setItem: (key, value) => { document.set(key, value) },
    removeItem: key => { document.delete(key) },
  }
}

/** One Host answer, keyed by endpoint. */
function rpc(answers: {
  providers?: ReadonlyArray<{ provider: string; displayName: string }>
  outcomes?: ReadonlyArray<{ id: string; valid: boolean; status?: number; error?: string }>
}) {
  const calls: Array<{ channel: string; endpoint: string; payload: unknown }> = []
  let failure: unknown
  let transport: unknown
  return {
    calls,
    /** Make every later call answer a failure, as a broken host does. */
    failWith(message: string): void {
      failure = { ok: false, error: { code: 'internal', message, details: {} } }
    },
    /** Make every later call reject, as an unreachable host does. */
    throwWith(message: string): void {
      transport = new Error(message)
    },
    handle: {
      call: vi.fn(async (channel: string, endpoint: string, payload: unknown) => {
        calls.push({ channel, endpoint, payload })
        if (transport !== undefined) throw transport
        if (failure !== undefined) return failure
        if (endpoint === 'llmKeyCheck.providers') return { ok: true, value: { providers: answers.providers ?? [] } }
        return { ok: true, value: { outcomes: answers.outcomes ?? [] } }
      }),
    },
  }
}

/** Build a controller over a Host answer and a storage, opened and ready. */
async function open(
  host: ReturnType<typeof rpc>,
  store: KeyCheckStorage,
): Promise<{ controller: KeyCheckController; face: KeyCheckFace }> {
  const controller = new KeyCheckController(host.handle as never, store)
  const face = controller.inject()
  face.toggle()
  await Promise.resolve()
  await Promise.resolve()
  return { controller, face }
}

/**
 * Read the controller's current snapshot.
 *
 * The panel reads this through the `useKeyCheck` hook the framework binds from
 * the face's `hooks` compartment; outside a component the store is read
 * directly off the same compartment.
 */
function state(face: KeyCheckFace): KeyCheckState {
  return face.hooks.keyCheck.getSnapshot()
}

describe('KeyCheckController', () => {
  it('asks the host for the directory when the panel opens, and not before', async () => {
    const host = rpc({ providers: [{ provider: 'nvidia', displayName: 'NVIDIA' }] })
    const controller = new KeyCheckController(host.handle as never, storage())
    expect(host.calls).toHaveLength(0)
    controller.inject().toggle()
    await Promise.resolve()
    await Promise.resolve()
    expect(host.calls.map(call => call.endpoint)).toEqual(['llmKeyCheck.providers'])
    // An address the browser is not allowed to learn never crosses the wire.
    expect(JSON.stringify(host.calls)).not.toContain('https://')
  })

  it('holds the directory once it answers', async () => {
    const host = rpc({ providers: [{ provider: 'nvidia', displayName: 'NVIDIA' }] })
    const { face } = await open(host, storage())
    expect(state(face).providers).toEqual([{ provider: 'nvidia', displayName: 'NVIDIA' }])
    expect(state(face).ready).toBe(true)
  })

  it('says why the directory is empty when the host answers a failure', async () => {
    const host = rpc({})
    host.failWith('no directory')
    const { face } = await open(host, storage())
    expect(state(face).providers).toEqual([])
    // An answered failure is still an answer: the panel stops waiting and
    // reports the reason instead of sitting on "pending" forever.
    expect(state(face).ready).toBe(true)
    expect(state(face).error).toBe('no directory')
  })

  it('leaves the panel usable when the host cannot be reached at all', async () => {
    const host = rpc({ providers: [{ provider: 'nvidia', displayName: 'NVIDIA' }] })
    host.throwWith('offline')
    const { face } = await open(host, storage())
    expect(state(face).providers).toEqual([])
    expect(state(face).ready).toBe(true)
  })

  it('probes only the pasted keys whose provider the directory knows', async () => {
    const host = rpc({
      providers: [{ provider: 'nvidia', displayName: 'NVIDIA' }],
      outcomes: [{ id: 'row-0', valid: true, status: 404 }],
    })
    const { face } = await open(host, storage())
    face.setInput(`nvidia\t${KEY_A}\nnot-a-provider\t${KEY_B}`)
    face.run()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    const check = host.calls.find(call => call.endpoint === 'llmKeyCheck.check')
    expect(check).toBeDefined()
    expect(check?.payload).toEqual({ keys: [{ id: 'row-0', provider: 'nvidia', apiKey: KEY_A }] })
  })

  it('shows one verdict per row after a run', async () => {
    const host = rpc({
      providers: [{ provider: 'nvidia', displayName: 'NVIDIA' }],
      outcomes: [{ id: 'row-0', valid: true, status: 404 }, { id: 'row-1', valid: false, status: 403, error: 'rejected' }],
    })
    const { face } = await open(host, storage())
    face.setInput(`nvidia\t${KEY_A}\nnvidia\t${KEY_B}`)
    face.run()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    const entries = state(face).entries
    expect(entries.map(entry => entry.valid)).toEqual([true, false])
    expect(entries[1]?.error).toBe('rejected')
    expect(state(face).checkedAt).toBeTypeOf('number')
  })

  it('says nothing was available rather than reporting a provider rejection', async () => {
    const host = rpc({ providers: [{ provider: 'nvidia', displayName: 'NVIDIA' }] })
    const { face } = await open(host, storage())
    face.setInput(`not-a-provider\t${KEY_A}`)
    face.run()
    await Promise.resolve()
    expect(state(face).error).toBe('none of these providers are available here')
    expect(host.calls.some(call => call.endpoint === 'llmKeyCheck.check')).toBe(false)
  })

  it('surfaces a host failure as the run error', async () => {
    const host = rpc({ providers: [{ provider: 'nvidia', displayName: 'NVIDIA' }] })
    const { face } = await open(host, storage())
    face.setInput(`nvidia\t${KEY_A}`)
    host.failWith('host down')
    face.run()
    await Promise.resolve()
    await Promise.resolve()
    expect(state(face).error).toBe('host down')
  })

  it('keeps the pasted keys in the cache, as plain text', async () => {
    const host = rpc({ providers: [{ provider: 'nvidia', displayName: 'NVIDIA' }] })
    const store = storage()
    const { face } = await open(host, store)
    face.setInput(`nvidia\t${KEY_A}`)
    const raw = store.document.get(STORAGE_KEY)
    expect(raw).toBeTypeOf('string')
    // The cache exists so the keys are still there when the panel reopens;
    // redacting it would defeat the only reason to write it.
    expect(raw).toContain(KEY_A)
  })

  it('restores the paste buffer and the last verdicts on a fresh mount', async () => {
    const host = rpc({
      providers: [{ provider: 'nvidia', displayName: 'NVIDIA' }],
      outcomes: [{ id: 'row-0', valid: true, status: 404 }, { id: 'row-1', valid: false, status: 403 }],
    })
    const store = storage()
    const first = await open(host, store)
    first.face.setInput(`nvidia\t${KEY_A}\nnvidia\t${KEY_B}`)
    first.face.run()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    const second = new KeyCheckController(host.handle as never, store)
    const restored = state(second.inject())
    expect(restored.input).toBe(`nvidia\t${KEY_A}\nnvidia\t${KEY_B}`)
    expect(restored.entries.map(entry => [entry.apiKey, entry.valid])).toEqual([[KEY_A, true], [KEY_B, false]])
  })

  it('drops the cache, the buffer, and the verdicts on clear', async () => {
    const host = rpc({ providers: [{ provider: 'nvidia', displayName: 'NVIDIA' }] })
    const store = storage()
    const { face } = await open(host, store)
    face.setInput(`nvidia\t${KEY_A}`)
    expect(store.document.has(STORAGE_KEY)).toBe(true)
    face.clear()
    expect(store.document.has(STORAGE_KEY)).toBe(false)
    expect(state(face).input).toBe('')
    expect(state(face).entries).toEqual([])
    expect(state(face).checkedAt).toBeNull()
  })

  it('hides the lists on hide, leaving the cache behind', async () => {
    const host = rpc({ providers: [{ provider: 'nvidia', displayName: 'NVIDIA' }] })
    const store = storage()
    const { face } = await open(host, store)
    face.setInput(`nvidia\t${KEY_A}`)
    expect(state(face).open).toBe(true)
    face.hide()
    expect(state(face).open).toBe(false)
    expect(store.document.get(STORAGE_KEY)).toContain(KEY_A)
  })

  it('survives a storage that refuses to write', async () => {
    const host = rpc({ providers: [{ provider: 'nvidia', displayName: 'NVIDIA' }] })
    const hostile: KeyCheckStorage = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
      removeItem: () => { throw new Error('blocked') },
    }
    const { face } = await open(host, hostile)
    face.setInput(`nvidia\t${KEY_A}`)
    expect(state(face).input).toBe(`nvidia\t${KEY_A}`)
    expect(() => face.clear()).not.toThrow()
  })

  it('ignores a cache it cannot read', async () => {
    const host = rpc({ providers: [{ provider: 'nvidia', displayName: 'NVIDIA' }] })
    const store = storage()
    store.document.set(STORAGE_KEY, '{ not json')
    const { face } = await open(host, store)
    expect(state(face).input).toBe('')
  })

  it('discards a cache written by a different version', async () => {
    const host = rpc({ providers: [{ provider: 'nvidia', displayName: 'NVIDIA' }] })
    const store = storage()
    store.document.set(STORAGE_KEY, JSON.stringify({ version: 999, input: `nvidia\t${KEY_A}`, results: [] }))
    const { face } = await open(host, store)
    expect(state(face).input).toBe('')
  })
})

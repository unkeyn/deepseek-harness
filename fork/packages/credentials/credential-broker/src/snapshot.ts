import type {
  CredentialBrokerSnapshot,
  CredentialBrokerSnapshotEntry,
  CredentialBrokerSnapshotEvent,
  CredentialBrokerSnapshotListener,
  CredentialBrokerSnapshotSubscription,
  CredentialId,
} from './types.ts'

/**
 * Broker-owned transport-neutral metadata stream. It accepts only strictly newer
 * generations and disposes listeners and pending iterators together.
 */
export class CredentialBrokerSnapshotStream {
  private readonly listeners = new Set<CredentialBrokerSnapshotListener>()
  private readonly queues = new Set<Queue>()
  private current: CredentialBrokerSnapshot
  private closed = false

  constructor(snapshot: CredentialBrokerSnapshot = { generation: 0, entries: [] }) {
    validateGeneration(snapshot.generation)
    this.current = detachSnapshot(snapshot)
  }

  /** Seed the source before subscriptions exist; only the empty initial stream may be seeded.
   * @param snapshot initial detached metadata.
   */
  initialize(snapshot: CredentialBrokerSnapshot): void {
    if (this.current.generation !== 0 || this.current.entries.length !== 0) throw new Error('broker snapshot stream is already initialized')
    validateGeneration(snapshot.generation)
    this.current = detachSnapshot(snapshot)
  }

  /** Return a detached redacted snapshot.
   * @returns current metadata.
   */
  getSnapshot(): CredentialBrokerSnapshot {
    return detachSnapshot(this.current)
  }

  /** Subscribe until the returned handle is disposed or this stream is disposed.
   * @param listener receives detached events.
   * @returns a disposable subscription.
   */
  subscribe(listener: CredentialBrokerSnapshotListener): CredentialBrokerSnapshotSubscription {
    if (this.closed) return { dispose() {} }
    this.listeners.add(listener)
    let active = true
    return { dispose: () => { if (active) { active = false; this.listeners.delete(listener) } } }
  }

  /** Apply and publish an event; stale or duplicate generations are ignored.
   * @param event newer metadata event.
   * @returns whether the event advanced the stream.
   */
  publish(event: CredentialBrokerSnapshotEvent): boolean {
    if (this.closed) return false
    validateGeneration(event.generation)
    if (event.generation <= this.current.generation) return false
    const next = applyEvent(this.current, event)
    this.current = next
    const detached = detachEvent(event)
    for (const listener of [...this.listeners]) {
      try { listener(detached) } catch { /* one subscriber cannot break the broker stream */ }
    }
    for (const queue of [...this.queues]) queue.push(detached)
    return true
  }

  /** Create an async event stream whose disposal unregisters it from the broker.
   * @returns an async iterator and disposable subscription.
   */
  stream(): AsyncIterableIterator<CredentialBrokerSnapshotEvent> & CredentialBrokerSnapshotSubscription {
    const queue = new Queue()
    if (this.closed) {
      queue.close()
      return {
        next: () => queue.next(),
        return: async () => ({ done: true, value: undefined }),
        [Symbol.asyncIterator]() { return this },
        dispose: () => {},
      }
    }
    this.queues.add(queue)
    const dispose = () => { this.queues.delete(queue); queue.close() }
    return {
      next: () => queue.next(),
      return: async () => { dispose(); return { done: true, value: undefined } },
      [Symbol.asyncIterator]() { return this },
      dispose,
    }
  }

  /** Close all subscriptions and pending async consumers. */
  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.listeners.clear()
    for (const queue of this.queues) queue.close()
    this.queues.clear()
  }
}

class Queue {
  private readonly values: CredentialBrokerSnapshotEvent[] = []
  private readonly pending: ((result: IteratorResult<CredentialBrokerSnapshotEvent>) => void)[] = []
  private closed = false

  push(value: CredentialBrokerSnapshotEvent): void {
    if (this.closed) return
    const resolve = this.pending.shift()
    if (resolve !== undefined) resolve({ done: false, value })
    else this.values.push(value)
  }

  next(): Promise<IteratorResult<CredentialBrokerSnapshotEvent>> {
    const value = this.values.shift()
    if (value !== undefined) return Promise.resolve({ done: false, value })
    if (this.closed) return Promise.resolve({ done: true, value: undefined })
    return new Promise(resolve => this.pending.push(resolve))
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const resolve of this.pending.splice(0)) resolve({ done: true, value: undefined })
  }
}

function applyEvent(snapshot: CredentialBrokerSnapshot, event: CredentialBrokerSnapshotEvent): CredentialBrokerSnapshot {
  if (event.kind === 'snapshot') return { generation: event.generation, entries: event.entries.map(detachEntry) }
  const entries = new Map(snapshot.entries.map(entry => [entry.id, entry]))
  if (event.kind === 'entry') entries.set(event.entry.id, detachEntry(event.entry))
  else entries.delete(event.id)
  return { generation: event.generation, entries: [...entries.values()] }
}

function detachSnapshot(snapshot: CredentialBrokerSnapshot): CredentialBrokerSnapshot {
  return { generation: snapshot.generation, entries: snapshot.entries.map(detachEntry) }
}
function detachEntry(entry: CredentialBrokerSnapshotEntry): CredentialBrokerSnapshotEntry { return { ...entry } }
function detachEvent(event: CredentialBrokerSnapshotEvent): CredentialBrokerSnapshotEvent {
  return event.kind === 'snapshot' ? { ...event, entries: event.entries.map(detachEntry) }
    : event.kind === 'entry' ? { ...event, entry: detachEntry(event.entry) } : { ...event }
}
function validateGeneration(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError('broker snapshot generation must be a non-negative safe integer')
}

export type { CredentialId }

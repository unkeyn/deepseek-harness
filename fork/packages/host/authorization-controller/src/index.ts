/**
 * Current-host Remote bridge for the shared authorization service.
 *
 * The upstream authorization seam deliberately carries callbacks rather than
 * a transport. This small adapter turns those callbacks into a redacted,
 * pollable Remote conversation so the current Models page can restore OAuth
 * without reviving the fork's obsolete full settings replacement.
 */

import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import {
  AuthorizationDeclinedError,
  AuthorizationError,
} from '@deepseek-ai/dsh-authorization'
import type {
  AuthorizationNotice,
  AuthorizationPrompt,
} from '@deepseek-ai/dsh-authorization/types'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials/types'
import { Remote, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  AuthorizationAttemptView,
  AuthorizationCancelValue,
  AuthorizationFlowView,
  AuthorizationNoticeView,
  AuthorizationPromptView,
  AuthorizationStartValue,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Remote owner for the browser-facing authorization conversation. */
    authorizationController: AuthorizationController
  }
}

interface PendingPrompt {
  readonly resolve: (value: string) => void
  readonly reject: (error: unknown) => void
  readonly dispose: () => void
}

interface Attempt {
  readonly attemptId: string
  readonly key: string
  readonly label: string
  readonly method: string
  status: AuthorizationAttemptView['status']
  notice: AuthorizationNoticeView | undefined
  prompt: AuthorizationPromptView | undefined
  error: string | undefined
  revision: number
  readonly controller: AbortController
  pending: PendingPrompt | undefined
  finishedAt: number | undefined
}

const RETAIN_TERMINAL_MS = 5 * 60_000
const MAX_RETAINED_ATTEMPTS = 32

/** Remote methods backing `ctx.remote.authorization`. */
export class AuthorizationController extends TypertRemoteService {
  static inject = ['authorization']

  private readonly attempts = new Map<string, Attempt>()

  constructor(ctx: Context) {
    super(ctx, 'authorizationController', { namespace: 'authorization' })
  }

  /** List registered, secret-free authorization flows in registration order. */
  @Remote('list')
  list(): readonly AuthorizationFlowView[] {
    this.prune()
    return this.ctx.authorization.list().map(entry => ({
      key: String(entry.key),
      label: entry.label,
      methods: entry.methods.map(method => ({ id: method.id, label: method.label })),
      inFlight: entry.inFlight,
    }))
  }

  /** Start one flow and return immediately; notices and prompts are polled by the browser. */
  @Remote('start')
  start(key: string, method?: string): AuthorizationStartValue {
    this.prune()
    const entry = this.ctx.authorization.describe(key as CredentialKey)
    if (entry === undefined) throw failure('NO_FLOW', `no authorization flow is registered for "${key}"`)
    const selectedMethod = method?.trim() || entry.methods[0]?.id
    if (selectedMethod === undefined) throw failure('NO_METHOD', `authorization flow for "${key}" has no methods`)
    if (!entry.methods.some(candidate => candidate.id === selectedMethod)) {
      throw failure('UNKNOWN_METHOD', `authorization flow for "${key}" offers no method "${selectedMethod}"`)
    }
    if (entry.inFlight) throw failure('ALREADY_IN_FLIGHT', `an authorization attempt for "${key}" is already running`)

    const attempt: Attempt = {
      attemptId: randomUUID(),
      key,
      label: entry.label,
      method: selectedMethod,
      status: 'starting',
      notice: undefined,
      prompt: undefined,
      error: undefined,
      revision: 0,
      controller: new AbortController(),
      pending: undefined,
      finishedAt: undefined,
    }
    this.attempts.set(attempt.attemptId, attempt)
    void this.run(attempt)
    return { attemptId: attempt.attemptId }
  }

  /** Read the latest redacted state of one attempt. */
  @Remote('state')
  state(attemptId: string): AuthorizationAttemptView | null {
    this.prune()
    const attempt = this.attempts.get(attemptId)
    return attempt === undefined ? null : this.view(attempt)
  }

  /** Answer the currently visible prompt; the answer is held only until the flow consumes it. */
  @Remote('answer')
  answer(attemptId: string, value: string): void {
    const attempt = this.requireAttempt(attemptId)
    const pending = attempt.pending
    if (pending === undefined) throw failure('NO_PROMPT', 'this authorization attempt is not waiting for an answer')
    pending.resolve(value)
  }

  /** Cancel one browser-owned attempt without exposing the flow's controller. */
  @Remote('cancel')
  cancel(attemptId: string): AuthorizationCancelValue {
    const attempt = this.attempts.get(attemptId)
    if (attempt === undefined) return { cancelled: false }
    if (isTerminal(attempt.status)) return { cancelled: false }
    attempt.status = 'cancelled'
    attempt.revision += 1
    attempt.controller.abort()
    attempt.pending?.reject(new Error('authorization attempt cancelled'))
    this.ctx.authorization.cancel(attempt.key as CredentialKey)
    return { cancelled: true }
  }

  private async run(attempt: Attempt): Promise<void> {
    try {
      const outcome = await this.ctx.authorization.begin({
        key: attempt.key as CredentialKey,
        method: attempt.method,
        signal: attempt.controller.signal,
        interaction: {
          notify: notice => this.notify(attempt, notice),
          prompt: prompt => this.prompt(attempt, prompt),
        },
      })
      attempt.status = outcome.status
    } catch (error: unknown) {
      if (attempt.controller.signal.aborted || error instanceof AuthorizationDeclinedError) {
        attempt.status = 'cancelled'
      } else {
        attempt.status = 'failed'
        attempt.error = errorMessage(error)
      }
    } finally {
      attempt.pending?.reject(new Error('authorization attempt finished'))
      attempt.pending = undefined
      attempt.prompt = undefined
      attempt.finishedAt = Date.now()
      attempt.revision += 1
    }
  }

  private notify(attempt: Attempt, notice: AuthorizationNotice): void {
    attempt.notice = {
      message: notice.message,
      ...(notice.url === undefined ? {} : { url: notice.url }),
      ...(notice.code === undefined ? {} : { code: notice.code }),
    }
    attempt.prompt = undefined
    attempt.revision += 1
  }

  private prompt(attempt: Attempt, prompt: AuthorizationPrompt): Promise<string> {
    if (attempt.controller.signal.aborted) return Promise.reject(new Error('authorization attempt cancelled'))
    attempt.pending?.reject(new Error('authorization prompt replaced'))
    const view = toPromptView(prompt)
    attempt.prompt = view
    attempt.status = 'waiting'
    attempt.revision += 1
    return new Promise<string>((resolve, reject) => {
      const abort = (): void => {
        dispose()
        reject(new Error('authorization prompt withdrawn'))
      }
      const promptAbort = (): void => { abort() }
      const dispose = (): void => {
        attempt.pending = undefined
        prompt.signal?.removeEventListener('abort', promptAbort)
        attempt.controller.signal.removeEventListener('abort', abort)
      }
      attempt.pending = {
        resolve: value => { dispose(); attempt.prompt = undefined; attempt.revision += 1; resolve(value) },
        reject: error => { dispose(); attempt.prompt = undefined; attempt.revision += 1; reject(error) },
        dispose,
      }
      prompt.signal?.addEventListener('abort', promptAbort, { once: true })
      attempt.controller.signal.addEventListener('abort', abort, { once: true })
    })
  }

  private requireAttempt(attemptId: string): Attempt {
    const attempt = this.attempts.get(attemptId)
    if (attempt === undefined) throw failure('UNKNOWN_ATTEMPT', `authorization attempt "${attemptId}" does not exist`)
    return attempt
  }

  private view(attempt: Attempt): AuthorizationAttemptView {
    return {
      attemptId: attempt.attemptId,
      key: attempt.key,
      label: attempt.label,
      method: attempt.method,
      status: attempt.status,
      ...(attempt.notice === undefined ? {} : { notice: { ...attempt.notice } }),
      ...(attempt.prompt === undefined ? {} : { prompt: clonePrompt(attempt.prompt) }),
      ...(attempt.error === undefined ? {} : { error: attempt.error }),
      revision: attempt.revision,
    }
  }

  private prune(): void {
    const now = Date.now()
    for (const [id, attempt] of this.attempts) {
      if (attempt.finishedAt !== undefined && now - attempt.finishedAt > RETAIN_TERMINAL_MS) this.attempts.delete(id)
    }
    while (this.attempts.size > MAX_RETAINED_ATTEMPTS) {
      const first = this.attempts.keys().next().value as string | undefined
      if (first === undefined) break
      this.attempts.delete(first)
    }
  }
}

function toPromptView(prompt: AuthorizationPrompt): AuthorizationPromptView {
  if (prompt.kind === 'select') {
    return {
      kind: 'select',
      message: prompt.message,
      options: prompt.options.map(option => ({
        id: option.id,
        label: option.label,
        ...(option.description === undefined ? {} : { description: option.description }),
      })),
    }
  }
  return {
    kind: prompt.kind,
    message: prompt.message,
    ...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder }),
  }
}

function clonePrompt(prompt: AuthorizationPromptView): AuthorizationPromptView {
  return prompt.kind === 'select'
    ? { ...prompt, options: prompt.options.map(option => ({ ...option })) }
    : { ...prompt }
}

function isTerminal(status: AuthorizationAttemptView['status']): boolean {
  return status === 'authorized' || status === 'cancelled' || status === 'failed'
}

function failure(code: string, message: string): TypertRemoteFailure {
  return new TypertRemoteFailure({ code, message, details: {} })
}

function errorMessage(error: unknown): string {
  if (error instanceof AuthorizationError) return error.message
  return error instanceof Error ? error.message : String(error)
}

export default AuthorizationController

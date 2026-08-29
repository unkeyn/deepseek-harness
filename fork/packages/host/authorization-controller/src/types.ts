/** Wire-safe views used by the OAuth settings card. Secrets never appear here. */

export type AuthorizationAttemptStatus = 'starting' | 'waiting' | 'authorized' | 'cancelled' | 'failed'

export interface AuthorizationMethodView {
  readonly id: string
  readonly label: string
}

export interface AuthorizationFlowView {
  readonly key: string
  readonly label: string
  readonly methods: readonly AuthorizationMethodView[]
  readonly inFlight: boolean
}

export interface AuthorizationNoticeView {
  readonly message: string
  readonly url?: string
  readonly code?: string
}

export type AuthorizationPromptView = {
  readonly kind: 'text' | 'secret'
  readonly message: string
  readonly placeholder?: string
} | {
  readonly kind: 'select'
  readonly message: string
  readonly options: readonly {
    readonly id: string
    readonly label: string
    readonly description?: string
  }[]
}

export interface AuthorizationAttemptView {
  readonly attemptId: string
  readonly key: string
  readonly label: string
  readonly method: string
  readonly status: AuthorizationAttemptStatus
  readonly notice?: AuthorizationNoticeView
  readonly prompt?: AuthorizationPromptView
  readonly error?: string
  readonly revision: number
}

export interface AuthorizationStartValue {
  readonly attemptId: string
}

export interface AuthorizationCancelValue {
  readonly cancelled: boolean
}

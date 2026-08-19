/** Provider-specific credential health classification contract. */
import { Context, Service } from '@deepseek-ai/cordis'

export type HealthDisposition =
  | { kind: 'healthy' }
  | { kind: 'cooldown'; retryAfterMs?: number }
  | { kind: 'quarantine'; reason: string }
  | { kind: 'model-exclude'; model: string }
  | { kind: 'reauthenticate'; reason: string }
  | { kind: 'remove'; reason: string }
  | { kind: 'retain' }

export interface ProviderFailureEvidence {
  readonly provider: string
  readonly model: string
  readonly code?: string
  readonly status?: number
  readonly retryAfterMs?: number
  readonly providerCode?: string
}

/** Provider-owned classifier registry; callers supply evidence, never secret values. */
export abstract class CredentialHealth extends Service {
  constructor(ctx: Context) { super(ctx, 'credentialHealth') }
  abstract classify(evidence: ProviderFailureEvidence): HealthDisposition
}

declare module '@deepseek-ai/cordis' {
  interface Context { credentialHealth: CredentialHealth }
}

/** Conservative DeepSeek API classifier. Ambiguous authorization failures remain quarantined. */
export class DeepSeekCredentialHealth extends CredentialHealth {
  override classify(evidence: ProviderFailureEvidence): HealthDisposition {
    if (evidence.provider !== 'deepseek-official') return { kind: 'retain' }
    if (evidence.status === 429) return { kind: 'cooldown', ...evidence.retryAfterMs === undefined ? {} : { retryAfterMs: evidence.retryAfterMs } }
    if (evidence.status === 401 || evidence.providerCode === 'invalid_api_key') return { kind: 'remove', reason: 'invalid credential evidence' }
    if (evidence.status === 404 && evidence.providerCode === 'model_not_found') return { kind: 'model-exclude', model: evidence.model }
    if (evidence.status === 403) return { kind: 'quarantine', reason: 'authorization denial requires provider-specific verification' }
    return { kind: 'retain' }
  }
}

export default CredentialHealth

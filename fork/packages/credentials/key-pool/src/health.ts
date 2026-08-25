/** Conservative health policy for user-managed API key pools. */
import type { Context } from '@deepseek-ai/cordis'
import { CredentialHealth } from '@deepseek-ai/dsh-fork-credential-health'
import type { HealthDisposition, ProviderFailureEvidence } from '@deepseek-ai/dsh-fork-credential-health'

/**
 * Classifies provider failures into pool health decisions. The pool user
 * config owns credential membership, so a provider-rejected credential is
 * quarantined for manual attention instead of being removed; rate limits and
 * exhausted quotas cool the key down for the configured fallback delay.
 *
 * Classification reads the harness's provider-neutral failure codes, which
 * every adapter family emits (some flatten HTTP status into text, so codes —
 * not statuses — are the one signal shared across routes).
 */
export class KeyPoolHealth extends CredentialHealth {
  constructor(ctx: Context, private readonly defaultCooldownMs: () => number) {
    super(ctx)
  }

  override classify(evidence: ProviderFailureEvidence): HealthDisposition {
    if (evidence.code === 'RATE_LIMIT' || evidence.code === 'QUOTA') {
      return { kind: 'cooldown', retryAfterMs: evidence.retryAfterMs ?? this.defaultCooldownMs() }
    }
    if (evidence.code === 'AUTH' || evidence.providerCode === 'invalid_api_key') {
      return { kind: 'quarantine', reason: 'provider rejected this credential; fix or remove it from the pool' }
    }
    return { kind: 'retain' }
  }
}

export default KeyPoolHealth

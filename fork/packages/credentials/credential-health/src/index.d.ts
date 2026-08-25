/** Provider-specific credential health classification contract. */
import { Context, Service } from '@deepseek-ai/cordis';
/** Conservative action selected after classifying one provider failure. */
export type HealthDisposition = {
    kind: 'healthy';
} | {
    kind: 'cooldown';
    retryAfterMs?: number;
} | {
    kind: 'quarantine';
    reason: string;
} | {
    kind: 'model-exclude';
    model: string;
} | {
    kind: 'reauthenticate';
    reason: string;
} | {
    kind: 'remove';
    reason: string;
} | {
    kind: 'retain';
};
/** Provider evidence used for classification; it never contains secret values. */
export interface ProviderFailureEvidence {
    readonly provider: string;
    readonly model: string;
    readonly code?: string;
    readonly status?: number;
    readonly retryAfterMs?: number;
    readonly providerCode?: string;
}
/** Provider-owned classifier registry; callers supply evidence, never secret values. */
export declare abstract class CredentialHealth extends Service {
    constructor(ctx: Context);
    /** Classify provider evidence without retrying or mutating credentials.
     * @param evidence provider failure facts.
     * @returns the conservative health disposition.
     */
    abstract classify(evidence: ProviderFailureEvidence): HealthDisposition;
}
declare module '@deepseek-ai/cordis' {
    interface Context {
        credentialHealth: CredentialHealth;
    }
}
/** Conservative DeepSeek API classifier. Ambiguous authorization failures remain quarantined. */
export declare class DeepSeekCredentialHealth extends CredentialHealth {
    classify(evidence: ProviderFailureEvidence): HealthDisposition;
}
export default DeepSeekCredentialHealth;
//# sourceMappingURL=index.d.ts.map
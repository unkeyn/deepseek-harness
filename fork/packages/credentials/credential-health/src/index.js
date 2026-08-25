/** Provider-specific credential health classification contract. */
import { Service } from '@deepseek-ai/cordis';
/** Provider-owned classifier registry; callers supply evidence, never secret values. */
export class CredentialHealth extends Service {
    constructor(ctx) { super(ctx, 'credentialHealth'); }
}
/** Conservative DeepSeek API classifier. Ambiguous authorization failures remain quarantined. */
export class DeepSeekCredentialHealth extends CredentialHealth {
    classify(evidence) {
        if (evidence.provider !== 'deepseek-official')
            return { kind: 'retain' };
        if (evidence.status === 429)
            return { kind: 'cooldown', ...evidence.retryAfterMs === undefined ? {} : { retryAfterMs: evidence.retryAfterMs } };
        if (evidence.status === 401 || evidence.providerCode === 'invalid_api_key')
            return { kind: 'remove', reason: 'invalid credential evidence' };
        if (evidence.status === 404 && evidence.providerCode === 'model_not_found')
            return { kind: 'model-exclude', model: evidence.model };
        if (evidence.status === 403)
            return { kind: 'quarantine', reason: 'authorization denial requires provider-specific verification' };
        return { kind: 'retain' };
    }
}
export default DeepSeekCredentialHealth;
//# sourceMappingURL=index.js.map
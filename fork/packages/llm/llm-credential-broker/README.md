# dsh-llm-credential-broker

`BrokeredLlmAdapter` decorates one provider adapter with request-scoped credential leases. It delegates model catalog and metadata methods, resolves the selected reference through `ctx.credentials`, and passes the resolved value only to a provider-owned stream callback.

A lease completes once on success, provider error, cancellation, missing credential, stream failure, or a stream that ends without a finish chunk. An optional failover policy allows only configured failure codes, excludes credential ids already used by the decision, completes each failed lease before the next acquire, and enforces a positive finite `maxAttempts` count. An acquire rejection ends the decision and surfaces the last provider failure, or the rejection itself when no attempt streamed. For normal provider retry policies, the adapter raises `maxRetries` to at least `maxAttempts - 1`; an explicitly larger provider budget and an `always` policy remain unchanged.

## Model Experience

### Brokered provider request

#### What the model sees

The selected provider receives the same assembled `GenerateOptions` messages, system text, tools, and generation settings as the delegate adapter. Credential selection and failover metadata are not model-visible.

#### Token effect

Lease selection and authorization add no prompt or completion tokens.

#### KV Cache effect

Failover changes only the provider authorization attempt. It does not alter request content or cache identity; a provider may still invalidate transport-side reuse when a new attempt starts.

## Known Limitations and Deferred Work

- The callback adapter must implement provider-specific HTTP or SDK behavior and honor the request signal.
- Failure classification is currently `retain`; provider adapters will map provider evidence to cooldown, quarantine, model exclusion, reauthentication, or removal in the health slice.

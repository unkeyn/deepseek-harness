# dsh-credential-broker

Provider-neutral Service Definition for `ctx.credentialBroker`. It selects a request-scoped lease while credential providers retain secret values and LLM adapters own provider requests.

The contract supports API-key and OAuth entries without imposing a universal OAuth flow. A lease is completed exactly once with success, cancellation, or a provider-specific failure disposition. A request may exclude credential ids already attempted by one bounded failover decision; providers must honor that exclusion when selecting a lease.

A broker also exposes a detached, secret-free snapshot source through `getSnapshot()` and `subscribe()`. Events are full snapshots, entry replacements, or removals tagged with a monotonically increasing generation; equal and older generations are ignored. Every subscription returns `dispose()`, and broker fiber disposal closes pending async consumers and removes listeners.


### Credential lease selection

#### What the model sees

Nothing. `ctx.credentialBroker` lease metadata, credential references, and failover exclusions stay below the model request.

#### Token effect

The broker adds no prompt or completion tokens.

#### KV Cache effect

The broker does not change request content or cache identity.

## Known Limitations and Deferred Work

- This package defines the seam; pool persistence, selection policy, health classification, OAuth adapters, and proxy routing are separate providers.
- No production broker provider is included in this first contract slice.

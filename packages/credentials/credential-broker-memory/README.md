# dsh-credential-broker-memory

In-memory provider for `ctx.credentialBroker`. It is intended for previews, composition tests, and deterministic lifecycle tests. It stores only credential references and operational counters; secret values remain owned by `ctx.credentials`.

Entries have a pool, credential id, credential reference, authentication kind, priority, and concurrency limit. Waiting requests are released when a live lease is completed or the broker is disposed.

## Model Experience

### In-memory lease selection

#### What the model sees

Nothing. `ctx.credentialBroker` state and credential references are not included in model messages.

#### Token effect

The provider adds no prompt or completion tokens.

#### KV Cache effect

The provider preserves request content and does not change cache identity.

## Known Limitations and Deferred Work

- State is process-local and is not a production pool store.
- Health classification, cooldown, OAuth refresh, and proxy selection are not implemented here.

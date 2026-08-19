# dsh-credential-pool-store

Durable provider-neutral metadata store for credential pools. It uses the configured storage backend's KV facet and writes one versioned global snapshot, so pool ownership and credential entries commit together.

The store persists pool ids, provider routes, credential ids, references, authentication kind, priority, concurrency limit, enabled state, and health state. Health state records cooldown deadlines, quarantine and reauthentication reasons, model exclusions, the latest classified failure, and success timestamps. Secret values remain in `ctx.credentials` and are never written to this snapshot.

Credential records carry a monotonic `generation`, and the snapshot carries a monotonic mutation generation. `updateCredentialHealth`, `setCredentialEnabled`, and `setCredentialReauthentication` require the credential id plus both generations in a `CredentialMutationVersion`. The broker-owned operation queue checks that token inside the serialized read-modify-commit operation and raises `CredentialPoolStaleWriterError` with code `CREDENTIAL_POOL_STALE_WRITER` for an obsolete writer. Successful mutations increment both generations and return the new token; these methods never resolve or write secrets.

## Model Experience

None directly. The store is a host-side service consumed by broker providers and operational UI.

## Known Limitations and Deferred Work

- The current format uses one global snapshot and is intended for the initial JSON/SQLite KV backends; large pools may need a paged format later.
- Cross-process coordination is delegated to the selected storage backend.
- Health policy providers own classification and mutation decisions; this store validates and durably retains their non-secret result.

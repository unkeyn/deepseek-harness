# dsh-credential-broker-pool

Credential broker provider backed by `ctx.credentialPoolStore`. Each acquire reads the current durable metadata snapshot, chooses the highest-priority enabled entry with spare local lease capacity that is not in an active cooldown, excluded for the requested model, or listed in `excludedCredentials`, and returns only its credential reference.

## Model Experience

### Pool-backed lease selection

#### What the model sees

Nothing. Pool metadata, lease ids, credential ids, and `excludedCredentials` are not included in model messages.

#### Token effect

Pool selection adds no prompt or completion tokens.

#### KV Cache effect

The provider preserves request content, so pool selection does not change cache identity.

## Known Limitations and Deferred Work

- The broker retains only live lease counters; restart releases unfinished leases by design.
- Health policy providers own disposition classification; `completeWithHealth` applies cooldown, quarantine, model exclusion, reauthentication, removal, healthy, and retain decisions through the pool store's credential CAS token.

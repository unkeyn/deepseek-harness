# Agent Note: key-pool rotation composition

English | [中文](2026-08-24-key-pool-rotation-composition.zh.md)

Status: implemented

## Problem

The fork already had a complete credential-broker contract, pool store, health classifier, and a brokered LLM adapter decorator — but no composition mounted them, so a provider route still resolved one fixed credential reference per request. Web-search keys had a pool with cooldowns, but selection pinned the highest-priority key until it failed, which concentrates parallel sessions on one credential.

## Decision

`@deepseek-ai/dsh-fork-key-pool` composes the existing stack into a working vertical slice. The plugin registers three services in one `apply()`: a settings-durable `credentialPoolStore` (same surface and CAS semantics as the storage-backed store, persisted through the `key-pool` settings section so no storage backend is required), the `credentialHealth` classifier (cooldown on 429 with Retry-After or the configured fallback, quarantine instead of removal for provider-rejected keys because the user config owns membership), and the pool-backed `credentialBroker`. `PoolCredentialBroker` rotates equal-priority credentials per acquire instead of sorting to the first one, which is what distributes parallel sessions across the pool; explicit priorities still order the failover ladder. An acquire parks only on exhausted lease capacity, re-checked on a release and on membership republishes; a cooldown window rejects with retryable `CREDENTIAL_COOLDOWN` naming the earliest expiry, and every other empty selection rejects with `NO_ELIGIBLE_CREDENTIAL`, so a failover decision that consumed every key surfaces the provider error immediately and the outer retry policy owns the cooldown wait on its visible schedule instead of the request stalling silently inside the broker. Because the failover loop acquires its next lease before the previous lease's health mutation lands, `completeWithHealth` retries a CAS token staled by an unrelated credential's mutation, keeping cooldowns durable in the both-keys-failed case.

`llm-deepseek` and `llm-pi-ai` always route through `BrokeredLlmAdapter` with a dynamic failover resolver (`ctx.keyPool.failover(provider)` per stream; the pi-ai instance reads the route from the request, so one decorator covers every profile) and a lazy health resolver. The decorator streams straight through the delegate while the resolver answers `undefined` or the broker/credential services have not loaded yet — loader entries apply in parallel (`Promise.allSettled` in the Include group), so any construction-time service requirement would be a load-order race. A static policy still requires its services at construction and fails loud. Each adapter exposes the new `streamWithKey`, and request-shape validation stays ahead of credential resolution. `web-search-pool` rotates its attempt order within the top priority tier per search for the same distribution reason.

The pool health classifier reads the harness's provider-neutral failure codes, not HTTP statuses: some adapter families flatten status into error text, so codes are the one failure signal shared across routes. `RATE_LIMIT`/`QUOTA` cool the key down (Retry-After when the adapter extracted one, the configured fallback otherwise); `AUTH` quarantines.

The Models page edits pools in place: each provider editor on the API providers tab renders its additional keys beneath the primary field — one write-only row per extra key with a remove button, plus an add-key button that derives the next free `<PRIMARY>_N` reference. Apply stores the values through `credentials.set`, unsets removed ones, and writes the pool membership as one set op over the freshly described `key-pool` section (the primary key is the pool's first entry, and a provider with no extra key keeps no pool at all). A deployment without the key-pool plugin has no such namespace and the section stays hidden.

## Alternatives considered

**Storage-backed pool store:** requires `storage` + `storage-json` in every composition before the pool works; the settings document is already durable, and the plugin writes health there with the same serialized-chain pattern as `web-search-pool`.

**Rotation inside `resolveApiKey`:** would spread keys but cannot fail over mid-request or record health; the lease boundary is what makes completion accounting exact.

**Removing rejected credentials on 401:** a transient gateway 401 would delete a user-managed key; quarantine keeps membership under config ownership.

**Status-based health classification:** pi-ai flattens HTTP statuses into error text (an upstream XXX), so statuses are absent on some routes; provider-neutral codes are the one signal every adapter emits.

**A separate key-pool settings panel:** multi-key editing belongs where the primary key already lives — the provider editor — so one provider's keys are managed on one card instead of a second segment.

## Consequences

Pool membership changes reach the next request without restart; both adapters re-read the captured retry floors on `keyPool` changes through `registration.replace`. The `key_pool_status` tool exposes redacted health to the agent. OAuth account pools and proxy binding stay with the roadmap tasks that own the general store.

# @deepseek-ai/dsh-fork-key-pool

User-managed API key pools for provider routes. A pool names one provider route and several credential references; the credential broker rotates equal-priority keys across concurrent requests, cools a key down after classified failures, and fails over to the next eligible key within a bounded attempt budget. Key values stay in `ctx.credentials`; this plugin stores references and redacted health metadata in the `key-pool` settings namespace only.

## Config

```yml
- name: '@deepseek-ai/dsh-fork-key-pool'
  config:
    maxAttempts: 3          # total provider attempts per request, including the first
    cooldownMs: 30000       # fallback cooldown for a rate-limited key without Retry-After
    maxConcurrentPerKey: 4  # simultaneous leases per key
    pools:
      - provider: deepseek-official
        keys:
          - ref: DEEPSEEK_API_KEY      # the same reference the Models page writes
          - ref: DEEPSEEK_API_KEY_2
```

`provider` is the provider route id (`deepseek-official` for the fork's primary route). A provider without a pool keeps streaming through its unwrapped adapter; adding or emptying a pool reaches the very next request without restarting.

## Selection, rotation, and failover

- **Rotation.** Equal-priority eligible keys rotate per acquire, so parallel sessions spread across the pool instead of pinning one key. Explicit priorities order the failover ladder; rotation happens within the top eligible tier.
- **Backpressure.** A key at its `maxConcurrentPerKey` cap is skipped for that acquire; when every key is at cap the acquire waits for the first release.
- **Failover.** `maxAttempts` bounds how many different keys one request tries. Failure codes that permit another key: `AUTH`, `MISSING_CREDENTIAL`, `QUOTA`, `RATE_LIMIT`, `SERVER`, `TIMEOUT`, `TRANSPORT`.
- **Health.** Classification reads the provider-neutral failure codes every adapter family emits: `RATE_LIMIT`/`QUOTA` cool the key down (Retry-After when the adapter extracted one, `cooldownMs` otherwise) and `AUTH` quarantines the key for manual attention. Config owns membership — a quarantined key is never deleted; remove it from the pool instead. A successful lease clears cooldown and quarantine state.
- **Durability.** Health and membership survive restart through the settings document; in-flight CAS tokens fence stale health writers.
- **Routes.** Both the `deepseek-official` adapter and every `llm-pi-ai` route (shipped catalogs and hand-declared ones) stream through the brokered decorator; a route without a pool is untouched, and adding one reaches the very next request.

The Models page edits pools in place: a provider editor on the API providers tab lists its additional keys under the primary field, each with its own remove control, plus an add-key button. Values travel through `credentials.set`; the pool membership is one settings write. A deployment without this plugin shows no such section.

## Model Experience

`key_pool_status` reports pools, per-key eligibility, cooldown and quarantine state, and redacted failure summaries. It never returns key values, and its output is ordinary tool-result text; pool configuration and health metadata never enter prompts or the KV cache beyond the one system-prompt sentence that names the tool.

## Known Limitations and Deferred Work

- The failure classifier is code-based and conservative: `SERVER`/`TIMEOUT`/`TRANSPORT` failures fail over without recording health, and only `RATE_LIMIT`, `QUOTA`, and `AUTH` change key state.
- Quarantine has no automatic expiry; clearing it means re-saving the key or editing the settings document.
- OAuth account pools and proxy binding remain roadmap work (CRED-001/ROUTE-001/HEALTH-001 own the general store and lease lifecycle this plugin composes).

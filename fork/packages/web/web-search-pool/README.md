# @deepseek-ai/dsh-fork-web-search-pool

A user-managed generic HTTP search provider for `ctx.web`. The provider stores endpoint and response mapping in the `web-search-pool` settings namespace and stores API values only through credential references. Its browser card can add multiple providers and multiple write-only keys per provider.

## Config

Each provider supplies an HTTPS endpoint, a provider priority, GET or POST query placement, authentication mode, and dot paths for the result array and source fields. Each key has its own priority and maximum concurrent request count. The default route mounts the provider as `custom-pool` before the official DeepSeek search provider, so an empty or exhausted pool falls through to the next configured web provider.

`maxAttempts` bounds key rotation for one search. A failed key receives a cooldown and a redacted error summary containing no credential value. HTTP 401/403 responses additionally quarantine that key for the cooldown period; 429, server, parse, and transport failures remain retryable cooldowns. A successful key clears its health metadata. Cancellation never rotates to another key.

The settings document contains references and redacted health metadata only. Key values are written through `credentials.set` and resolved immediately before a request. The browser receives configured state and error metadata, never the key literal.

## Model Experience

The existing `web_search` tool receives the normalized URL, title, snippet, and publication-date fields from the selected custom provider. `web_search_pool_status` exposes provider/key identifiers, priorities, eligibility, cooldown/quarantine timestamps, concurrency limits, and sanitized errors without secret values. `web_search_pool_rotate` can enable, disable, or cooldown one named key and accepts no credential value. Provider and key failures remain structured `WebError` diagnostics; an exhausted custom pool can fall through the configured web provider route.

#### KV Cache effect

The pool settings and health metadata are not inserted into the conversation context or KV cache. The two pool management tools add their schemas and guidance to model requests when the pool plugin is mounted; their results are logged as ordinary tool results and contain only redacted metadata.

## Known Limitations and Deferred Work

- The adapter accepts JSON result bodies and maps one configured result array; provider-specific request bodies, pagination, and generated answer text are not supported.
- Cooldown and error metadata share the settings document with user edits. A concurrent edit is revision-fenced by the settings service and a health persistence failure never changes the search result.
- Key selection is priority-ordered per request. It is bounded failover, not weighted round-robin accounting or provider-specific request-body/pagination support.

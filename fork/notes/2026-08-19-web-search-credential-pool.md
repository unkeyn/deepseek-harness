# Agent Note: Web search credential pools

Status: implemented

English | [中文](2026-08-19-web-search-credential-pool.zh.md)

## Problem

The shipped web search route used one provider credential at a time. Deployments that need custom search APIs, several keys, or a provider fallback had no persistent settings model that could be edited from the Web UI without placing secret values in settings or model-visible diagnostics.

## Decision

`@deepseek-ai/dsh-web-search-pool` owns a `web-search-pool` settings namespace, the `custom-pool` provider, and two model-facing management tools. The settings document stores provider routes, priorities, bounded attempts, key references, concurrency limits, and redacted health metadata. Secret literals travel only through `ctx.credentials`; the browser receives configured/source metadata and never receives a key value.

Each search snapshots eligible providers and keys for that request, orders them by provider and key priority, reserves each key up to `maxConcurrent`, and tries at most `maxAttempts` distinct provider/key pairs. A failure releases the reservation and records a cooldown; 401/403 also quarantine the key. Cancellation stops the operation without rotating or recording ordinary failure health. Successful requests clear transient health metadata. Health writes are serialized and failure to persist health never changes the search result.

The adapter accepts only absolute HTTPS endpoints, rejects redirects on credential-bearing requests, maps a configured JSON result path to the shared web source type, and emits stable safe diagnostics. `web_search_pool_status` exposes identifiers, eligibility, timing, limits, and sanitized errors. `web_search_pool_rotate` changes enablement or cooldown by provider/key id and accepts no secret. WebRuntime keeps ordered provider fallback outside the pool, so an exhausted or unavailable custom pool can fall through to the next configured provider.

The base composition mounts the pool before the official DeepSeek search provider. The pool package is a direct dependency of the CLI installation anchor, alongside the existing custom web providers, because the profile module fallback resolves Loader rows by traversing that manifest's dependency graph.

## Alternatives considered

**Store API key literals in the settings document.** Rejected because settings are readable configuration state and the browser/model surfaces must not receive secret values; credential references preserve the existing write-only credential service.

**Rotate keys globally or with process-wide round-robin state.** Rejected because one request must have a bounded, deterministic candidate set and concurrent requests must not share mutable selection state; request-scoped ordering plus per-key reservations provides predictable failover.

**Let the pool implement all provider fallback.** Rejected because provider ordering belongs to `ctx.web`; the pool owns only key rotation within its provider and remains composable with the web seam's ordered routes.

**Follow HTTP redirects.** Rejected because the request carries a credential; `redirect: 'error'` prevents automatic forwarding to a different origin.

## Consequences

Users can add custom providers and write-only keys from the Plugins settings card, change routes, priorities, limits, mappings, enablement, and health controls, and inspect safe status through the model tools. The generic adapter supports one JSON result array and one query field per provider; provider-specific pagination, signed requests, and generated answer text remain outside its contract. The real-composition smoke mounts the shipped Loader tree and asserts the pool tools and settings namespace; pool tests pin rotation, bounded failover, redirect rejection, safe diagnostics, and fiber disposal.

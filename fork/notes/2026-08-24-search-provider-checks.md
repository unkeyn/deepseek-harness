# Agent Note: search-provider presets, live pool, and key checks

English | [中文](2026-08-24-search-provider-checks.zh.md)

Status: implemented

## Problem

The search-providers panel could not produce a working Firecrawl request: its preset aimed at `api.firecrawl.ai` — a parked domain (lander nameservers, shared-hosting addresses) — with a `GET` + `x-api-key` shape and a `results` response path the real API never had. A saved pool edit also never reached the running plugin: `installSettingsSection` invokes `setSource` only at attach, so the pool's `onChange: () => {}` left the runtime config frozen at load until a restart. And nothing about a stored key was visible — neither whether it was accepted nor what remained of its quota — so a failing search could not be told apart from an exhausted one.

## Decision

The pool stays fully config-driven; what changed is the data and the freshness. The Firecrawl preset and the dedicated `web-search-firecrawl` provider speak the current v2 API: `POST https://api.firecrawl.dev/v2/search` with `Authorization: Bearer` and results read from `data.web`; Brave's preset names `x-subscription-token` on `/res/v1/web/search` with `web.results`, and Exa's uses `x-api-key`. The pool plugin now rebuilds its runtime config from the authoritative source on every committed settings change, so a provider or key saved in the browser joins the live pool without a reload — the same freshness its health patches already had.

Each provider may carry an optional `check` spec (account endpoint plus dot paths for usage, limit, and remaining credits). The card's key check runs host-side — keys never reach the browser — over a loopback-only `/web-search-pool` Connection channel owned by the pool plugin itself; the wire envelope is the shared `client-request`/`server-response` pair, so the caller is the generic `connection.rpc`. A provider with a spec gets validity plus credit numbers from one account call (Firecrawl ships `v2/team/credit-usage` in its preset); one without falls back to a single minimal real query, where any non-401/403 answer confirms the key. The panel is redrawn in the Models page's provider vocabulary — outlined rows with a credential dot and key count, a filled per-provider editor with write-only key rows, a dashed add-provider affordance, the advanced options behind a disclosure, and the shared Discard/Save footer — so the search tab reads as a sibling of the API providers tab.

## Alternatives considered

**Fixing only the stored document:** a one-off settings write would have repaired the running entry but left every freshly added provider broken; the preset and provider are where the wrong API lived.


**A pure validity ping for everyone:** Brave and Exa expose no credit endpoint, but Firecrawl's account call is free and exact — the spec carries the richer path where the provider has one and the ping stays the universal fallback.

## Consequences

Saved pool edits apply to the next search without a restart, and the key check turns "search fails" into a per-key verdict with remaining credits. The check costs one minimal query on providers without an account endpoint. `web-search-deepseek` had a stored `baseURL: https://firecrawl.dev` override that sent the fallback provider to a non-Messages endpoint; clearing it restored the documented default, which surfaced the separately stale DeepSeek search credential.

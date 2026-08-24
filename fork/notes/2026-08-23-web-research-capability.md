# Agent Note: Web research capability completion

Status: implemented

English | [中文](2026-08-23-web-research-capability.zh.md)

## Problem

The fork registered a key-rotating search pool but never routed it: the shipped composition configured `searchProvider: deepseek-official`, so `custom-pool` keys configured in the UI had no effect. The seam had no fetch provider and the base composition ran `tool-web` with `fetch: false`, so the model could never read a cited page — search snippets were the ceiling of its web access. The Brave, Exa, and Firecrawl settings cards wrote namespaces that no mounted host plugin serves (a defect inherited from upstream), and `searchProvidersByTask` had no caller: no consumer can set `task` on a request.

## Decision

**Route the pool by default.** The fork overlay now configures `searchProviders: [custom-pool, deepseek-official]`. An empty, exhausted, cooling, or unconfigured pool reports `available() === false`, is skipped on the multi-entry route, and the official DeepSeek provider answers; configured pool keys are preferred when eligible.

**Ship fetch.** A fork port of the official anonymous HTTP(S) fetch provider (`@deepseek-ai/dsh-fork-web-fetch-http`) registers under id `http`, and the official `tool-web` row is replaced (`tool-web-fork`) without `fetch: false`, so `web_fetch` reaches the model. Same-origin-only redirects, byte/char caps, and explicit product User-Agent carry over from the upstream implementation.

**Teach methodology, not providers.** The seam service contributes one provider-agnostic system-prompt section (`web:research`): snippets are discovery aids — fetch the cited page before trusting it; prefer primary sources; corroborate across independent sources; never re-search a known URL; mark unverified claims. Per-provider quirks stay in adapters, mirroring the reference design's rule that model-facing prompts name capabilities, not vendors.

**Delete dead surface.** `WebSearchTask`, `searchProvidersByTask`, and the per-request `task` field are removed from the fork seam along with their tests. The orphaned Brave/Exa/Firecrawl cards, controllers, and locale bundles are removed from the fork settings UI; the DeepSeek card (served namespace) and the Models-page pool panel remain.

## Alternatives considered

**Wire the orphan cards to real settings sections in each fork provider.** Rejected as per-provider bespoke work duplicating the pool panel, which already covers Firecrawl, Brave, and Exa presets with write-only keys.

**Keep task routing for future consumers.** Rejected: nothing can set `task`, and unexercised routing surface invites untested selection paths.

**Add SSRF private-network blocking to the fetch port while forking.** Deferred with the upstream package's documented limitation; changing that policy belongs to the upstream owner where the tests live.

## Consequences

Deep research now has a closed loop end to end: `web_search` finds sources through the user's pool or the official provider, `web_fetch` reads them, and the standing prompt section enforces verify-before-cite behavior. The pool README's route claim became true instead of aspirational; the seam README documents the ordered-route semantics and the new section's KV-cache cost.

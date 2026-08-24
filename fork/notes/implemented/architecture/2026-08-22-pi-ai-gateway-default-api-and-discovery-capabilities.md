# Agent Note: Gateway-default wire protocol and catalog-enriched model discovery

Status: implemented

English | [中文](2026-08-22-pi-ai-gateway-default-api-and-discovery-capabilities.zh.md)

## Problem

A model id that both reference catalogs miss — a provider's newest release, adopted from the endpoint's own listing — failed `llm-pi-ai` route resolution with "needs an api" whenever no route-level protocol was stated. The Settings form surfaced this as a red refusal under the model rows, so fetched-but-unlisted models could not be selected even though the endpoint served them. Separately, endpoint interrogation returned ids and capacities only: nothing told the adopting surface whether a candidate takes images or reasons.

## Decision

Model resolution resolves the wire protocol through a documented fallback chain in the owning resolve step: route `api` → that id's installed-catalog or identity-catalog answer → what every shipped model on the route agrees on → the nearest preceding sibling the catalogs describe → the OpenAI-compatible gateway default (`openai-completions`). A hand-declared route exists to serve one OpenAI-compatible gateway, and endpoint interrogation already probes such endpoints as Chat Completions, so the final fallback restates an assumption the seam already makes rather than inventing one. Provider construction binds one implementation per route, so a route whose models resolve to disagreeing protocols must still name `api` explicitly.

Endpoint interrogation enriches each candidate with reference-catalog facts — accepted input modalities and reasoning levels (installed pi-ai catalog first, shared identity catalog second), capacities when the listing disclosed none, and a `catalogMatched` marker. The Models page renders these as compact badges; adoption writes image capability onto the row, while reasoning stays resolution-owned because its wire spellings are adapter vocabulary. The capability fields are additive optional JSON on fork-owned types (`LlmDiscoveredModel`, the apiproxy `DiscoveredModelView`, its zod schema); official contracts are untouched.

The Models page is now a segment switcher: **API providers** (the existing list) plus feature panels registered through the new `settings.models.panel` slot — Freebuff OAuth (moved from its Plugins tab) and the ready-made search-providers editor (moved from the Plugins card list, rendered expanded). Panels stay mounted once visited so editor drafts survive switching. Page styling is compacted within the existing design vocabulary.

## Alternatives considered

- **Silent per-model protocol guessing beyond the gateway default** — rejected: anything wider hides real misconfiguration. Disagreement stays loud.
- **Writing reasoning efforts onto adopted rows** — rejected: wire spellings are adapter-owned; the identity catalog already answers at resolution time for known ids.
- **Pinning route `api` during adoption** — rejected: a route-level override shadows every catalog model's own protocol, breaking mixed catalog routes.
- **Keeping OAuth/search panels under Plugins** — rejected per product direction: keys for models and keys for search are one task, so they share the Models page.

## Consequences

An unlisted-but-real model is selectable the moment the endpoint lists it, with no hand-edited protocol. The strictness contract narrows by exactly one documented default; direct `settings.yaml` authors keep explicit control via route `api`. The Plugins page loses the OAuth tab and the search-providers card; both live behind the Models segments. Node-lane specs importing their own package through the bare client specifier were switched to relative source imports after the built bundle's loader wrapper crashed import-time evaluation outside jsdom.

## Verification

`pnpm run typecheck` passes; `pnpm --dir .. exec vitest run --config fork/vitest.config.ts` passes 135 files / 2273 tests including new cases for the gateway-default fallback, explicit-route precedence, discovery capability enrichment, panel registration, and card-list movement. `pnpm run build:lib` bundles host and client faces; the assembled web app boots, dispatches a turn with `request/header` 2 ms after step start, and serves client bundles containing the new panel wiring.

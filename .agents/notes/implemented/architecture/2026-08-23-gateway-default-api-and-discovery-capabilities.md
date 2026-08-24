# Agent Note: Gateway-default wire protocol and catalog-enriched model discovery

Status: implemented

English | [中文](2026-08-23-gateway-default-api-and-discovery-capabilities.zh.md)

## Problem

A model id that both reference catalogs miss — a provider's newest release, adopted from the endpoint's own listing — failed `llm-pi-ai` route resolution with "needs an api" whenever no route-level protocol was stated. The Settings form surfaced this as a red refusal under the model rows, so fetched-but-unlisted models could not be selected even though the endpoint served them. Separately, endpoint interrogation returned ids and capacities only: nothing told the adopting surface whether a candidate takes images or reasons.

## Decision

Model resolution resolves the wire protocol through a documented fallback chain in the owning resolve step: route `api` → that id's installed-catalog or identity-catalog answer → what every shipped model on the route agrees on → the nearest preceding sibling the catalogs describe → the OpenAI-compatible gateway default (`openai-completions`). A hand-declared route exists to serve one OpenAI-compatible gateway, and endpoint interrogation already probes such endpoints as Chat Completions, so the final fallback restates an assumption the seam already makes rather than inventing one. Provider construction binds one implementation per route, so a route whose models resolve to disagreeing protocols must still name `api` explicitly.

An id whose protocol facts came from fallback rather than an installed entry pins one compat switch conservatively: `supportsDeveloperRole: false`. pi-ai's baseURL detection answers an unrecognizable private URL as OpenAI itself and would send a reasoning model's system prompt as the `developer` role, which most gateways refuse. Installed entries, route config, and model config all win over the pin.

Endpoint interrogation enriches each candidate with reference-catalog facts — accepted input modalities and reasoning levels (installed pi-ai catalog first, shared identity catalog second), capacities when the listing disclosed none, and a `catalogMatched` marker. The LLM runtime dedup pass forwards these fields instead of rebuilding rows field by field, so they survive to the wire view. The Models page renders them as compact badges; adoption writes image capability onto the row, while reasoning stays resolution-owned because its wire spellings are adapter vocabulary. The capability fields are additive optional JSON on `LlmDiscoveredModel`, the apiproxy `DiscoveredModelView`, and its zod schema.

## Alternatives considered

- **Silent per-model protocol guessing beyond the gateway default** — rejected: anything wider hides real misconfiguration. Disagreement stays loud.
- **Writing reasoning efforts onto adopted rows** — rejected: wire spellings are adapter-owned; the identity catalog already answers at resolution time for known ids.
- **Pinning route `api` during adoption** — rejected: a route-level override shadows every catalog model's own protocol, breaking mixed catalog routes.
- **Leaking unknown fields through the runtime dedup pass untyped** — rejected: every field a discovered row carries is enumerated in one place, so a dropped field is a visible edit rather than silent loss.

## Consequences

An unlisted-but-real model is selectable the moment the endpoint lists it, with no hand-edited protocol. The strictness contract narrows by exactly one documented default; direct `settings.yaml` authors keep explicit control via route `api`.

`packages/llm/llm-pi-ai/tests/catalog.spec.ts` verifies the gateway-default fallback, explicit-route precedence, the developer-role pin, and model-config precedence over the pin. `packages/llm/llm-pi-ai/tests/discovery.spec.ts` verifies enrichment from both catalogs, disclosed-capacity precedence, and the unmatched marker. `packages/client/ui-settings-models/tests/provider-form.client.spec.tsx` verifies badge rendering and image-capability adoption.

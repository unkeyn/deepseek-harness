# Agent Note: A catalog route's endpoint derives from its installed siblings

Status: implemented

English | [中文](2026-08-25-route-endpoint-from-catalog-siblings.zh.md)

## Problem

Several pi-ai catalog providers state no provider-level endpoint — the address lives on each model (`opencode`, `opencode-go`). Model listing for such a route merges the endpoint's live listing with the installed catalog, so the configuration surface offers ids the installed catalog does not describe yet. Adopting one refused the route at write time: the endpoint chain (route `baseURL` → entry → provider entry) had no answer for exactly the id the surface had just offered, and the only escape was typing the endpoint the catalog already records on every sibling. A second hole sat beside it: an installed entry whose `baseUrl` is the empty string (the Azure family's per-deployment spelling) won the chain as a value, so the route stored and every request targeted no host.

## Decision

`resolveRouteModels` derives a catalog route's endpoint when no layer names one. The exported `routeCatalogBaseUrl` answers the catalog provider's own `baseUrl` when it states one; a provider that states none answers with the shortest non-empty endpoint its installed models carry, preferring spellings that end in a version segment because those record the mounted API rather than a published prefix. The OpenAI SDK appends `/chat/completions` to the request base verbatim, so a sibling-derived base for the two OpenAI-shaped protocols is mounted at `/v1` when every recorded spelling lacks the segment — the convention the listing probe's fallback candidate follows. The discovery probe uses the same derivation: the helper lives once in the catalog module and `discoverModels` imports it, so the listing a user adopts from and the endpoint resolution serves cannot drift. A provider-declared baseUrl and explicit route configuration are upstream statements and are taken verbatim.

An empty `baseUrl` on an installed or reference entry states no address and does not win the chain; a route whose models and provider entry all state no endpoint must configure `baseURL`, and fails at the write that stores it. This refines, without superseding, [the declared-provider catalog note](../architecture/2026-08-03-pi-ai-declared-provider-catalog.md) — a route the catalog does not ship still names `api`, `baseURL`, and a non-empty `models` list — and leaves [draft endpoint interrogation](../architecture/2026-08-04-draft-provider-endpoint-interrogation.md) untouched.

## Alternatives considered

**Persist the derived endpoint into the profile at adoption time.** Rejected: `settings.yaml` records what the deployment chose, while the derivation is catalog fact; a stored copy would go stale against a catalog upgrade and restate what the installed entries already say.

**Leave resolution refusing and keep the live merge display-only.** Rejected: the surface would keep offering adoption the route cannot serve, and the refusal would name a field the catalog already answers.

**Infer the endpoint from the model id.** Rejected: ids carry no address facts; the siblings on the route do.

## Consequences

- An id adopted from an endpoint's live listing serves immediately on every provider whose models carry per-model endpoints, with no restated `baseURL`, and its requests reach the versioned API mount rather than the published prefix's 404 page.
- Catalog routes whose models all state no endpoint (the Azure family) refuse at the write that stores them when no route `baseURL` is configured, instead of storing a route whose requests target no host; the affected specs configure an endpoint.
- The endpoint derivation exists once; discovery's probe target and route resolution read one helper.

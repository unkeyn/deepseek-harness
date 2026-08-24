# Agent Note: One automatic model capability catalog plugin

Status: implemented

English | [中文](2026-08-18-automatic-model-capability-catalog.zh.md)

## Problem

A custom `llm-pi-ai` route often receives only model ids from an OpenAI-compatible `/models` endpoint. That endpoint does not report reasoning levels, image input, or capacities. The installed pi-ai catalog is keyed by its own provider ids, so a custom gateway route cannot inherit capabilities even when it serves a known model. The Settings page briefly exposed manual reasoning and input controls, making users restate model facts and allowing configuration to drift from the catalog.

## Decision

The base bundle mounts one Host plugin, `@deepseek-ai/dsh-model-catalog`, before `llm-pi-ai`. The plugin reads the generated `models.json` published by the MIT `@oh-my-pi/pi-catalog` dependency and provides one immutable `ctx.modelCatalog` service. It imports the generated data directly because the dependency's runtime modules require Bun, while Harness runs on Node.

`llm-pi-ai` reads the service optionally with `ctx.get('modelCatalog')` while materializing route models. A configured model entry still wins field by field; its installed pi-ai provider catalog is next; the external identity catalog fills missing reasoning, input, and capacity metadata; route defaults remain the final fallback. The route keeps its configured provider id, endpoint, API protocol, authentication, headers, and compatibility switches. Cross-provider reference lookup never copies provider-specific wire routing.

Exact model ids and their final slash-delimited segment are lookup keys. When several catalog providers publish the same id, the plugin chooses the entry with the most complete capability metadata: image modalities, reasoning, explicit effort tiers, then context capacity. The choice is deterministic and independent of configuration order.

The Models Settings UI edits model identity and optional capacities only. It does not author reasoning or input capabilities. Composer reasoning choices, image admission, and request validation all consume the same resolved LLM model metadata.

## Alternatives considered

- **Keep manual capability selectors** — rejected because model facts are not deployment preferences and would need maintenance for every catalog update.
- **Add model-specific or provider-specific rules in `llm-pi-ai`** — rejected because aliases and new models would continuously expand a hardcoded allowlist.
- **Import the full catalog runtime** — rejected because its environment module reads the Bun global during Node module initialization.
- **Copy the generated JSON into Harness** — rejected because it would create a second snapshot and unclear update ownership.
- **Copy cross-provider compatibility and routing metadata** — rejected because gateway wire behavior belongs to the configured route, not the upstream model identity.

## Consequences

A custom route can list `{ id: 'gpt-5.6-sol' }` and automatically expose image input plus the catalog's reasoning tiers. Explicit `input` and `reasoningEfforts` profile fields remain supported as corrective overrides for endpoints that differ from the reference catalog, but the product UI does not ask users to populate them.

The capability snapshot updates when `@oh-my-pi/pi-catalog` is upgraded. Endpoint discovery determines availability only; it cannot discover capabilities absent from the installed snapshot.

## Verification

- `packages/llm/llm-pi-ai/tests/catalog.spec.ts` proves automatic image and reasoning projection for a custom `gpt-5.6-sol` route.
- `packages/client/ui-settings-models/tests/provider-form.client.spec.tsx` proves the provider form writes no manual capability fields.
- `apps/web/tests/declared-reasoning.e2e.ts` proves assembled Composer capability behavior.
- `pnpm run build:lib:host` proves the plugin, service declarations, and consumer bundle together under Node.

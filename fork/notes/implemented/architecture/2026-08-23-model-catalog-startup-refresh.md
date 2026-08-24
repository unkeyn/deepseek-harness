# Agent Note: Model catalog startup refresh

Status: implemented

English | [中文](2026-08-23-model-catalog-startup-refresh.zh.md)

## Problem

The automatic model capability catalog served only the snapshot bundled inside the pinned `@oh-my-pi/pi-catalog` dependency. New models published upstream stayed invisible until the dependency was upgraded, so custom provider routes referencing fresh ids resolved without reasoning tiers, image admission, or capacities even though the generated database already described them.

## Decision

`@deepseek-ai/dsh-fork-model-catalog` performs one refresh per process start in `[Service.init]`, before consumers mount: fetch the catalog document, validate it, and replace the in-process lookup table built from the bundled snapshot. The default source is the upstream repository's generated file; `refreshUrl`, `refreshTimeoutMs` (whole-request deadline via abort signal), and `refresh: false` are validated config fields changeable from cordis.yml.

Validation refuses a whole document whose entries cannot each state their model id, rather than merging a partial one — a partial merge would look like a catalog that lost models. Reply size is bounded by a declared-content-length check plus an accumulated-read ceiling. Any failure (network, non-2xx, invalid document, oversized reply) logs a warning and keeps serving the bundled snapshot, so refresh quality never blocks activation or availability. Cordis awaits `[Service.init]` before applying the next plugin, so `llm-pi-ai` materializes routes after the swap completes.

## Alternatives considered

- **Periodic background refresh** — rejected because long-running host processes are rare here and a timer adds lifecycle and teardown complexity for marginal benefit.
- **Refresh on first consumer access** — rejected because lazy timing makes capability resolution racy across routes materializing at different moments.
- **Persist fetched catalogs to disk** — rejected because the bundled snapshot is already a durable fallback and a second on-disk copy recreates unclear update ownership.

## Consequences

Models published upstream become visible on the next process start without a dependency upgrade. Mid-run publications appear at the next start. Hosts that must not touch the network set `refresh: false` and keep today's behavior exactly.

The lookup-table swap is the only mutation of catalog state; requests are still never modified, and the KV-cache profile of LLM traffic is unchanged.

## Verification

- `packages/llm/model-catalog/tests/catalog.spec.ts` proves the swap-before-consumers ordering, fallback on unreachable/refused/invalid/oversized replies, custom URL and deadline wiring, and full offline skip under `refresh: false`.
- `pnpm run typecheck && pnpm run build:lib:host && pnpm run test` pass on the fork.

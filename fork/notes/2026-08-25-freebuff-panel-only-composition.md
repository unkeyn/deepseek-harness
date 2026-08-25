# Agent Note: Freebuff stays panel-only in the fork composition

Status: implemented

## Problem

The fork mounted the full Freebuff family: the OAuth panel with its credential service and RPC bridge, the `llm-freebuff` provider route, and the `/freebuff-login` command. The panel is the surface the owner wants to grow into a multi-service hub, so the provider-specific model route and the duplicate login command should not be part of the default composition.

## Decision

`fork/bundle/cordis.patch.yml` keeps only the panel-facing rows: `credential-freebuff-oauth`, `freebuff-rpc`, and `ui-freebuff-oauth`. The `llm-freebuff` and `command-freebuff-login` rows are removed, and the bundle no longer depends on the two packages. The packages stay in the fork workspace with their tests and tsconfig references intact, so remounting is a patch-row insert; the patch comment names the ids.

## Consequences

The `freebuff` provider disappears from the model picker and `/freebuff-login` is gone; the OAuth tab keeps handling device login, logout, account state, and the desktop launcher button through `freebuff.status` and the related RPC methods. Future services added to the panel reuse the same bridge pattern: a `freebuff-rpc`-style prefix route plus an `IApiClient` face over the shared Connection transport.

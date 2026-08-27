# Agent Note: Custom Bearer routes refresh provider-owned tokens

Status: implemented

English | [中文](2026-08-26-custom-bearer-routes.zh.md)

## Problem

The Models page could hand-declare only API-key routes in `llm-pi-ai`. An expiring Firebase ID token needs explicit Bearer authorization, a matching refresh token, durable rotation, and a transport that does not expose secret values through settings. TwinMind also uses `POST /api/v3/chat` with a consumer-specific request and SSE vocabulary rather than an OpenAI-compatible protocol.

Mixing both credential families into `llm-pi-ai` would make one plugin own unrelated configuration and lifecycle rules. Browser code also cannot read TwinMind's cookies directly because they are cross-origin and `HttpOnly`, although users can export those cookies themselves.

## Decision

Bearer routes belong to the separate `@deepseek-ai/dsh-llm-bearer` Cordis plugin and `llm-bearer` settings namespace. `llm-pi-ai` remains API-key-only. A Bearer profile names write-only access and refresh credential references plus non-secret Firebase configuration. The resolver derives expiry from a JWT, shares concurrent refresh for one route, prefers Firebase's returned `id_token`, persists a rotated refresh token before the new ID token, and dispatches only after both writes succeed. A new process reads the persisted values without relying on in-memory state.

Models exposes **Add a Bearer provider** beside **Add a custom provider**. The former writes `llm-bearer`; the latter keeps its existing `llm-pi-ai` API-key behavior. The Bearer card can parse a pasted cookie-export array locally, accepting only exact `session` and `firebase_refresh_token` cookies for `app.twinmind.com`, ignoring analytics entries, copying the two values into write-only drafts, and clearing the raw JSON field immediately. It does not attempt cross-origin cookie access.

The first transport is `twinmind-chat`. It sends `POST /api/v3/chat` with `Authorization: Bearer`, maps TwinMind text and thinking SSE events to Harness blocks, stores the returned provider session id as replay metadata, and treats provider-side tool events as progress rather than Harness tool calls. Discovery reads the official web client's `GET /api/v3/chat/models` response. TwinMind expresses thinking as distinct model ids rather than a reasoning-effort request field, so the adapter advertises model switching but no reasoning-level selector. The other supplied TwinMind endpoints are product features and remain outside model dispatch.

## Alternatives considered

**Store `Authorization: Bearer …` in profile headers.** `headers` is ordinary settings data returned by redacted descriptions, and it has no refresh owner.

**Add a Bearer selector to `llm-pi-ai`.** This keeps one button but couples API-key SDK routes to Firebase rotation and TwinMind's consumer transport. Separate namespaces make route ownership and editing behavior explicit.

**Read TwinMind cookies automatically.** A page cannot read another origin's `HttpOnly` cookies. A local parser for an explicit export provides the same field extraction without browser-permission workarounds or raw-export persistence.

**Expose chat, memory, todo, and personalization as one provider.** Only chat is needed for model dispatch. The other endpoints need separate tool request, result, and authority decisions.

## Consequences

- API-key custom routes preserve their previous settings and credential behavior.
- Bearer access and refresh values never enter settings, descriptors, diagnostics, session events, snapshots, or cookie-import state after parsing.
- Firebase rotation is concurrent-safe and durable across new processes and sessions.
- TwinMind uses the owned chat and model-directory endpoints and can switch among advertised model ids.
- Missing, expired, or unwritable credentials fail before provider dispatch with credential-specific errors.

## Limitations

The plugin refreshes credentials but does not perform Firebase sign-in, logout, revocation, or account selection. Automatic refresh cannot be built from an ID token alone; it requires the matching refresh token and a writable credential service.

TwinMind owns its server-side conversation and tools. The observed consumer endpoint does not accept Harness tool schemas or provider-neutral history, so this route provides text and reasoning but not local Harness tool calls or exact request replay.

## Testing

`packages/llm/llm-bearer/tests/bearer.spec.ts` covers static and expiring tokens, concurrent Firebase refresh, rotated credential persistence, fresh-process reuse, and refresh failures. `packages/llm/llm-bearer/tests/adapter.spec.ts` covers the TwinMind request, Bearer header, content carried by SSE start events, replay state, and provider-side tool progress. `packages/llm/llm-bearer/tests/discovery.spec.ts` covers the authenticated model directory and provider-section flattening; `loader-composition.spec.ts` covers dormant and settings-driven route registration. UI tests cover the separate action, API-key isolation, local cookie parsing, two credential writes, and raw-input clearing. The headless snapshot covers an assembled keyless TwinMind Bearer route. A live test with an explicitly supplied cookie export forced Firebase rotation, reused its persisted values through a fresh resolver, discovered 13 models, resumed an `auto` chat, switched to an explicit model, and received reasoning plus text from a thinking model.

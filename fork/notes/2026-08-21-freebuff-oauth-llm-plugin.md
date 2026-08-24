# Agent Note: Freebuff OAuth and free-model LLM plugins

Status: implemented

English | [中文](2026-08-21-freebuff-oauth-llm-plugin.zh.md)

## Problem

Freebuff's free models require device-code login, a bearer token, server-side session admission, and Freebuff-specific request metadata. Adding those concerns to official provider packages would make the official repository depend on a service that is optional to the harness and would prevent a byte-identical official checkout from remaining independently usable.

## Decision

The fork owns three runtime plugins: `@deepseek-ai/dsh-fork-credential-freebuff-oauth` provides `ctx.freebuffOAuth`, `@deepseek-ai/dsh-fork-command-freebuff` exposes the interactive login command, and `@deepseek-ai/dsh-fork-llm-freebuff` registers the `freebuff` route. The OAuth provider requests `/api/auth/cli/code`, polls `/api/auth/cli/status`, stores the returned bearer token through `ctx.credentials` under a stable credential reference, and restores it after restart. Freebuff does not provide a refresh-token exchange; a provider-side `401` removes the local credential and account snapshot, so rejected credentials require a new device login.

The separate `@deepseek-ai/dsh-fork-command-freebuff` plugin exposes `/freebuff-login` and `/freebuff-login wait`, so an interactive user can approve the device URL and persist the token without calling the service programmatically.

The LLM plugin uses the current Freebuff picker catalog, admits one session for the requested model, sends `x-freebuff-model`, `x-freebuff-instance-id`, `codebuff_metadata.cost_mode = "free"`, and the instance id, and releases the session during plugin disposal. It translates the OpenAI-compatible SSE stream through the existing DeepSeek serializer and translator, including reasoning, tool calls, images, usage, and compaction-session metadata. Session-ending chat gates re-admit once; concurrent admissions are serialized without allowing a pending admission for one model to service another model's request.

The fork Host API proxy keeps OAuth secrets on the Host and exposes only redacted account metadata through `freebuff.status` and the related login methods. It also provides `freebuff.openDesktop`: the Host resolves the absolute `desktopShortcutPath` from the credential plugin configuration and invokes the native path opener, while the browser sends no filesystem path. The Windows default is `C:\Users\<user>\OneDrive\Desktop\DeepSeek Harness Desktop.lnk`; other platforms use the matching `<home>/Desktop` location. The fork client plugin registers the `OAuth` tab under `settings.plugins.tab`; it opens the device URL, waits for approval through the Host, provides refresh and disconnect actions, and exposes `Open Harness Desktop` without adding a browser token store.

The OAuth provider follows Freebuff's CLI fingerprint protocol: it derives a process-cached `enhanced-` SHA-256 identifier from local machine data, uses the official `codebuff-cli-` random fallback when enhanced collection fails, and reuses the server's `fingerprintHash` and exact `expiresAt` value during polling. It does not rotate or spoof fingerprints, and Freebuff remains responsible for accepting accounts and sessions.

`fork/bundle/cordis.patch.yml` disables each replaced official Loader row and inserts a fork row with a distinct id. The official rows remain available for later patch layers to restore, while the Freebuff-only rows are mounted beside the fork's other capabilities.

## Alternatives considered

**Modify the official provider packages.** Rejected because the official repository must remain usable without Freebuff and byte-identical to the upstream checkout; the overlay is the composition point for fork behavior.

**Treat the Freebuff bearer token as an ordinary API-key setting.** Rejected because device-code login, token persistence, redacted account metadata, and reauthentication are provider-owned OAuth behavior; putting the token in settings would expose a secret through configuration surfaces.

**Skip session admission and send only the chat request.** Rejected because Freebuff's free mode requires a live server-side instance and rejects requests without the matching model and instance headers.

**Add a refresh-token compatibility layer.** Rejected because the Freebuff device flow returns an access token without refresh credentials; a fabricated refresh path would hide the required re-login behavior.

## Consequences

Freebuff is enabled by mounting the fork overlay and composing the credentials service before the OAuth provider and LLM route. The official tree remains a separate source plane; the fork build and lockfile are the only fork-specific package-manager artifacts. Users must complete browser approval once per rejected or expired token, and session capacity or model availability remains controlled by Freebuff's server response. The LLM route invalidates local OAuth state on `401` from either session admission or chat, while other Freebuff session gates retain their existing recovery behavior.

Focused OAuth, lifecycle, SSE, tool-call, session-recovery, concurrency, composition, Host RPC, desktop-launcher, and client UI tests cover the provider. Host and client TypeScript projects and the fork library build pass.

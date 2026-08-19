# Agent Note: OAuth requests use provider-owned adapter semantics

English | [中文](2026-03-08-oauth-provider-request-adapter.zh.md)

Status: implemented

## Problem

`OAuthLifecycle` owns credential references and refresh state, but a consumer also needs to execute provider requests without resolving tokens itself. Passing that responsibility to consumers duplicates refresh handling and makes provider authorization formats part of the shared lifecycle.

## Decision

`@deepseek-ai/dsh-credential-oauth` exports `ProviderOAuthAdapter<Request, Authorization, Response>` and `OAuthLifecycle.adapter()`. The lifecycle resolves the current access token before calling provider `authorization()` or `request()` methods. Providers retain ownership of authorization headers, request encoding, and response handling. `ClaudeCodeOAuthProvider` models browser callback and setup-token login through injected transport functions; it contains no undocumented endpoint URLs. Refresh and revocation remain provider-owned, and unavailable operations raise `OAuthUnsupportedOperationError`. Refresh rejection propagates as `OAuthReauthenticationRequired` before the provider request runs. Account snapshots continue to contain references and status only.

`FakeOAuthProvider` implements deterministic authorization and request behavior for tests, including observable token handoff and revocation calls. It is not a production provider.

## Alternatives considered

**Expose `accessToken()` to every consumer:** This would require each consumer to coordinate expiry, refresh failures, and provider request construction, making reauthentication behavior inconsistent.

**Define universal authorization and request fields:** OAuth providers do not share wire formats. A universal request type would either exclude provider-specific semantics or leak them into the lifecycle package.

## Consequences

Provider adapters can share one access-token lifecycle while retaining provider-specific request behavior. Authorization outputs and request calls may contain secrets during one provider operation, but snapshots, account metadata, and diagnostics remain value-free. Consumers must use the lifecycle adapter for request execution to receive refresh and reauthentication behavior.

## Testing

Package tests cover direct access-token handoff through authorization and request calls, callback and setup-token login, provider refresh, unsupported revocation, reauthentication propagation before a request, redacted snapshots, and local cleanup.

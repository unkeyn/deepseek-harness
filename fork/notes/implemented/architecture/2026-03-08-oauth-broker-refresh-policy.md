# Agent Note: OAuth broker refresh policy owns generation-safe sweeps

English | [中文](2026-03-08-oauth-broker-refresh-policy.zh.md)

Status: implemented

## Problem

OAuth consumers need one refresh owner for foreground requests and background expiry sweeps. A definitive refresh failure must request reauthentication without allowing a stale refresh result to disable an account that was replaced by a newer login. Provider account pools also need filtering without exposing token values or inventing provider endpoints.

## Decision

`OAuthLifecycle` keeps one in-flight refresh promise per account and exposes `refreshDue()` for skew-based sweeps. `OAuthRefreshScheduler` owns the interval and is intended to be attached to the surrounding Cordis fiber's disposer. Every redacted account snapshot carries a monotonic generation. Refresh failure changes the account to `reauthenticate` only when the generation observed at refresh start is still current; a newer login wins the compare-and-set. Definitive failures include invalid grants, revoked or unauthorized credentials, and bare 401 responses; transient failures remain retryable. `filterOAuthAccounts()` applies a provider-scoped identity set when a consumer has an account-pool policy. The durable pool broker also requires a pool's provider to match the request provider before leasing its metadata.

## Alternatives considered

**Let each consumer refresh independently:** Rejected because concurrent model requests and scheduled work would duplicate provider calls and could publish conflicting account state.

**Disable by account id without a generation check:** Rejected because a slow refresh from an old login could overwrite a newer login's active state.

**Add provider HTTP endpoints to the OAuth package:** Rejected because callback, token exchange, refresh, and revocation wire semantics belong to injected provider transports and must remain documented by their providers.

## Consequences

Foreground requests and scheduled sweeps share refresh ownership, while scheduler disposal can quiesce future timer work. Snapshots expose generation and status but never access or refresh token values. A definitive failure from an obsolete generation cannot disable the replacement account. Account-pool filtering is available only where the caller has a provider identity policy; absent policy remains unrestricted. Refresh schedule defaults are code-level protocol defaults and can be overridden by scheduler options.

## Testing

Package tests cover skew-triggered refresh, generation-tagged redaction, provider account-pool filtering, single-flight refresh, definitive reauthentication, and stale failure protection. The pool broker provider match is enforced in its candidate selection path.

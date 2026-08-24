# Agent Note: Remote OAuth projections remain redacted and read-only

English | [中文](2026-03-08-remote-oauth-projection.zh.md)

Status: implemented

## Problem

Remote OAuth consumers need current broker metadata for provider account selection without receiving token values or gaining authority to mutate broker-owned credentials. A delayed snapshot must not replace newer account-pool state.

## Decision

`RemoteOAuthCredentialStore` consumes a generation-tagged broker snapshot source and replaces its detached projection only for a strictly newer generation. It accepts the broker's full snapshot, entry replacement, and removal events, applying them immediately through one subscription that is released by `dispose()`. The projection contains credential references, provider identity, authentication kind, and optional OAuth account identity; it never contains token values. Provider account pools filter OAuth rows for the selected provider, while API-key rows remain retained because the pool describes OAuth identities. `resolve()` returns `undefined`; `set()` and `unset()` reject with `OAUTH_REMOTE_STORE_READ_ONLY`.

## Alternatives considered

**Give the remote consumer a writable credential store:** Rejected because remote metadata must not gain ownership of broker mutations or secret storage.

**Filter every credential kind through the OAuth account pool:** Rejected because API-key credentials are not OAuth identities and would disappear from a mixed provider projection.

**Accept equal or older generations:** Rejected because delayed broker snapshots could roll back current account visibility.

## Consequences

The remote projection is suitable for detached diagnostics and account selection, but it cannot execute provider requests or supply token values. The broker-side credential provider remains the only token-resolution and mutation owner. Source snapshots are copied on replacement and on reads, so caller mutations cannot alter published projection state.

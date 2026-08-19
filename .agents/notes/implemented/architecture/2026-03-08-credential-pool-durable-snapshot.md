# Agent Note: Pool metadata uses one durable snapshot

English | [中文](2026-03-08-credential-pool-durable-snapshot.zh.md)

Status: implemented

## Problem

Pool selection needs durable operational metadata, but secret values belong to the existing credential provider. Separate writes for pool ownership and credential entries could leave an entry without its owner after a partial failure or restart.

## Decision

`@deepseek-ai/dsh-credential-pool-store` stores versioned pool and credential metadata in the `global` slot of one KV unit. Each mutation validates the complete detached snapshot, serializes mutations through one operation chain, publishes it with the selected storage backend, and updates the in-memory snapshot only after durability succeeds. The snapshot contains pool/provider identity, credential references, auth kind, priority, concurrency limit, enabled state, and non-secret health state: cooldown deadlines, quarantine and reauthentication reasons, model exclusions, failure summaries, and success timestamps. Secret values are never stored. Monotonic snapshot generation and per-credential generation provide broker-owned id-based CAS tokens. Health, enabled, reauthentication, and removal mutations reject stale tokens with `CREDENTIAL_POOL_STALE_WRITER`; they do not resolve or write secrets. `PoolCredentialBroker.completeWithHealth` consumes each lease once and maps provider health dispositions to these CAS mutations, so stale health writes cannot be retried through the released lease.

## Alternatives considered

**Separate KV records for pools and entries:** Per-record durability would require a recovery protocol to prevent orphan entries and partially committed ownership changes.

**Store secrets with pool metadata:** This would bypass `ctx.credentials`, duplicate secret storage, and make operational snapshots unsafe to render or synchronize.

**In-memory metadata:** Restart would lose cooldown and pool configuration, violating the roadmap recovery requirement and preventing a stable operational view.

## Consequences

The initial store is compact and atomic for JSON and SQLite KV backends, with schema version `3`. Pool selection excludes credentials in an active cooldown or with an exclusion for the requested model. `PoolCredentialBroker` publishes a newer redacted broker snapshot after each successful health disposition mutation, allowing remote OAuth projections to track durable generation changes while keeping token values local; those projections own and dispose their broker subscription. Cross-process locking and large-pool pagination remain responsibilities of the selected backend or a later store format. Health policy providers own classification and state mutation; OAuth refresh state and proxy bindings remain separate slices. CAS mutation tests cover competing writers, explicit stale errors, and restart persistence.

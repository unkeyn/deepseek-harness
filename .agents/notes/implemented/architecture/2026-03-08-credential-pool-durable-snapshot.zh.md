# Agent Note: Pool metadata uses one durable snapshot

[English](2026-03-08-credential-pool-durable-snapshot.md) | 中文

Status: implemented

## Problem

Pool selection needs durable operational metadata, but secret values belong to the existing credential provider. Separate writes for pool ownership and credential entries could leave an entry without its owner after a partial failure or restart.

## Decision

`@deepseek-ai/dsh-credential-pool-store` хранит versioned pool и credential metadata в `global` slot одного KV unit. Каждая mutation проверяет полный detached snapshot, сериализуется одной operation chain, публикуется выбранным storage backend и только после durability обновляет in-memory snapshot. Snapshot содержит pool/provider identity, credential references, auth kind, priority, concurrency limit, enabled state и non-secret health state: cooldown deadlines, quarantine и reauthentication reasons, model exclusions, failure summaries и success timestamps. Secret values не сохраняются. Monotonic snapshot generation и per-credential generation образуют broker-owned id-based CAS tokens. Health, enabled, reauthentication и removal mutations отклоняют stale tokens с `CREDENTIAL_POOL_STALE_WRITER` и не разрешают и не записывают secrets. `PoolCredentialBroker.completeWithHealth` завершает каждый lease ровно один раз и переводит provider health dispositions в эти CAS mutations, поэтому stale health writes нельзя повторить через уже освобождённый lease.

## Alternatives considered

**Отдельные KV records для pools и entries:** Per-record durability потребовала бы recovery protocol для предотвращения orphan entries и частично committed ownership changes.

**Хранить secrets вместе с pool metadata:** Это обошло бы `ctx.credentials`, создало бы дублирование secret storage и сделало бы operational snapshots небезопасными для UI и sync.

**In-memory metadata:** Restart терял бы pool configuration и operational state, нарушая требование roadmap по recovery.

## Consequences

Начальный store компактен и атомарен для JSON и SQLite KV backends, schema version равен `3`. Pool broker исключает credentials в активном cooldown или с exclusion для запрошенной model. `PoolCredentialBroker` публикует новый redacted broker snapshot после каждой успешной health disposition mutation, поэтому remote OAuth projections видят изменения durable generation и сохраняют token values локальными; projections владеют своими broker subscriptions и освобождают их через `dispose`. Cross-process locking и pagination больших pools остаются ответственностью backend или будущего store format. Health policy providers владеют classification и state mutation; OAuth refresh state и proxy bindings относятся к отдельным slices. CAS tests покрывают competing writers, явные stale errors и restart persistence.

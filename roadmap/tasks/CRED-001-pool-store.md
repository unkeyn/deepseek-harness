# CRED-001: Pool metadata and credential storage

Status: in-progress

Owner: Codex

Contributors: —

Milestone: M1

Dependencies: ARCH-001

Agent Note: [credential pool durable snapshot](../../.agents/notes/implemented/architecture/2026-03-08-credential-pool-durable-snapshot.md)

Completion record: —

## Цель

Добавить provider-neutral pool store, который хранит секреты через credential provider, а operational metadata — в отдельном durable store.

## Scope

- CRUD для pools и entries.
- User priority, enabled state, auth kind и provider route.
- Durable cooldown, quarantine, model exclusions и health summary.
- Atomic writes, cross-process coordination и restart recovery.
- Migration-ready versioning.
- Поддержка local credential provider и будущего OS-bound provider.

## Не входит

- Автоматический импорт из OMP или FreeLLMAPI.
- Reveal API для секретов.
- Проверка provider credentials.

## Acceptance criteria

- Одинаковый secret reference не дублируется в одном pool.
- Удаление metadata не оставляет page-owned secret без явного retention decision.
- Partial write не создаёт entry без secret reference или secret без owner metadata.
- Store восстанавливается после restart и отклоняет повреждённый format без тихой потери entries.
- UI projection использует configured state и credential references существующего Host API.

## Verification

- Persistence, atomicity, concurrent writer и restart tests.
- Local credential provider integration test.
- Host-to-Client projection test.

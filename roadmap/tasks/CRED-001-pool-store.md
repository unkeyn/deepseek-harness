# CRED-001: Secure pool metadata and secret storage

Status: planned

Owner: unassigned

Contributors: —

Milestone: M1

Dependencies: ARCH-001

Agent Note: required before implementation

Completion record: —

## Цель

Добавить provider-neutral pool store, который хранит секреты через credential provider, а operational metadata — в отдельном durable store.

## Scope

- CRUD для pools и entries.
- User priority, enabled state, auth kind и provider route.
- Durable cooldown, quarantine, model exclusions и safe health summary.
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
- Client-safe projection не содержит credential value, token fragment или proxy password.

## Verification

- Persistence, atomicity, concurrent writer и restart tests.
- Local credential provider integration test.
- Redaction snapshot для Host-to-Client projection.

## Security and privacy

Plaintext metadata не содержит секретов. Export/import не входит в первый slice и не добавляется без отдельной threat model.

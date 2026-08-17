# CATALOG-001: Credential-aware provider/model discovery

Status: planned

Owner: unassigned

Contributors: —

Milestone: M3

Dependencies: ROUTE-001

Agent Note: required before implementation

Completion record: —

## Цель

Показывать модели из provider-owned catalog/discovery только тогда, когда маршрут может выполнить запрос с доступным credential или native authentication.

## Scope

- Integration с `ctx.llm` model listing и discovery.
- Объединение installed catalog и endpoint discovery без второго registry.
- Credential availability и model exclusions.
- Refresh после pool, OAuth или provider configuration changes.
- Stable provider/model identity для сохранённых сессий.

## Не входит

- Ручной Desktop allowlist.
- Предположение о model capability только по имени.
- Автоматическое включение всех provider routes из installed catalog.

## Acceptance criteria

- Provider без eligible credentials не выдаёт кликабельные модели, кроме документированной native auth readiness.
- Model exclusions применяются к конкретному credential или pool, не удаляя model metadata из installed catalog.
- Discovery failure сохраняет last known catalog с явным stale state или возвращает точный error; пустой ответ не считается успешным refresh.
- Один model id у разных provider routes остаётся различимым.
- Смена pool state обновляет model surface без restart.

## Verification

- Catalog provider, custom endpoint и OAuth-only route tests.
- Discovery 401, timeout, malformed response и empty catalog tests.
- Client projection test без secret-dependent fields.

## Security and privacy

Discovery получает только lease выбранного provider route и не отправляет credentials посторонним catalog services.

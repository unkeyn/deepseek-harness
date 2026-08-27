# BEARER-002: Separate Bearer provider plugin and cookie import

Status: done

Owner: Codex

Contributors: —

Milestone: M4

Dependencies: BEARER-001

Agent Note: [Custom Bearer routes refresh provider-owned tokens](../../.agents/notes/implemented/feature/2026-08-26-custom-bearer-routes.md)

Completion record: [2026-08-27-BEARER-002-separate-provider-plugin](../done/2026-08-27-BEARER-002-separate-provider-plugin.md)

## Цель

Отделить Bearer/Firebase/TwinMind от API-key провайдера и позволить безопасно заполнить access/refresh credentials из явного TwinMind cookie export.

## Scope

- Отдельные пакет `llm-bearer`, settings namespace и Models action.
- TwinMind chat SSE и durable Firebase refresh в новом пакете.
- Локальный импорт точных `session` и `firebase_refresh_token` cookie без сохранения raw JSON.
- API-key-only поведение `llm-pi-ai`.

## Не входит

- Автоматическое чтение cross-origin `HttpOnly` cookie.
- Firebase login/logout/revocation и TwinMind product endpoints как Harness tools.

## Acceptance criteria

- **Add a custom provider** создаёт API-key route в `llm-pi-ai`, а соседняя **Add a Bearer provider** создаёт Bearer route в `llm-bearer`.
- Cookie export извлекает только два точных TwinMind credential и сразу очищает raw input.
- Rotated Firebase credentials сохраняются и читаются новым процессом до model dispatch.
- TwinMind использует `GET /api/v3/chat/models` и `POST /api/v3/chat`, а выбранный model id корректно доходит до provider.

## Verification

- Полные package tests для `llm-bearer`, `llm-pi-ai` и Models UI.
- TypeScript programs, focused lint, assembled headless snapshot, documentation and translation gates.
- Workspace secret-prefix scan and `git diff --check`.

## Open questions

- none.

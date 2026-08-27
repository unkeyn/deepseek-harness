# BEARER-002: Separate Bearer provider plugin and cookie import

Completed: 2026-08-27

Owner: Codex

Contributors: —

Task: `roadmap/tasks/BEARER-002-separate-provider-plugin.md`

Pull request: —

Agent Note: [Custom Bearer routes refresh provider-owned tokens](../../.agents/notes/implemented/feature/2026-08-26-custom-bearer-routes.md)

## Результат

Bearer/Firebase/TwinMind вынесены из `llm-pi-ai` в отдельный `llm-bearer` plugin и settings namespace. Models UI показывает соседнюю кнопку **Add Bearer provider**, локально импортирует две точные TwinMind cookie, сохраняет access/refresh раздельно и очищает raw export. Плагин обновляет Firebase token до запроса, сохраняет rotation для нового процесса, читает реальный каталог TwinMind и поддерживает `auto`, явные модели, thinking-модели и provider session replay.

## Контракты и решения

- [Agent Note](../../.agents/notes/implemented/feature/2026-08-26-custom-bearer-routes.md) закрепляет отдельное ownership Bearer routes, локальный cookie import и Firebase rotation.
- Model path использует `GET /api/v3/chat/models` и `POST /api/v3/chat`; остальные переданные TwinMind endpoints не нужны для LLM dispatch.
- TwinMind выражает thinking отдельными model ids, а не reasoning-effort parameter; thinking SSE всё равно становится Harness reasoning block.
- User secrets не входят в settings, diagnostics, snapshots, repository files или временные scripts.

## Verification

| Проверка | Результат |
|---|---|
| `tsc` для `llm-bearer`, `llm-pi-ai` и Models UI | passed |
| `vitest run packages/llm/llm-bearer/tests` | passed: 7 tests |
| `vitest run packages/llm/llm-pi-ai/tests` | passed: 254 tests |
| `vitest run packages/client/ui-settings-models/tests` | passed: 228 tests |
| Focused Oxlint для всех изменённых TypeScript/TSX файлов | passed |
| Headless snapshot `streams the custom TwinMind Bearer route` | passed |
| Translation pairing для пяти изменённых bilingual pairs | recorded and passed |
| Live test с предоставленным cookie export | passed: import, forced Firebase refresh, fresh-resolver reuse, 13 discovered models, `auto` response, resumed session, explicit model response |
| Live `gemini-3.7-flash-thinking` after SSE-start fix | passed: reasoning block and final text |
| Workspace secret-prefix scan and temporary-script check | passed |
| `git diff --check` | passed |

Глобальные config-catalog, README и export-JSDoc gates остаются красными на уже присутствующей credential-broker и другой незавершённой работе. Проверка export JSDoc для файлов `llm-bearer` и Models UI не нашла нарушений; package README gates также не перечислили новый пакет.

## Ограничения

- Браузер не может автоматически прочитать cross-origin `HttpOnly` cookie; пользователь явно вставляет export, который разбирается только в памяти страницы.
- Firebase sign-in/logout/revocation остаются вне плагина.
- TwinMind minimum tier виден в собственном UI, но текущий общий Harness discovery contract не переносит tier badge; недоступность конкретной модели остаётся ответом provider.

## Follow-ups

- none.

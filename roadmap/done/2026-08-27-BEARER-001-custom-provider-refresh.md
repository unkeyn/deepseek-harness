# BEARER-001: Custom Bearer provider refresh and TwinMind chat

Completed: 2026-08-27

Owner: Codex

Contributors: —

Task: `roadmap/tasks/BEARER-001-custom-provider-refresh.md`

Pull request: —

Agent Note: [Custom Bearer routes refresh provider-owned tokens](../../.agents/notes/implemented/feature/2026-08-26-custom-bearer-routes.md)

## Результат

Custom provider в Models UI выбирает API key или Bearer. Bearer secret хранится отдельно от settings, а Firebase ID token при наличии matching `refresh_token` обновляется до model dispatch, сохраняет rotated credentials и продолжает работать в новом процессе. Новый `twinmind-chat` provider использует TwinMind chat SSE и model directory без OpenAI-compatible предположений.

## Контракты и решения

- [Agent Note](../../.agents/notes/implemented/feature/2026-08-26-custom-bearer-routes.md) закрепляет discriminated Bearer profile, provider-owned Firebase refresh и TwinMind wire protocol.
- `POST /api/v3/chat` и `GET /api/v3/chat/models` принадлежат model route. Остальные TwinMind product endpoints не входят в provider configuration.
- Access и refresh token остаются write-only credentials; settings, diagnostics, session output и snapshots не содержат secret values.

## Verification

| Проверка | Результат |
|---|---|
| `pnpm exec vitest run packages/llm/llm-pi-ai/tests` | passed: 265 tests |
| `pnpm exec vitest run packages/client/ui-settings-models/tests` | passed: 225 tests |
| `pnpm exec tsc -p packages/llm/llm-pi-ai/tsconfig.json --noEmit` | passed |
| `pnpm exec tsc -p packages/client/ui-settings-models/tsconfig.json --noEmit` | passed |
| Focused Oxlint over every changed TypeScript/TSX file | passed |
| `pnpm exec vitest run --config vitest.snapshot.config.ts -t "streams the custom TwinMind Bearer route"` | passed: assembled keyless new-session request and SSE response |
| Translation pairing for the four changed bilingual documents | passed |
| Live TwinMind `POST /api/v3/chat` with the supplied temporary ID token | HTTP 200 and complete SSE response; one test chat created |
| Secret-prefix scan of the workspace | passed: supplied JWT not found |
| `git diff --check` | passed |
| `pnpm run doc-sync` | 17 gates passed; 11 failed on unrelated credential-broker/docs work and a Windows symlink permission test |
| `pnpm run lint` | build passed; corpus lint failed on unrelated generated artifacts, fork configs, and existing credential work; focused changed-file lint passed after corrections |

## Ограничения

- Автообновление невозможно по одному Firebase ID token: пользователь должен сохранить matching `refresh_token` из login flow.
- TwinMind выполняет собственные server-side tools; consumer chat endpoint не предоставляет Harness-executable tool schema.

## Follow-ups

- none.

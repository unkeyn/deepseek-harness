# BEARER-001: Custom Bearer provider refresh and TwinMind chat

Status: done

Owner: Codex

Contributors: —

Milestone: M4

Dependencies: —

Agent Note: [Custom Bearer routes refresh provider-owned tokens](../../.agents/notes/implemented/feature/2026-08-26-custom-bearer-routes.md)

Completion record: [2026-08-27-BEARER-001-custom-provider-refresh](../done/2026-08-27-BEARER-001-custom-provider-refresh.md)

## Цель

Позволить custom provider route выбирать Bearer credential, безопасно обновлять Firebase ID token и использовать TwinMind consumer chat protocol в новых сессиях.

## Scope

- Bearer access/refresh credential references в `llm-pi-ai` profile.
- Proactive Firebase Secure Token refresh с durable rotation и concurrent deduplication.
- Models UI для API key/Bearer выбора и отдельного refresh token.
- `twinmind-chat` request/SSE protocol и model discovery.

## Не входит

- Универсальный OAuth login, logout, revocation или multi-account broker.
- TwinMind memory, todo, personalization и другие product endpoints как Harness tools.

## Acceptance criteria

- Custom provider создаётся с API key или Bearer без secret в settings.
- Expiring Firebase token обновляется один раз при concurrent requests, а rotated values сохраняются до model dispatch.
- TwinMind route использует `/api/v3/chat`, продолжает provider session и переводит SSE text/thinking.
- Missing/dead refresh token завершается credential-specific failure до provider request.
- API-key routes сохраняют прежнее поведение.

## Verification

- Focused `llm-pi-ai` Bearer, TwinMind, discovery and config tests.
- `llm-pi-ai` and Models UI TypeScript programs.
- Documentation and translation-pair gates.

## Open questions

- none.

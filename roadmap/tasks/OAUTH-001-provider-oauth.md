# OAUTH-001: OAuth account lifecycle

Status: planned

Owner: unassigned

Contributors: —

Milestone: M4

Dependencies: ROUTE-001

Agent Note: required before implementation

Completion record: —

## Цель

Подключить OAuth provider adapters через общий broker, сохранив provider-specific login, refresh и revocation semantics и поддержку нескольких аккаунтов.

## Scope

- Browser callback и headless/device flow там, где их поддерживает provider.
- Access/refresh token storage через существующий credential provider.
- Proactive refresh перед expiry.
- Account pool и reauthentication state.
- Dynamic model catalog после sign-in/sign-out.
- Logout и provider-side revocation guidance.

## Не входит

- Универсальный OAuth parser для несовместимых providers.

## Acceptance criteria

- Concurrent refresh одного account дедуплицируется.
- Dead refresh token переводит account в `reauthenticate`, а не запускает бесконечный retry.
- Logout удаляет локальный credential и объясняет отдельную provider-side revocation.
- Неавторизованный route не показывает модели как доступные.

## Verification

- Keyless OAuth state-machine tests с fake provider.
- Callback CSRF/state, timeout и cancellation tests.
- Refresh race and restart tests.
- Опциональный real-account e2e.

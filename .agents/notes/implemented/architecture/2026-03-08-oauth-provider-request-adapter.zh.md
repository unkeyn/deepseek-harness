# Agent Note: OAuth requests use provider-owned adapter semantics

[English](2026-03-08-oauth-provider-request-adapter.md) | 中文

Status: implemented

## Problem

`OAuthLifecycle` владеет ссылками на credentials и состоянием refresh, но потребителю также нужно выполнять provider-запросы, не разрешая token самостоятельно. Передача этой ответственности потребителям дублирует обработку refresh и делает форматы авторизации provider частью общего lifecycle.

## Decision

`@deepseek-ai/dsh-credential-oauth` экспортирует `ProviderOAuthAdapter<Request, Authorization, Response>` и `OAuthLifecycle.adapter()`. Lifecycle разрешает текущий access token перед вызовом методов provider `authorization()` или `request()`. Providers сохраняют владение заголовками авторизации, кодированием запроса и обработкой ответа. `ClaudeCodeOAuthProvider` моделирует browser callback и setup-token login через injected transport functions; он не содержит undocumented endpoint URLs. Refresh и revocation остаются provider-owned, а недоступные операции выбрасывают `OAuthUnsupportedOperationError`. Отклонённый refresh передаётся как `OAuthReauthenticationRequired` до выполнения provider-запроса. Снимки аккаунтов по-прежнему содержат только ссылки и status.

`FakeOAuthProvider` предоставляет детерминированные authorization и request semantics для тестов, включая наблюдаемый handoff token и вызовы revoke. Это не production provider.

## Alternatives considered

**Expose `accessToken()` каждому потребителю:** Это заставило бы каждый потребитель координировать expiry, ошибки refresh и построение provider-запросов, из-за чего поведение reauthentication стало бы непоследовательным.

**Определить универсальные поля authorization и request:** OAuth providers не используют общий wire format. Универсальный тип запроса либо исключил бы provider-specific semantics, либо протащил бы их в lifecycle package.

## Consequences

Provider adapters используют общий access-token lifecycle и сохраняют provider-specific request behavior. Authorization outputs и request calls могут содержать secrets во время одной provider-операции, но snapshots, account metadata и diagnostics остаются без значений secrets. Потребители должны использовать lifecycle adapter для выполнения запросов, чтобы получить поведение refresh и reauthentication.

## Testing

Package tests покрывают handoff access token через authorization и request calls, callback и setup-token login, provider refresh, unsupported revocation, propagation reauthentication до запроса, redacted snapshots и local cleanup.

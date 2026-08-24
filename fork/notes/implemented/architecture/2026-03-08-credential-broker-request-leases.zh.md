# Agent Note: Credential broker owns request leases

[English](2026-03-08-credential-broker-request-leases.md) | 中文

Status: implemented

## Problem

Ссылки на credentials передаются адаптерам для отдельных операций, а выбор pool, лимиты параллельности, health state и завершение lease требуют отдельного владельца. Расширение `ctx.credentials` смешало бы хранение секретов с жизненным циклом запроса и поощряло бы глобальную замену credential.

## Decision

`@deepseek-ai/dsh-credential-broker` публикует provider-neutral Service Definition `ctx.credentialBroker`. Он выбирает request-scoped `CredentialLease`, содержащий только branded identifiers и credential reference, затем принимает один terminal `LeaseCompletion` для точного lease id. Адаптеры владеют provider requests и вызывают `complete()` ровно один раз. API-key и OAuth представлены как виды аутентификации, а login, refresh, revocation и failure classification остаются provider-owned.

## Alternatives considered

**Расширение `ctx.credentials`:** Это связало бы разрешение значения с pool policy и сделало бы существующий value-free reference seam ответственным за concurrency и health state.

**Pools внутри адаптеров:** Это продублировало бы selection и lease rules в LLM adapters и сделало бы parallel-session behavior provider-specific.

**Универсальный OAuth service:** OAuth providers отличаются login, refresh, callback и revocation semantics. Универсальный parser скрывал бы provider-specific failures.

## Consequences

Первый package является contract slice с memory test double; он не сохраняет pool metadata и не отправляет provider requests. Будущие pool, route, health, proxy и OAuth packages должны использовать этот service без раскрытия secret values и без второго model catalog.

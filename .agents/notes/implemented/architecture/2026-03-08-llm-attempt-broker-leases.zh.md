# Agent Note: LLM attempts acquire broker leases

[English](2026-03-08-llm-attempt-broker-leases.md) | 中文

Status: implemented

## Problem

Provider adapter должен выбирать один credential для каждой network attempt без глобальной конфигурации и дублирования retry policy. Lease completion должен покрывать normal finish, provider failure, cancellation, missing credentials и truncated streams.

## Decision

`@deepseek-ai/dsh-llm-credential-broker` предоставляет `BrokeredLlmAdapter`. Он делегирует provider metadata и catalog methods, получает lease для каждого `stream()` call, разрешает reference через `ctx.credentials` и передаёт resolved value только provider-owned stream callback. Decorator завершает lease ровно один раз для terminal finish, abort, exception, missing reference или missing finish chunk. Существующие `ctx.llm` registration и `llm/stream` waterfall остаются владельцами retry и route collision.

## Alternatives considered

**Global credential replacement:** Изменение environment variable или shared adapter option создаёт race между parallel sessions и влияет на in-flight requests.

**Retry внутри decorator:** Скрытый retry budget конфликтует с существующим LLM recovery lifecycle и может дублировать provider attempts.

**Provider-neutral HTTP client:** Wire protocols, OAuth behavior и error evidence принадлежат provider adapter; broker consumer отвечает только за lease и reference resolution.

## Consequences

Provider adapters передают callback, соблюдающий `GenerateOptions.signal`, и в следующем slice переводят provider evidence в health dispositions. Сейчас provider failures имеют disposition `retain`; health classification и failover остаются отдельными behavior.

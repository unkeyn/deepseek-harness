# ROUTE-001: Request-scoped leases and provider adapter

Status: planned

Owner: unassigned

Contributors: —

Milestone: M1

Dependencies: ARCH-001, CRED-001

Agent Note: required before implementation

Completion record: —

## Цель

Провести один модельный provider route через broker так, чтобы каждая попытка использовала отдельный lease и не меняла глобальную конфигурацию.

## Scope

- Broker-backed LLM adapter для одного API-key provider.
- Selection по priority, availability и concurrency.
- Exactly-once lease completion.
- Caller cancellation и stream termination.
- Provider/model/session-aware safe telemetry.
- Один сетевой provider attempt на один adapter stream call.

## Не входит

- OAuth.
- Proxy pool.
- Автоматическое удаление invalid credentials.

## Acceptance criteria

- Параллельные сессии получают независимые leases.
- Быстрая cancellation освобождает lease и не блокирует следующий request.
- Secret не записывается в request header session event, error, telemetry или snapshot.
- Adapter collision на provider route отклоняется при composition, а не создаёт fallback order.
- Missing available credential возвращает отдельную redacted failure, отличную от provider AUTH.

## Verification

- Two-session concurrency test.
- Cancellation before dispatch, during stream и after terminal chunk.
- Adapter composition and duplicate route test.
- Assembled keyless snapshot для user-visible failure.

## Security and privacy

Resolved secret живёт только в provider call scope и не кешируется между операциями.

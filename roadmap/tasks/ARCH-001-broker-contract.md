# ARCH-001: Credential broker capability contract

Status: planned

Owner: unassigned

Contributors: —

Milestone: M0

Dependencies: —

Agent Note: required before implementation

Completion record: —

## Цель

Определить полный capability seam для pool selection, leases и result reporting без изменения agent loop и без расширения базового credential reference API несвязанными обязанностями.

## Scope

- Service Definition, Provider и Consumer roles.
- Branded identifiers для pool, credential и lease.
- Request context: provider, model, session/agent, purpose и cancellation.
- Lease lifecycle и exactly-once completion.
- Durable и ephemeral state ownership.
- Failure disposition и redacted diagnostics.
- Cordis registration, dependency и disposal semantics.

## Не входит

- Конкретный OAuth flow.
- Web UI.
- Provider-specific HTTP client.

## Acceptance criteria

- Agent Note сравнивает отдельный broker seam, расширение `ctx.credentials` и adapter-local pools.
- Контракт допускает параллельные сессии без глобальной подмены credential.
- Cancellation, timeout, retry и process disposal имеют однозначные transitions.
- Secrets отсутствуют во всех public types и events.
- Package topology и owning subsystem согласованы до начала CRED-001 и ROUTE-001.

## Verification

- Type-level package boundary checks.
- Lifecycle tests для acquire, complete, cancel и disposal.
- Composition test с заменяемым Provider implementation.

## Security and privacy

Service methods принимают opaque refs и возвращают opaque lease handles; resolved secret доступен только trusted Host consumer на минимально необходимое время.

## Open questions

- Нужен ли отдельный `ctx.credentialBroker` или capability должно иметь provider-neutral другое имя.
- Должен ли non-secret account affinity переживать restart сессии.
- Какой event сообщает UI об изменении health state без раскрытия provider payload.

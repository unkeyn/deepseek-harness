# HARDEN-001: Security, recovery and release hardening

Status: planned

Owner: unassigned

Contributors: —

Milestone: M7

Dependencies: all tasks selected for the release

Agent Note: required before implementation

Completion record: —

## Цель

Подтвердить, что credential stack безопасен при параллельности, отказах, restart и установке сторонних plugins.

## Scope

- Threat model и plugin trust boundary.
- Secret scanning для logs, snapshots, wire payloads и persisted metadata.
- Parallel session stress.
- Crash/restart recovery.
- Corrupt store and partial migration recovery.
- Upgrade/downgrade policy.
- Dependency and license review.
- Documentation для operators и plugin authors.

## Не входит

- Обещание безопасности произвольного community plugin.
- Поддержка provider flows без maintainer и real-account validation.

## Acceptance criteria

- Threat model перечисляет Host, Client, model provider, proxy, plugin и tool-process boundaries.
- Ни один test fixture или snapshot не содержит real credential.
- Parallel stress не выдаёт один non-shareable account сверх limit и не теряет lease.
- Restart очищает ephemeral leases и сохраняет корректные cooldown/quarantine states.
- Failed migration оставляет восстановимую исходную копию без тихого fallback.
- Документация предупреждает о provider terms и рекомендует official API channels для коммерческого использования.
- Релевантные package tests, snapshot tests, typecheck, lint, doc-sync, build и hygiene проходят.

## Verification

- Security review checklist и automated redaction tests.
- Fault-injection tests для storage, network и process termination.
- Full assembled Web/headless smoke для выбранного release slice.

## Security and privacy

Release блокируется при любом подтверждённом secret disclosure, cross-session credential mix-up или fail-open provider host validation.

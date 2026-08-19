# UI-001: Web and CLI management

Status: planned

Owner: unassigned

Contributors: —

Milestone: M6

Dependencies: ARCH-001; CRED-001 before pool editing; HEALTH-001 before health actions; OAUTH-001 before OAuth controls

Agent Note: required before implementation

Completion record: —

## Цель

Предоставить единое управление pools в Web Settings и CLI без переноса business rules в Client.

## Scope

- Pool and account list со status.
- Add, disable, reprioritize и remove operations.
- Check one/check all с progress и итоговыми disposition counts.
- Cooldown, quarantine, model exclusions и reauthenticate status.
- OAuth login/logout controls после OAUTH-001.
- Proxy binding через references после PROXY-001.
- Accessible error messages и partial-success reporting.

## Не входит

- Просмотр сохранённого secret.
- Client-side health classification.
- Hardcoded model/provider list.

## Acceptance criteria

- Credential inputs используют существующую write-only механику Host settings.
- Batch health operation не удаляет entries до завершения pagination/check enumeration.
- Partial failures остаются видимыми и повторяемыми.
- UI обновляется от authoritative Host state и не делает optimistic secret lifecycle mutations.
- CLI и Web используют одни Host contracts.

## Verification

- Client component tests для redaction, progress и partial failure.
- Host API schema tests.
- Browser e2e для add, disable, check, remove, OAuth sign-in mock и restart.

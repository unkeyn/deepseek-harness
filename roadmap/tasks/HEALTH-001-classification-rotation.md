# HEALTH-001: Health classification, rotation and failover

Status: planned

Owner: unassigned

Contributors: —

Milestone: M2

Dependencies: ROUTE-001

Agent Note: required before implementation

Completion record: —

## Цель

Добавить единый lifecycle для временных и необратимых provider failures, не смешивая retry одного запроса с долгосрочным состоянием credential.

## Scope

- Provider-specific error classifiers.
- Cooldown с Retry-After/reset и bounded backoff.
- Quarantine для ambiguous failures.
- Model exclusion для model-only denial.
- Revoked/invalid removal policy.
- Failover на следующий eligible lease.
- Health check scheduling и manual verify.

## Не входит

- Обход provider quotas.
- Автоматическое удаление по generic 403, network error, timeout или 5xx.
- Бесконечный retry.

## Acceptance criteria

- Invalid/revoked/deactivated credential удаляется только после provider-specific подтверждения.
- 429 с reset создаёт cooldown; quota без reset не маскируется как healthy.
- Billing, geo restriction и ambiguous 403 сохраняют credential с точным disposition.
- Model-only denial не отключает весь credential.
- Failover не повторяет один и тот же credential в пределах одной retry decision, пока есть eligible alternative.
- Retry budget остаётся видимым и bounded.

## Verification

- Contract matrix для AUTH, QUOTA, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT и ABORTED.
- Fake-clock cooldown tests.
- Multi-entry failover and exhaustion tests.
- No-new-evidence/no-state-change test для ambiguous failures.

## Security and privacy

Provider response проходит redaction до persistence и UI; raw body не хранится как diagnostic convenience.

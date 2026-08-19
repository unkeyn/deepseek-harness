# Milestones

Статусы: `planned`, `ready`, `in-progress`, `blocked`, `done`. Канонический статус конкретной работы хранится в её task card.

| Milestone | Задачи | Результат | Статус |
|---|---|---|---|
| M0: Contracts | ARCH-001 | Утверждён capability contract и concurrency model | in-progress |
| M1: API-key vertical slice | CRED-001, ROUTE-001 | Один provider route использует multi-key pool | in-progress |
| M2: Resilience | HEALTH-001 | Rotation, cooldown, quarantine и failover проверены | planned |
| M3: Catalog | CATALOG-001 | Picker показывает только реально доступные provider models | planned |
| M4: OAuth | OAUTH-001 | OAuth account pools работают через тот же broker | planned |
| M5: Proxy routing | PROXY-001 | Provider/account routes используют выбранные proxies | planned |
| M6: Operations | UI-001 | Web/CLI управляют pools, accounts и routes | planned |

## Dependency graph

```text
ARCH-001
  |-- CRED-001 -- ROUTE-001 -- HEALTH-001
  |                         |-- CATALOG-001
  |                         |-- OAUTH-001
  |                         `-- PROXY-001
  `-------------------------------- UI-001
```

## Release slices

### Slice A: Internal preview

ARCH-001, CRED-001 и ROUTE-001 завершены. Один API-key provider проходит параллельные session tests, но UI может оставаться минимальным.

### Slice B: Resilient preview

HEALTH-001 и CATALOG-001 завершены. Неработающий credential не ломает весь provider route, а недоступные модели не показываются как рабочие.

### Slice C: OAuth and proxy preview

OAUTH-001 и PROXY-001 завершены для первых поддержанных provider adapters; архитектура допускает несколько аккаунтов на provider.

### Slice D: Team-ready release

UI-001 завершён. Есть upgrade notes, recovery tests и понятная диагностика pool/account state.

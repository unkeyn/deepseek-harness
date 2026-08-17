# Task Cards

Каждая карточка — независимая единица ownership и review. ID не переиспользуются после завершения или отмены задачи.

| ID | Название | Dependencies | Status |
|---|---|---|---|
| [ARCH-001](ARCH-001-broker-contract.md) | Credential broker capability contract | — | planned |
| [CRED-001](CRED-001-pool-store.md) | Secure pool metadata and secret storage | ARCH-001 | planned |
| [ROUTE-001](ROUTE-001-request-leases.md) | Request-scoped leases and provider adapter | ARCH-001, CRED-001 | planned |
| [HEALTH-001](HEALTH-001-classification-rotation.md) | Health classification, rotation and failover | ROUTE-001 | planned |
| [CATALOG-001](CATALOG-001-provider-model-discovery.md) | Credential-aware provider/model discovery | ROUTE-001 | planned |
| [OAUTH-001](OAUTH-001-provider-oauth.md) | OAuth account lifecycle | ROUTE-001 | planned |
| [PROXY-001](PROXY-001-proxy-routing.md) | Account-bound proxy routing | ROUTE-001 | planned |
| [UI-001](UI-001-management.md) | Web and CLI management | ARCH-001; incremental dependencies | planned |
| [HARDEN-001](HARDEN-001-security-release.md) | Security, recovery and release hardening | all release tasks | planned |

Новая карточка создаётся из [TEMPLATE.md](TEMPLATE.md). После завершения карточка остаётся на месте со ссылкой на immutable completion record в `done/`.

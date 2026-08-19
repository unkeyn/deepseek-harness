# Целевая архитектура

Этот документ задаёт рабочее направление до появления утверждённых Agent Notes. Он не является контрактом уже реализованного поведения.

## Capability stack

```text
Agent request
    |
    v
Provider-owned LLM adapter
    |
    v
Credential broker service
    |-- account/key pool
    |-- request-scoped lease
    |-- cooldown and quarantine
    |-- health and failure disposition
    `-- proxy binding
    |
    v
Credential provider
    |
    v
Provider API or OAuth subscription endpoint
```

## Ответственность компонентов

### Credential broker

Broker выбирает credential для одной операции, выдаёт lease, учитывает provider/model/session/purpose и принимает результат попытки. Broker не отправляет модельный запрос и не знает формат provider wire protocol.

Минимальная операция выбора должна учитывать:

- provider route и model id;
- session или agent identity;
- request purpose: conversation, compaction, session title или health check;
- cooldown, quarantine, model exclusions и concurrency limit;
- user-defined priority;
- optional proxy binding;
- cancellation до и после выдачи lease.

### Credential provider

Credential provider хранит значения и предоставляет существующие reference, resolve и configured-state операции. Broker использует этот интерфейс вместо собственного формата секретов.

Первый implementation может использовать существующий local provider, но production-ready storage должен допускать OS-bound provider без изменения broker contract.

### Provider adapter

Один adapter владеет одним provider route и использует broker перед каждым stream call. Adapter переводит provider response в стабильную failure classification и завершает lease ровно один раз.

Adapter не меняет pool state после caller cancellation, если upstream не вернул достоверный provider result. Timeout, transport failure и ambiguous 403 не должны автоматически удалять credential.

### Health checker

Health checker использует provider-specific проверку. Универсальный HTTP status недостаточен для решения об удалении: одинаковый 403 может означать revoked account, model-only denial, region restriction или policy block.

Проверка возвращает disposition:

| Disposition | Значение |
|---|---|
| `healthy` | Credential подтверждён и пригоден |
| `cooldown` | Временный rate limit или quota с известным reset |
| `quarantine` | Неоднозначная ошибка требует повторной проверки или ручного решения |
| `model_exclude` | Credential работает, но не имеет доступа к конкретной модели |
| `reauthenticate` | OAuth credential требует повторного входа |
| `remove` | Необратимая invalid/revoked/deactivated ошибка подтверждена |
| `retain` | Состояние пула не меняется |

### Proxy router

Proxy выбирается вместе с credential lease и остаётся стабильным в пределах попытки. Правила задаются на уровне provider, account или route и переиспользуют выбранную пользователем proxy-конфигурацию.

## Параллельность

- Один credential может иметь настраиваемый предел одновременных leases.
- Выдача и завершение lease атомарны относительно остальных запросов.
- Две сессии не меняют глобальную environment variable для ротации.
- Failover выдаёт новый lease только после завершения предыдущей попытки.
- Cancellation освобождает lease без ошибочной quarantine.
- Process restart восстанавливает durable health state, но не незавершённые leases.

## Persisted state

Durable store содержит pool metadata: credential id, provider route, auth kind, user priority, cooldown deadline, model exclusions, health timestamps, proxy reference и failure classification. Значения credentials остаются в существующем credential provider.

## DSH integration points

- Service Definition, Provider и Consumer оформляются как полный capability seam.
- LLM routes регистрируются через `ctx.llm`; модельный каталог и discovery остаются provider-owned.
- Настройки и credentials используют существующие value-free Host APIs.
- Web UI подключается штатной client plugin/settings card механикой.
- Retry участвует в существующем request recovery lifecycle, не создавая скрытый второй retry budget внутри SDK.
- Реализация следует [LLM adapter cookbook](../docs/cookbook/adding-an-llm-adapter.md) и [settings card cookbook](../docs/cookbook/adding-a-settings-card.md).

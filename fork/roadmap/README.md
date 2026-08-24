# Provider Access Roadmap

Этот каталог координирует развитие credential-инфраструктуры в форке `unkeyn/deepseek-harness`. Roadmap не заменяет контракты пакетов, пользовательскую документацию или Agent Notes: после реализации источником истины остаются код, package README, subsystem docs и `.agents/notes/implemented/`.

## Цель

Перенести в DeepSeek Harness проверенные в OMP механизмы работы с несколькими API-ключами, OAuth-аккаунтами, rotation и proxy без изменения `agent-loop` и без второго независимого каталога моделей.

Итоговая система должна поддерживать:

- пулы API-ключей и OAuth-аккаунтов;
- request-scoped leases для параллельных сессий;
- rotation, cooldown, quarantine, revocation и failover;
- provider-specific health checks и точную классификацию ошибок;
- привязку proxy к провайдеру или аккаунту;
- динамический каталог только реально доступных моделей;
- использование существующего credential storage и write-only UI/RPC;
- Web UI и CLI для управления pools, accounts и routes;
- восстановление pool state после перезапуска.

## Архитектурные ограничения

- Новое поведение реализуется через Cordis plugins и capability seams согласно [архитектуре DSH](../docs/architecture.md).
- Базовый [`ctx.credentials`](../docs/subsystems/credentials.md) остаётся value-free reference seam; pool selection не маскируется глобальной подменой одного credential value.
- Один provider route имеет одного владельца LLM adapter. Несколько ключей одного провайдера выбираются внутри одного adapter/broker stack.
- Модельный каталог исходит из `ctx.llm` и provider-owned discovery. Web UI не содержит отдельный allowlist провайдеров или моделей.
- OAuth реализуется отдельно для каждого провайдера. Универсальная форма токена не предполагается.
- OMP используется как источник уже работающей pool/OAuth/rotation логики; Harness адаптирует её к Cordis и собственным provider routes, а не переизобретает политику доступа.
- Количество аккаунтов и ключей, а также их использование определяются пользовательской конфигурацией и не являются acceptance policy проекта.

## Структура

| Путь | Назначение |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Целевая схема сервисов, ownership и request lifecycle |
| [MILESTONES.md](MILESTONES.md) | Порядок этапов, зависимости и общий статус |
| [WORKFLOW.md](WORKFLOW.md) | Правила совместной работы, claim, review и завершение задач |
| [tasks/](tasks/README.md) | Отдельные карточки работ со стабильными ID |
| [done/](done/README.md) | Проверяемые записи о завершённых задачах |

## Приоритеты

1. Сначала определить capability contract и concurrency invariants.
2. Затем реализовать API-key pool для одного обычного провайдера как минимальный вертикальный срез.
3. После этого добавить health classification, rotation и failover.
4. OAuth и proxy routing строятся поверх проверенного lease lifecycle.
5. UI добавляется после стабилизации Host contracts, а не определяет их.
6. Каждый slice завершается функциональными и параллельными session tests.

## Не входит в первую версию

- OMP или FreeLLMAPI как обязательная runtime-зависимость;
- второй независимый каталог моделей;
- изменение `agent-loop` ради credential rotation.

## Текущий статус

Первая задача для реализации: [ARCH-001](tasks/ARCH-001-broker-contract.md). Контракт `@deepseek-ai/dsh-credential-broker` добавлен; provider implementation и composition verification остаются частью ARCH-001/CRED-001.

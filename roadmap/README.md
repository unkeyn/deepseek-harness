# Credential Infrastructure Roadmap

Этот каталог координирует развитие credential-инфраструктуры в форке `unkeyn/deepseek-harness`. Roadmap не заменяет контракты пакетов, пользовательскую документацию или Agent Notes: после реализации источником истины остаются код, package README, subsystem docs и `.agents/notes/implemented/`.

## Цель

Добавить в DeepSeek Harness безопасную и расширяемую работу с несколькими API-ключами и OAuth-аккаунтами без изменения `agent-loop` и без второго независимого каталога моделей.

Итоговая система должна поддерживать:

- пулы API-ключей и OAuth-аккаунтов;
- request-scoped leases, безопасные для параллельных сессий;
- rotation, cooldown, quarantine, revocation и failover;
- provider-specific health checks и точную классификацию ошибок;
- привязку proxy к провайдеру или аккаунту;
- динамический каталог только реально доступных моделей;
- безопасное хранение секретов и write-only UI/RPC;
- Web UI и CLI для управления без раскрытия токенов;
- восстановление после перезапуска без записи секретов в session log.

## Архитектурные ограничения

- Новое поведение реализуется через Cordis plugins и capability seams согласно [архитектуре DSH](../docs/architecture.md).
- Базовый [`ctx.credentials`](../docs/subsystems/credentials.md) остаётся value-free reference seam; pool selection не маскируется глобальной подменой одного credential value.
- Один provider route имеет одного владельца LLM adapter. Несколько ключей одного провайдера выбираются внутри одного adapter/broker stack.
- Модель получает только provider/model и обычный запрос. API keys, refresh tokens, proxy credentials, account identifiers и health diagnostics не входят в model-visible context.
- Модельный каталог исходит из `ctx.llm` и provider-owned discovery. Web UI не содержит отдельный allowlist провайдеров или моделей.
- OAuth реализуется отдельно для каждого провайдера. Универсальная форма токена не предполагается.
- Proxy routing ограничивается известными endpoint domains и не меняет сетевое поведение всего процесса без явного выбора пользователя.

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
6. Публикация начинается только после security review и параллельных session tests.

## Не входит в первую версию

- массовое использование чужих аккаунтов, quota resale или обход ограничений провайдера;
- device fingerprint spoofing и механизмы обхода upstream enforcement;
- синхронизация с OMP или FreeLLMAPI как обязательная runtime-зависимость;
- глобальная подмена `fetch` или `HTTPS_PROXY` для всего Harness;
- сохранение секретов, полных provider responses или OAuth callback payloads в session log;
- изменение `agent-loop` ради credential rotation.

## Текущий статус

Все карточки находятся в состоянии `planned`. Первая задача для реализации: [ARCH-001](tasks/ARCH-001-broker-contract.md).

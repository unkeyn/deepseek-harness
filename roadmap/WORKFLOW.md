# Совместная работа

Roadmap оптимизирован для нескольких разработчиков и минимизирует одновременное редактирование общих файлов.

## Как взять задачу

1. Откройте task card из [tasks/](tasks/README.md) и проверьте dependencies.
2. Заполните `Owner`, смените `Status` на `in-progress` и добавьте ссылку на issue или PR при её появлении.
3. Для non-trivial решения создайте или обновите официальный Agent Note по правилам [`.agents/notes/`](../.agents/notes/README.md).
4. Не расширяйте scope карточки молча. Новый независимый результат получает новый ID и task card.

## Правила разделения работы

- Один task card имеет одного ответственного owner; contributors перечисляются отдельно.
- Параллельные задачи не меняют один capability contract без согласованного Agent Note.
- Shared types и wire contracts принадлежат ARCH-001 до его завершения.
- Provider-specific код не добавляет универсальные исключения в broker.
- UI не дублирует provider/model registry и не владеет health classification.
- Tests подтверждают observable behavior, а не внутреннюю последовательность вызовов.

## Обязательные поля task card

- стабильный ID;
- status и owner;
- цель и границы scope;
- dependencies;
- acceptance criteria;
- verification commands или сценарии;
- security/privacy considerations;
- ссылка на owning Agent Note после его создания.

## Definition of Done

Задача считается завершённой, только когда:

- acceptance criteria подтверждены;
- добавлены contract-level tests для нового поведения;
- обновлены package README, subsystem docs и Agent Note там, где этого требуют правила репозитория;
- секреты не появляются в UI, RPC, logs, snapshots и session events;
- выполнены релевантные package tests, typecheck, lint/doc gates и assembled snapshot согласно области изменения;
- reviewer подтвердил cancellation, partial failure и restart behavior;
- task card получает `Status: done` и ссылку на запись в [done/](done/README.md);
- незавершённые follow-ups вынесены в отдельные task cards.

## Запись о завершении

Создайте `roadmap/done/YYYY-MM-DD-<TASK-ID>-<short-name>.md` по [шаблону](done/TEMPLATE.md). Запись содержит фактический результат, проверки, решения и известные ограничения; она не пересказывает реализацию построчно.

## Изменение roadmap

Обновляйте только затронутые task cards и milestone status. Не переписывайте завершённые записи задним числом; существенное исправление получает новую задачу и ссылается на прежнюю запись.

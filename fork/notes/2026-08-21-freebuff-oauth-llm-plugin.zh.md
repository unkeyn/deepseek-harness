# Agent Note: Freebuff OAuth and free-model LLM plugins

Status: implemented

[English](2026-08-21-freebuff-oauth-llm-plugin.md) | 中文

## Problem

Бесплатные модели Freebuff требуют device-code входа, bearer-токена, серверского допуска в сессию и специальных метаданных запроса Freebuff. Добавление этих механизмов в официальные пакеты провайдеров связало бы официальный репозиторий с необязательным для harness сервисом и не позволило бы сохранить независимо используемый официальный checkout, идентичный побайтно.

## Decision

Fork владеет тремя runtime-плагинами: `@deepseek-ai/dsh-fork-credential-freebuff-oauth` предоставляет `ctx.freebuffOAuth`, `@deepseek-ai/dsh-fork-command-freebuff` предоставляет интерактивную команду входа, а `@deepseek-ai/dsh-fork-llm-freebuff` регистрирует маршрут `freebuff`. OAuth-провайдер вызывает `/api/auth/cli/code`, опрашивает `/api/auth/cli/status`, сохраняет полученный bearer-токен через `ctx.credentials` под стабильной ссылкой и восстанавливает его после перезапуска. Freebuff не предоставляет обмен refresh-токена; ответ провайдера `401` удаляет локальный credential и snapshot аккаунта, поэтому отклонённые credentials требуют нового device login.

Отдельный плагин `@deepseek-ai/dsh-fork-command-freebuff` предоставляет команды `/freebuff-login` и `/freebuff-login wait`, поэтому интерактивный пользователь может подтвердить device URL и сохранить токен без программного вызова сервиса.

LLM-плагин использует актуальный каталог моделей Freebuff, допускает одну сессию для запрошенной модели, отправляет `x-freebuff-model`, `x-freebuff-instance-id`, `codebuff_metadata.cost_mode = "free"` и идентификатор экземпляра, а при остановке плагина освобождает сессию. OpenAI-compatible SSE переводится через существующие DeepSeek serializer и translator, включая reasoning, tool calls, изображения, usage и метаданные compaction-сессии. Chat-gate, завершающий сессию, повторяет admission один раз; конкурентные admissions сериализуются и не позволяют pending admission одной модели обслужить запрос другой модели.

Fork Host API proxy оставляет OAuth secrets на Host и через `freebuff.status` и связанные методы входа выдаёт только обезличенные данные аккаунта. Он также предоставляет `freebuff.openDesktop`: Host разрешает абсолютный `desktopShortcutPath` из конфигурации credential plugin и вызывает native path opener, а браузер не передаёт путь файловой системы. В Windows по умолчанию используется `C:\Users\<user>\OneDrive\Desktop\DeepSeek Harness Desktop.lnk`, на других платформах — соответствующий путь в `<home>/Desktop`. Fork client plugin регистрирует вкладку `OAuth` в `settings.plugins.tab`; она открывает device URL, ждёт подтверждения через Host, предоставляет refresh и disconnect, а также показывает `Open Harness Desktop` без browser token store.

OAuth-провайдер следует CLI fingerprint protocol Freebuff: строит кэшируемый на время процесса `enhanced-` SHA-256 идентификатор из локальных данных машины, при сбое расширенного сбора использует официальный случайный fallback `codebuff-cli-`, а при polling повторно передаёт серверные `fingerprintHash` и точное исходное значение `expiresAt`. Он не ротирует и не подделывает fingerprint; принятие аккаунта и сессии остаётся ответственностью Freebuff.

`fork/bundle/cordis.patch.yml` отключает каждую заменяемую официальную Loader-строку и вставляет fork-строку с отдельным id. Официальные строки остаются доступными для восстановления последующим patch layer, а строки, существующие только для Freebuff, подключаются рядом с остальными возможностями fork.

## Alternatives considered

**Изменить официальные пакеты провайдеров.** Отклонено: официальный репозиторий должен работать без Freebuff и оставаться побайтно идентичным upstream checkout; overlay является точкой композиции поведения fork.

**Считать bearer-токен Freebuff обычным API-key в настройках.** Отклонено: device-code login, хранение токена, обезличенные метаданные аккаунта и повторная авторизация являются OAuth-поведением провайдера; помещение токена в settings раскрыло бы secret через конфигурационные поверхности.

**Пропустить session admission и отправлять только chat request.** Отклонено: free mode Freebuff требует живой серверский instance и отклоняет запросы без совпадающих model и instance headers.

**Добавить совместимость с refresh-токеном.** Отклонено: device flow Freebuff возвращает access token без refresh credentials; выдуманный refresh path скрывал бы необходимость повторного входа.

## Consequences

Freebuff включается через fork overlay; credentials service должен быть скомпонован до OAuth-провайдера и LLM route. Официальное дерево остаётся отдельным source plane, а fork-specific package-manager артефактами являются только fork build и lockfile. При отклонённом или истёкшем токене пользователь должен снова подтвердить вход в браузере; лимиты сессий и доступность моделей по-прежнему определяются ответом Freebuff. LLM-маршрут инвалидирует локальное OAuth-состояние при `401` как во время допуска в сессию, так и во время chat-запроса, а остальные session gate Freebuff сохраняют прежнюю логику восстановления.

Focused OAuth, lifecycle, SSE, tool-call, session-recovery, concurrency, composition, Host RPC, desktop-launcher и client UI tests покрывают провайдер. Host и client TypeScript-проекты, а также fork library build проходят.

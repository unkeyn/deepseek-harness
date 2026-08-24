# Freebuff LLM

[English](README.md) | 中文

`@deepseek-ai/dsh-fork-llm-freebuff` регистрирует маршрут `freebuff`. Он использует отдельный сервис `ctx.freebuffOAuth`, открывает серверскую Freebuff-сессию для выбранной модели, передаёт метаданные бесплатного режима и переводит OpenAI-совместимый SSE-поток в протокол harness. Браузерная авторизация проходит через `freebuff.com`, а API авторизованных моделей размещён на `codebuff.com`; поэтому это значение используется по умолчанию в `baseURL` адаптера. Команда `/freebuff-login` и `/freebuff-login wait` предоставляет интерактивную device-code авторизацию.

Сначала подключите `@deepseek-ai/dsh-fork-credential-freebuff-oauth`, а также провайдер credentials для сохранения токена device-login. Адаптер публикует актуальный каталог бесплатных моделей Freebuff и поддерживает текст, reasoning, tool calls, usage и изображения для моделей, объявляющих мультимодальный ввод.

Маршрут можно заменить или отключить через loader patch, не изменяя пакеты официального репозитория. Если API Freebuff возвращает `401`, сохранённый credential удаляется, а пользователю предлагается повторно подключиться через `Settings -> Plugins -> OAuth`.

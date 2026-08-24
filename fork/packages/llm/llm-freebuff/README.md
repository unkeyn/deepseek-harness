# Freebuff LLM

English | [中文](README.zh.md)

`@deepseek-ai/dsh-fork-llm-freebuff` registers the `freebuff` provider route. It consumes the separate `ctx.freebuffOAuth` service, admits one server-side Freebuff session per model, sends free-mode metadata, and translates the OpenAI-compatible SSE stream into the harness protocol. Freebuff's browser login is hosted at `freebuff.com`; its authenticated model API is hosted at `codebuff.com`, which is the adapter's default `baseURL`.

Mount `@deepseek-ai/dsh-fork-credential-freebuff-oauth` before this plugin and keep the credentials provider mounted so device-login tokens can be persisted. The adapter advertises the current Freebuff free-model catalog and supports text, reasoning, tool calls, usage accounting, and multimodal input for catalog entries that declare image support.

The route can be replaced or disabled through a higher loader patch without changing the official repository packages. A provider-side `401` clears the persisted Freebuff credential and asks the user to reconnect from `Settings -> Plugins -> OAuth`.

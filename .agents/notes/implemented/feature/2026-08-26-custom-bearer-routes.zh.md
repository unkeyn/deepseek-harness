# Agent Note: Custom Bearer routes refresh provider-owned tokens

[English](2026-08-26-custom-bearer-routes.md) | 中文

Status: implemented

## Problem

Models 页面原本只能在 `llm-pi-ai` 中手工声明 API-key 路由。会到期的 Firebase ID token 需要显式 Bearer 鉴权、配套 refresh token、持久轮换，以及不会通过 settings 暴露 secret value 的 transport。TwinMind 还使用带有 consumer-specific request 与 SSE 词汇的 `POST /api/v3/chat`，并非 OpenAI-compatible protocol。

把两个 credential family 都混入 `llm-pi-ai`，会让一个插件持有无关的配置与生命周期规则。浏览器代码也无法直接读取 TwinMind cookie，因为它们跨源且带 `HttpOnly`，但用户可以自行导出这些 cookie。

## 决策

Bearer 路由归独立的 `@deepseek-ai/dsh-llm-bearer` Cordis 插件与 `llm-bearer` settings namespace 持有。`llm-pi-ai` 保持只支持 API key。Bearer profile 指定只写 access 与 refresh credential reference，以及非机密 Firebase 配置。resolver 从 JWT 推导到期时间，为同一路由共享并发 refresh，优先采用 Firebase 返回的 `id_token`，先持久化轮换后的 refresh token，再写入新 ID token，且只有两次写入成功后才 dispatch。新进程直接读取持久化值，不依赖内存状态。

Models 在**添加自定义提供方**旁增加**添加 Bearer 提供方**。前者保持既有 `llm-pi-ai` API-key 行为，后者写入 `llm-bearer`。Bearer 卡片可在本地解析用户粘贴的 cookie 导出数组，只接受 `app.twinmind.com` 下名称精确匹配的 `session` 与 `firebase_refresh_token`，忽略分析条目，把两个值复制到只写草稿，并立即清空原始 JSON。它不会尝试跨源读取 cookie。

首个 transport 是 `twinmind-chat`。它以 `Authorization: Bearer` 请求 `POST /api/v3/chat`，把 TwinMind text 与 thinking SSE event 映射为 Harness block，把返回的 provider session id 存为 replay metadata，并把 provider-side tool event 当作进度，而不是 Harness tool call。模型发现读取官方 web client 的 `GET /api/v3/chat/models` response。TwinMind 用不同 model id 表达 thinking，而不是 reasoning-effort request field，因此 adapter 提供模型切换，但不显示 reasoning-level selector。用户提供的其他 TwinMind endpoint 属于产品功能，不进入模型请求。

## Alternatives considered

**把 `Authorization: Bearer …` 存入 profile headers。** `headers` 是普通 settings 数据，会由脱敏描述返回，而且没有 refresh owner。

**给 `llm-pi-ai` 增加 Bearer 选择器。** 这能保留一个按钮，却会把 API-key SDK 路由与 Firebase 轮换及 TwinMind consumer transport 耦合。独立 namespace 能明确表达路由 ownership 与编辑行为。

**自动读取 TwinMind cookie。** 页面无法读取另一个源的 `HttpOnly` cookie。对明确导出内容做本地解析，可以完成同样的字段提取，而不依赖浏览器权限绕过，也不持久化原始导出。

**把 chat、memory、todo 与 personalization 暴露为同一个 provider。** 模型 dispatch 只需要 chat。其他 endpoint 需要单独决定 tool request、result 与 authority。

## 结果

- API-key 自定义路由保留原有 settings 与 credential 行为。
- Bearer access 与 refresh value 不进入 settings、descriptor、diagnostic、session event、snapshot；cookie 解析后原始输入也不会保留。
- Firebase 轮换在并发下安全，并可跨新进程与 session 持久使用。
- TwinMind 使用已持有的 chat 与模型目录 endpoint，并可在公布的 model id 间切换。
- 缺失、过期或不可写的凭据会在 provider dispatch 前以 credential-specific error 失败。

## 限制

插件会刷新 credential，但不执行 Firebase sign-in、logout、revocation 或 account selection。只有 ID token 无法实现自动刷新；还需要配套 refresh token 与可写 credential service。

TwinMind 持有服务端 conversation 与 tool。已观察到的 consumer endpoint 不接受 Harness tool schema 或 provider-neutral history，因此该路由提供 text 与 reasoning，但不提供本地 Harness tool call 或精确 request replay。

## 测试

`packages/llm/llm-bearer/tests/bearer.spec.ts` 覆盖静态与到期 token、并发 Firebase refresh、轮换 credential 持久化、新进程复用与 refresh failure。`packages/llm/llm-bearer/tests/adapter.spec.ts` 覆盖 TwinMind request、Bearer header、SSE start event 携带的内容、replay state 与 provider-side tool progress。`packages/llm/llm-bearer/tests/discovery.spec.ts` 覆盖带鉴权的模型目录与 provider section 展开；`loader-composition.spec.ts` 覆盖 dormant 与 settings 驱动的路由注册。UI 测试覆盖独立入口、API-key 隔离、本地 cookie 解析、两次 credential 写入与原始输入清空。headless snapshot 覆盖组装后的无密钥 TwinMind Bearer 路由。使用用户明确提供 cookie export 的 live test 强制执行了 Firebase 轮换，让新 resolver 复用持久化值，发现 13 个模型，恢复 `auto` chat，切换到明确模型，并从 thinking 模型收到 reasoning 与 text。

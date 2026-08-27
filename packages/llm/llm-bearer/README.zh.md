# @deepseek-ai/dsh-llm-bearer

[English](README.md) | 中文

这是 Harness LLM seam 的独立 Bearer 鉴权提供方插件。它持有 `llm-bearer` settings namespace、Firebase access-token 轮换与 TwinMind consumer-chat transport。API-key 路由仍由 [`@deepseek-ai/dsh-llm-pi-ai`](../llm-pi-ai/README.md) 持有，因此同一路由不会在同一插件内静默切换 credential family。

## 配置

每个 provider profile 只指定只写 credential reference。secret value 必须位于 `ctx.credentials` 或被引用的启动环境中，绝不进入此配置。

```yaml
- id: llm-bearer
  name: '@deepseek-ai/dsh-llm-bearer'
  config:
    providers:
      twinmind:
        displayName: TwinMind
        auth:
          type: bearer
          accessTokenEnv: TWINMIND_BEARER_TOKEN
          refresh:
            type: firebase
            refreshTokenEnv: TWINMIND_REFRESH_TOKEN
            # Public Firebase Web API key, not a user credential.
            apiKey: AIzaSyD2Sd_NP3vA4rwvoroKqDefpXZeCMDXcIQ
        api: twinmind-chat
        baseURL: https://api2.twinmind.com
        models:
          - id: auto
```

随附 base bundle 会以 dormant 状态挂载插件。空 `providers` dict 不注册任何模型路由；通过 settings 写入 `llm-bearer.providers.<route>` 会实时注册该路由，删除 profile 则撤回它。每个已配置路由都会进入共享 configurable-provider directory，settings path 为 `providers.<route>`，因此 Models 页面仍是 `ctx.llm` 的视图，不是第二份 catalog。

## 凭据生命周期

每次请求都会解析 access token。静态 opaque token 会原样发送；没有 refresh 配置的 JWT 在过期后以 `OAUTH_REAUTHENTICATE` 被拒绝。Firebase refresh 需要当前 ID token、配套 `refresh_token` 与公开 Firebase Web API key。resolver 会在最后一分钟内刷新，为并发请求共享一次 pending exchange，优先采用 Firebase 返回的 `id_token`，先持久化轮换后的 refresh token，再持久化新 ID token，且只有两次写入成功后才 dispatch。新进程直接读取这些持久化值，不依赖内存状态。

自动轮换需要可写 credential service。环境值仍可读取，但无法持久化继任值的 refresh 会以 `CREDENTIAL_WRITE_FAILED` 失败，不会虚假承诺重启安全。

## TwinMind transport

`twinmind-chat` 向 `POST /api/v3/chat` 发送 `Authorization: Bearer`，请求 SSE，把 text 与 thinking event 映射为 Harness block，并把 TwinMind 返回的 `session_id` 保存在 adapter replay metadata 中，供同一路由和模型的下一次请求使用。TwinMind 流中的 `tool_call` 与 `tool_result` 是 provider-side progress，不会暴露为 Harness tool call。

模型发现会读取 TwinMind web client 的 `GET /api/v3/chat/models` response，并展开其中的默认模型与 provider section。Models 表单从 `auto` 开始，也可以采纳 endpoint 公布的明确模型 id，包括 TwinMind 独立的 thinking-model variant。API 提供模型选择，而不是 reasoning-effort 参数，因此 Harness reasoning-level selector 保持不可用。`/api/v3/chats`、message history、memory、todo、saved prompts、personalization、recap、Google OAuth、templates、notes 与 summary endpoint 都不是模型 dispatch 所需。若要暴露这些产品功能，需要拥有独立 request 与 authority contract 的单独 tool。

## 模型体验

### TwinMind consumer-chat 请求

#### 模型看到什么

TwinMind 接收最新用户消息文本作为 `query`，并接收所选模型。endpoint 自行持有服务端 conversation、memory 与 tool；此 transport 不序列化 Harness system text、本地 tool schema 或 provider-neutral history。通过校验的旧 TwinMind `session_id` 会恢复 provider conversation，但不会变成模型可见文本。

#### Token 影响

此包只直接加入最新用户文本。provider 持有的 conversation state 可能加入 Harness 无法在本地计数的上下文。

#### KV Cache 影响

TwinMind 通过 `session_id` 持有 cache 与 conversation reuse。更换 provider、model 或丢失有效 replay metadata 会开始独立 provider conversation。

### TwinMind 响应

#### 模型看到什么

TwinMind text 与 thinking SSE event 会变成持久 Harness text 与 reasoning block。provider-side tool progress 不会变成本地 tool call。

#### Token 影响

loop 记录生成的 text 与 reasoning 后，它们会影响后续 Harness input；但该 transport 通过 provider state 恢复 TwinMind，而不是在 request body 中重放这些 block。

#### KV Cache 影响

response 追加到 Harness session log。provider-side reuse 仍由返回的 `session_id` 控制。

## 已知限制与延期工作

- **TwinMind 持有 tool 与 conversation assembly**：已观察到的 consumer endpoint 不接受 Harness tool schema 或 provider-neutral history，因此该路由不提供本地 tool execution 与精确 prompt replay。
- **没有 token usage**：这里使用的 SSE vocabulary 不携带稳定 input/output token accounting，因此 adapter 不发出 usage chunk。
- **Firebase 登录位于插件之外**：插件会刷新已存 credential，但不执行 Google/Firebase sign-in、logout、revocation 或 multi-account selection。

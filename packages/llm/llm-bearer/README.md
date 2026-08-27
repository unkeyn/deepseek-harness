# @deepseek-ai/dsh-llm-bearer

English | [中文](README.zh.md)

Separate Bearer-authenticated provider plugin for the Harness LLM seam. It owns the `llm-bearer` settings namespace, Firebase access-token rotation, and TwinMind's consumer-chat transport. API-key routes remain owned by [`@deepseek-ai/dsh-llm-pi-ai`](../llm-pi-ai/README.md), so one route cannot silently switch credential families inside the same plugin.

## Config

Each provider profile names write-only credential references. Secret values belong in `ctx.credentials` or the referenced launch environment, never in this configuration.

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

The shipped base bundle mounts the plugin dormant. An empty `providers` dict registers no model routes; writing `llm-bearer.providers.<route>` through settings registers that route live, and removing the profile withdraws it. Each configured route appears in the shared configurable-provider directory with settings path `providers.<route>`, so the Models page remains a view of `ctx.llm` rather than a second catalog.

## Credential lifecycle

The access token resolves for every request. A static opaque token is sent unchanged. A JWT without refresh settings is rejected with `OAUTH_REAUTHENTICATE` after its expiry. Firebase refresh requires the current ID token, its matching `refresh_token`, and the public Firebase Web API key. The resolver refreshes during the final minute, shares one pending exchange across concurrent requests, prefers Firebase's returned `id_token`, persists a rotated refresh token before the new ID token, and dispatches only after both writes succeed. A new process reads those persisted values without depending on in-memory state.

Automatic rotation requires a writable credential service. Environment values remain readable, but a refresh that cannot persist its successor fails with `CREDENTIAL_WRITE_FAILED` rather than promising restart safety it cannot provide.

## TwinMind transport

`twinmind-chat` sends `POST /api/v3/chat` with `Authorization: Bearer`, requests SSE, maps text and thinking events to Harness blocks, and retains TwinMind's returned `session_id` in adapter replay metadata for the next request on the same route and model. TwinMind's streamed `tool_call` and `tool_result` events are provider-side progress; they are not exposed as Harness tool calls.

Model discovery reads TwinMind's web-client `GET /api/v3/chat/models` response and flattens its default model and provider sections. The Models form starts with `auto` and can adopt the advertised explicit model ids, including TwinMind's distinct thinking-model variants. The API exposes model choice rather than a reasoning-effort parameter, so the Harness reasoning-level selector remains unavailable. `/api/v3/chats`, message history, memory, todo, saved prompts, personalization, recap, Google OAuth, templates, notes, and summary endpoints are not required for model dispatch. Exposing those product features would require separate tools with their own request and authority contracts.

## Model Experience

### TwinMind consumer-chat request

#### What the model sees

TwinMind receives the latest user message's text as `query` and the selected model. The endpoint owns its server-side conversation, memory, and tools; Harness system text, local tool schemas, and provider-neutral history are not serialized by this transport. A validated prior TwinMind `session_id` resumes the provider conversation without becoming model-visible text.

#### Token effect

Only the latest user text is added directly by this package. Provider-owned conversation state may add context that Harness cannot count locally.

#### KV Cache effect

TwinMind owns cache and conversation reuse behind `session_id`. Changing provider, model, or losing valid replay metadata starts an independent provider conversation.

### TwinMind response

#### What the model sees

TwinMind text and thinking SSE events become durable Harness text and reasoning blocks. Provider-side tool progress does not become a local tool call.

#### Token effect

Generated text and reasoning affect later Harness input after the loop records them, although this transport resumes TwinMind through provider state rather than replaying those blocks in its request body.

#### KV Cache effect

The response appends to the Harness session log. Provider-side reuse remains controlled by the returned `session_id`.

## Known Limitations and Deferred Work

- **TwinMind owns tools and conversation assembly** — the observed consumer endpoint does not accept Harness tool schemas or provider-neutral history, so local tool execution and exact prompt replay are unavailable on this route.
- **Token usage is unavailable** — the SSE vocabulary used here carries no stable input/output token accounting, so the adapter emits no usage chunk.
- **Firebase login is external** — the plugin refreshes stored credentials but does not perform Google/Firebase sign-in, logout, revocation, or multi-account selection.

# Agent Note: A custom provider's undeclared reasoning efforts refuse the request locally

Status: diagnosed and fixed in the live `~/.dsh` configuration

## Problem

Every session opened with the default model `bai/glm-5.3-flash` failed instantly, before
any HTTP request, and looked exactly like a dead gateway: the UI reported an error, while
`curl https://api.b.ai/v1/chat/completions` with the same key and model answered `200`.

The session projections under `~/.dsh/storages/session_projcache/sessions/*.json` were the
tell — each failing session carries `modelSelection.lastUsed = {provider: bai, model:
glm-5.3-flash, reasoningEffort: max}` together with `sessionStats` whose `llmMs`, `ttftMs`,
`decodeMs`, `decodeTokens` and `tokenUsage.totals` are all zero, and `tokenUsage.last: null`.
Zero LLM time with a recorded turn means the request never left the process.

## Root cause

`agent-default-model` in `~/.dsh/settings.yaml` names `reasoningEffort: max`, and the `bai`
route declares its models by hand — id, context window, modalities — with no
`reasoningEfforts`. Two layers then refuse the call, both with the same message
(`UNSUPPORTED_REASONING_EFFORT`, `provider "bai" model "glm-5.3-flash" does not support
reasoning effort "max"`):

- `packages/llm/llm/src/index.ts:855-861` — the seam throws when the adapter reports no
  `reasoning` at all and the request still carries an effort.
- `fork/packages/llm/llm-pi-ai/src/adapter.ts:145-156` — `resolveReasoningLevel` throws when
  the effort is outside `getSupportedThinkingLevels(model)`.

The adapter reports no reasoning because `resolveModelReasoning`
(`fork/packages/llm/llm-pi-ai/src/catalog.ts:837-850`) returns
`{ reasoning: base?.reasoning ?? false }` for a model whose entry declares no
`reasoningEfforts`, and a hand-declared id such as `glm-5.3-flash` has no installed
pi-ai catalog entry to inherit from. `getSupportedThinkingLevels` short-circuits a
non-reasoning model to `['off']`, so `max` can never match.

## Decision

Declare the levels the gateway actually serves, per model, in
`~/.dsh/settings.yaml` under `llm-pi-ai.providers.bai.models[]`:

- `glm-5.3-flash`, the default: `low`, `high`, `max`.
- `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`, `qwen3.8-flash`: `low`, `medium`,
  `high`, `max`.
- Untouched: `gpt-5.6-luna`, `kimi-k3`, `deepseek-v4-pro`, `qwen3.8-max` (the gateway
  answers `403 Deposit required` for these regardless), and `Qwen/Qwen3.8-27B-FP8`,
  `qwen3.8-27b` (both answered `200` with `reasoning_content` empty at every level, so
  they are not thinking models and should keep offering no effort control).

Undeclared levels are pinned to `null` by `resolveModelReasoning`, which pi-ai reads as
unsupported — so they simply disappear from the picker instead of reaching the gateway.

## Why those levels and not others

Probed directly against the gateway with the configured key:

- `glm-5.3-flash` with `reasoning_effort: minimal` answers `400`:
  `该模型始终思考，不支持关闭思考；请使用 low、high 或 max。` — the model always thinks, it
  cannot be turned off, and the accepted levels are `low`, `high`, `max`. `medium` answered
  `200` on one probe and `400` on another, so it is excluded rather than declared.
- The parameter is honoured, not ignored: the same prompt produced
  `completion_tokens_details.reasoning_tokens` of 6 at `low`, 8 at `medium`, 26 at `max`,
  and the plain (no-parameter) request produced 40.
- pi-ai emits the declared wire value as `params.reasoning_effort`
  (`@earendil-works/pi-ai/dist/api/openai-completions.js`, the OpenAI-style branch), which is
  the field this gateway reads.

## Consequences

`prepareCall` now resolves `max` as supported and the request carries
`reasoning_effort: "max"`; sessions that already logged the `bai/glm-5.3-flash/max`
selection start working, because the selection is revalidated against the freshly built
model collection on every request rather than cached from the header.

The deeper gap stays open: nothing stopped the deployment from persisting `max` for a model
that reported no reasoning capability, and the two refusal sites surface as an opaque
provider-shaped error. Anything diagnosing "the provider does not respond" should first
check whether the session logged any LLM time at all — zero means the request was refused
on this side of the socket.

Backup of the previous configuration: `~/.dsh/settings.yaml.bak-20260831-210240`.

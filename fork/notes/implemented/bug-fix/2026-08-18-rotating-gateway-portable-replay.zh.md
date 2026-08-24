# Agent Note: 轮换网关的可移植回放

Status: implemented

[English](2026-08-18-rotating-gateway-portable-replay.md) | 中文

## Problem

网关可以暴露一个稳定的 Harness 路由，同时把每个请求轮换到独立的上游提供方。原生 pi-ai 回放元数据——响应 id、推理签名和提供方项目元数据——属于生成它的提供方。把这些元数据发给另一家提供方可能让网关拒绝请求，或在 OpenAI Responses 流的终止事件之前关闭流，使 agent（智能体）不断重试同一份无效历史。

## Decision

`dsh-llm-pi-ai` 为每个提供方 profile 增加 `replayMode`。默认的 `native` 会恢复经过验证的 pi-ai 回放元数据。`portable` 会跳过回放元数据，根据持久化的推理文本、普通文本和工具调用重建 assistant 历史；保留持久化的工具调用 id，使后续工具结果仍能与调用配对。由于 `a6api` 的上游提供方可能在不改变暴露路由的情况下轮换，因此该路由使用 `portable`。

## Alternatives considered

**对所有路由禁用原生回放。** 拒绝：直连提供方以及保持上游亲和性的网关能够复用有效的原生元数据，应保留现有的缓存和续接行为。

**不断重试同一个原生请求，直到网关轮换到兼容提供方。** 拒绝：不能假定下一家提供方理解上一家生成的 id 或加密签名；重试会重复无效请求并掩盖原因。

**把 A6API 切回 Chat Completions。** 拒绝：当前配置的 Responses 流才是该网关能产生终止事件的协议；切换协议会重新引入此前缺少 finish 的故障。

**只删除一个已知的 Responses 字段。** 拒绝：删除 `status` 能解决一个网关校验缺陷，但提供方专属的响应 id 与签名仍可能跨越轮换。

## Consequences

可移植路由放弃提供方原生回放，以及依赖它的提供方侧状态复用，但在网关更换上游提供方时仍能保持 assistant 历史有效。该设置只作用于单一路由，持久化内容仍是权威记录，原生路由不变。适配器仍通过 [OpenAI Responses 输入省略回放状态](2026-08-18-openai-responses-strips-input-status.md)所拥有的独立兼容规则删除 Responses `status` 字段；该说明保持活跃，因为可移植回放不能取代原生路由的修复。

## Verification

配置 schema 接受 `native` 与 `portable`，并拒绝其他值。转换测试证明可移植历史保留持久化文本和工具调用，同时省略响应 id 与块签名。现有 adapter、context、conversion 和 config 测试共同通过。

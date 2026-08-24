# Agent Note: OpenAI Responses 输入省略回放状态

Status: implemented

[English](2026-08-18-openai-responses-strips-input-status.md) | 中文

## Problem

`pi-ai` 会把回放的 assistant 输出项序列化为 `status: completed`。OpenAI 接受这个可选字段，但部分 OpenAI 兼容网关会在 Responses 输入联合类型中拒绝它，并在多轮请求的 `input[n].status` 处失败。

## Decision

`dsh-llm-pi-ai` 为 `openai-responses` 请求提供 `onPayload` 重写。它只从发送中的 `input` 数组项目删除顶层 `status` 字段，保留 Harness 的持久消息和其他协议不变。重写发生在 provider payload 钩子中，因此不会修改已安装的 `pi-ai` 包。

## Alternatives considered

**把路由切回 chat completions。** 拒绝：当前配置模型可用的是网关的 Responses 协议，而 completions 流缺少终止原因。

**直接修改 `node_modules` 中的 `pi-ai`。** 拒绝：生成的依赖会被安装过程覆盖，兼容规则应由拥有该路由的 Harness 适配器负责。

**删除 Responses 输入中的所有未知字段。** 拒绝：工具调用 id 和回放元数据等字段对多轮工具配对是必需的；这里只删除网关拒绝的可选 `status`。

## Consequences

严格的 OpenAI 兼容网关现在可以接受带回放历史的 Responses 请求，同时不削弱持久回放，也不改变公开请求词汇。原生 OpenAI Responses 请求不会丢失必需输入，因为 `status` 是输出元数据；以后的网关专有不兼容仍需明确的兼容规则和回归测试。

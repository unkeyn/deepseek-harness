# @deepseek-ai/dsh-fork-compaction-policy

[English](README.md) | 中文

面向 Host 的自动压缩阈值与按会话上下文上限 settings provider，供 Web ContextMeter 与 preset-local 的 `compaction-basic` 后端共同使用。

## 行为

本包注册 `compaction-policy` settings namespace，提供两个相互独立的旋钮：

- `thresholdPercent`（25–95）——部署级的窗口百分比覆盖。`CompactionPolicy.thresholdRatio(fallback)` 在存在用户覆盖时返回比例，否则返回后端配置的比例。
- `sessionLimits`——可选的 `{ sessionId, limitTokens }` 列表，为每个会话声明一个绝对的 token 上限。`CompactionPolicy.limitTokens(sessionId)` 返回该会话的上限或 `undefined`。重复的会话 id 与低于 `MIN_SESSION_LIMIT_TOKENS`（1024）的取值都会被拒绝。

settings 值实时读取，因此下一次 `agent/pre-step` 压力检查会使用新的阈值或上限，无需重启 agent，也不会改变当前步骤。每个条目以会话 id 为键，因此各会话在切换与重启之后仍保留各自的上限；没有条目的会话继续使用纯窗口比例阈值。当两者同时存在时，`dsh-fork-compaction-basic` 以先生效的约束为准进行压缩。

浏览器通过标准 settings transport 写入该 namespace（ContextMeter 面板中的阈值滑杆与按会话限制选择器）。本 service 不提供面向模型的工具或提示段，不追加会话事件，也不影响模型请求组装。

## 模型体验

无；本包只向压缩 consumer 提供 Host 配置。

#### KV Cache 影响

无；本包不组装或发送模型请求。

## 已知限制与暂缓事项

- 已删除会话的条目会留在 section 中，直到通过设置移除；它们不会生效，但会在 `settings.yaml` 中累积。

# @deepseek-ai/dsh-compaction-policy

[English](README.md) | 中文

面向 Host 的自动压缩阈值 settings provider，供 Web ContextMeter 与 preset-local 的 `compaction-basic` 后端共同使用。

## 行为

本包注册 `compaction-policy` settings namespace，提供 25% 至 95% 的可选 `thresholdPercent` 字段。`CompactionPolicy.thresholdRatio(fallback)` 在存在用户覆盖时返回比例，否则返回后端配置的比例。settings 值实时读取，因此下一次 `agent/pre-step` 压力检查会使用新的阈值，无需重启 agent，也不会改变当前步骤。

浏览器通过标准 settings transport 写入该 namespace。本 service 不提供面向模型的工具或提示段，不追加会话事件，也不影响模型请求组装。

## 模型体验

无；本包只向压缩 consumer 提供 Host 配置。

#### KV Cache 影响

无；本包不组装或发送模型请求。

## 已知限制与暂缓事项

- 阈值是所有活跃 compaction backend 共享的全局用户偏好；不支持按会话设置阈值。

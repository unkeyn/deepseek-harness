# @deepseek-ai/dsh-fork-budget-context

[English](README.md) | 中文

面向模型的会话预算感知：当会话带有绝对上下文上限时，本插件向模型报告剩余预算，使其有节制地使用稀缺的窗口，而不是无意识地填满它。

## 行为

本插件注册一个名为 `session:budget` 的 `SystemPrompt.context()` 贡献。每次组装时实时读取：

- 来自可选 `ctx.compactionPolicy` 服务的会话上限（`limitTokens(sessionId)`，即 `compaction-policy` settings namespace 的 `sessionLimits` 条目）；
- 来自 `ctx.tokenMeter.measure()` 的会话计量用量。

当用量达到上限的 `adviseFromPercent`（默认 50%）后，该 context 会渲染一段固定文案：以 10% 为步长的用量区间、上限数值，以及具体的节流指引（工具输出与行文保持简短、不重复读取未变更文件、不复述已有内容）。区间化保证用量在同一区间内漂移时连续两次渲染完全一致，因此 runtime-context 投影不会追加任何新内容；跨越区间边界时恰好落入一条新的持久快照。

任一协作者缺席——没有 compaction policy 服务、该会话没有条目、或没有 token meter——都会渲染空文本，即不贡献任何内容。因此部署可以在 fork 压缩栈旁无条件挂载本插件。

该文案随标准 runtime-context 快照进入请求：一条持久的、带来源归属的 `user/message`，以追加方式进入模型请求且从不改写系统提示词，保留既有前缀的 KV-cache 复用。本插件不拥有任何事件、工具或服务。

## 配置

| 键 | 必需 | 含义 |
|---|---|---|
| `adviseFromPercent` | 否（默认 `50`） | 用量达到上限的这一百分比后开始出现提示；`[10, 90]` 内的 5 的倍数。 |

## 模型体验

会话超过其上限的一半（默认）后，模型可见的预算提示以稳定的区间措辞出现在请求中；未设上限的会话看不到任何内容。

#### KV Cache 影响

可复用前缀之后的追加式快照；相同区间措辞在两次跨域之间不追加任何内容。

## 已知限制与暂缓事项

- 文案只给出用量区间而非精确剩余 token；精确数字会在每一步变化并造成持久快照抖动。

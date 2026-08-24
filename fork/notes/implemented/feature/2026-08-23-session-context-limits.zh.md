# Agent Note：按会话上下文上限与预算感知压缩

Status: implemented

[English](2026-08-23-session-context-limits.md) | 中文

## 问题

fork 中唯一的用户侧上下文控制是 ContextMeter 面板里的部署级 `thresholdPercent` 滑杆：一个全局偏好，按同一比例缩放所有模型的窗口，被所有会话共享。用户无法让某个会话生活在较小的 token 上限内、同时另一个会话不受约束；而且所选阈值不会以任何形式到达模型——被要求保持小巧的会话仍会全速填满上下文，直到 `agent/pre-step` 压缩触发时才撞上约束。切换会话也意味着丢失原本想要的限制。

## 决策

三个协作部件，全部落在既有 seam 上；official 树保持逐字节不变。

`dsh-fork-compaction-policy`（settings 所有者）在 `thresholdPercent` 旁增加第二个独立旋钮：同一 `compaction-policy` namespace 中的 `sessionLimits` 列表（`{ sessionId, limitTokens }` 条目）。选择 settings 而非新建存储，是因为该 namespace 已经有接入两个 consumer 的实时读取接线，文件 provider 使其跨宿主重启持久化，浏览器也已绑定过这一 section 的 scope；以持久会话 id 为键，天然使每个会话拥有自己的持久值。服务在不改变的 `thresholdRatio(fallback)` 旁新增 `limitTokens(sessionId)`，拒绝重复 id 与低于 1024 token 的上限——低于该下限任何保留预算都无法塞进阈值之下。

`dsh-fork-compaction-basic` 在解析预算处消费该上限：`resolveSessionSpec(policy, contextWindow, limitTokens)` 取 `threshold = min(window × ratio, cap × 0.95)`，并把保留预算钳制到生效阈值的一半。这里有两个刻意的决定。钳制是承重的：没有它，小于窗口比例保留的上限会让 `resolveCompactSpec` 抛出 `TargetPressureConfigError`，而 pre-step listener 会把它当作 warn-once-then-disable——恰恰是那些要求小上限的会话会静默失去自动压缩。5% 余量则是有意拒绝"恰好在上限处触发"：压缩只在步与步之间运行，摘要调用本身也要消耗上限余量，正贴着墙触发是经典的失败模式（Claude Code 的 "auto-compact does not trigger at 100%" 报告最终以会话死亡收场；主流 harness——OpenHands ~80%、Hermes ~85%、Upsonic 默认 0.9——为此都预留缓冲）。采用固定内部比例而非新增配置旋钮：它保护的是一条不变量（保持在上限之内），而不是在调部署行为。

`dsh-fork-budget-context`（新包）解决填充速率的另一半。它注册一个 `SystemPrompt.context()` 渲染器：用量超过上限一半（可配置）后，以 10% 步长报告用量区间并给出固定的节流指引。runtime-context 快照本就是模型可见时变文本的正确传输层：持久、追加在可复用前缀之后、仅在变化时落地——而区间化正是"仅在变化时"成立的前提，漂移的电表不会每步追加一条消息。

ContextMeter 面板增加按会话的限制选择器（关闭 + 小于当前路由窗口的预设；来自 `settings.yaml` 的非预设值原样展示而非静默归一）。上限生效时，标题百分比、圆环与数字都改读相对上限的值，因为上限才是触发该会话压缩的东西；未设上限时所有数字保持原有的窗口相对含义——official 衍生行为只在新功能适用的地方发生变化。

## 考虑过的替代方案

**新 RPC + 以会话 id 为键的服务端 KV 存储**（`credential-pool-store` 模式）。暂不采纳：它会为 settings transport 已经端到端承载的数据添加 wire 面、schema 与客户端管线，而且该限制在语义上就是它旁边的阈值一样的用户偏好。

**用会话日志事件携带上限。** "模型可见 ⟺ 已记录"已经通过快照消息覆盖了提示文案；上限本身不进入请求，为它记录事件只会用重放保真换来 settings 更简单的恢复方式。

**窗口百分比式上限。** 百分比在用户把会话切到不同模型时会静默改变含义；绝对上限陈述的是用户真正想要的约束（"保持在 ~32k 以内"），与路由无关。

## 后果

优先级已文档化并强制执行：按会话上限 > 全局百分比 > 后端配置比例，在压力时刻以 min 合成；溢出恢复与 `compactNow()` 不受影响。fork bundle 新增一行（`budget-context`），其渲染器在没有 policy 服务或没有上限时完全惰性，因此可以无条件挂载。被删除会话的条目会留在 `settings.yaml` 中直到通过设置移除——不生效，但会累积。

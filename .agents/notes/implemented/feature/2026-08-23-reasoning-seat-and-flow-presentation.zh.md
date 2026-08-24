# Agent Note: 推理呈现席位与共享的 flow 动效语言

Status: implemented

[English](2026-08-23-reasoning-seat-and-flow-presentation.md) | 中文

## 问题

Think 行把推理渲染为原始文本，模型输出的 `**强调**` 以字面星号到达用户，折叠摘要也有同样的缺陷。composer 周围的各个表面各有各的出现行为：todo 条与目标栏直接弹入 dock 列，提问接管卡片毫无过渡地出现，其选项整块绘制。宽的 markdown 表格可以滚动，但读者一旦向下或向侧向移动，表头行就消失了。

## 决策

- **推理呈现是席位，不是私有组件。** ui-conversation 的 assistant-step 条目声明会话级 single 席位 `conversation.chat.reasoning`（owner props：块文本、流式尾部标记、locale 席位），AssistantMarkdown 把每个推理块经它派发，并以内置 Think 行作为 `fallback`——即 commandview 模式。零注册时推理照常可见，呈现插件注册一个组件即可升级所有块。
- **随附的呈现器是新插件 `@deepseek-ai/dsh-client-ui-reasoning`。** 它的 ThinkRow 用 `MarkdownInline` 渲染折叠摘要、用 `MarkdownText`（流式感知）渲染展开正文，两处都真实渲染强调、行内代码与链接。块流式时，三个错峰的圆点在跟随的摘要尾旁脉冲；展开/收起走 grid-rows `0fr → 1fr` 过渡并配旋转箭头，取代挂载切换；折叠正文通过与时序结束对齐的 visibility 翻转离开无障碍树。每个动画片段都有 `prefers-reduced-motion` 开关。移除 roster 行即恢复基线行。
- **一个动效词汇拥有「出现」。** ui-theme 的 base 表定义 `--dsw-ease-flow`（ease-out 曲线）、`--dsw-duration-flow` 与 `--dsw-motion-rise`。todo 条、目标栏与提问接管卡片挂载时以该曲线升入位置；提问选项以短促错峰波浪到达，并在第八行封顶；todo 箭头旋转到展开态而非替换图标。颜色与悬停过渡仍用既有 ease 令牌。
- **表格保持读者定位。** markdown 样式把每张表格拉伸到消息列宽（`width: 100%`），并把表头行钉住（`position: sticky`，垫在不透明 flow 背景上），于是长表在转录滚动时保住表头，宽表在自身横向滚动时也保住表头。
- **`MarkdownInline` 与原始行助手住在 ui-primitives。** `renderInlineLine` 把一行授权 markdown 渲染为 phrasing 内容——段落子节点拼接、非段落块丢弃——并沿用文档渲染器的不可信输出策略；`firstRawLine`/`latestRawLine` 为自行渲染摘要行的调用方切行。基线回退行消费同一批组件，因此无论插件在否，星号泄漏都已修复。
- **ui-primitives 把 `@testing-library/react` 声明为 devDependency。** 该包的组件测试必须经包自身的依赖上下文解析 React 与测试库；fork 工作区开始持有提升的 react store 链接后，原先的根级解析会在同一测试进程中产生两个 React 实例（首个 hook 上 dispatcher 为 null）。

## 否决的替代方案

- **遮蔽 `assistant-step` chat-node 键**以替换整条消息渲染器：为改一种块类型而分叉 text/image/tool-block 循环；席位加回退的形状给出同样的升级路径而无重复。
- **让表格越出消息列变宽**（free-code-tauri 的处理）：harness 的消息本已横跨整个内容列，没有更窄的文本度量可供外溢；粘性表头在无负 margin 几何的情况下提供同样的可读性。
- **dock 卡片的退场动画**：优雅离场需要 dock 渲染点的延迟卸载机制；没有第二个消费方时，挂载侧的升入独自承载该语言。

## 覆盖

`ui-reasoning` 钉住 ThinkRow 的 markdown 渲染、切换与键盘路径、流式摘要/圆点生命周期与滚动跟随行为，以及插件在真实 cordis Context 上的注册与 HMR 卸载。`ui-primitives` 钉住 `MarkdownInline`/`renderInlineLine`（强调、代码、链接策略、html 字面量、空白与非段落丢弃）与原始行助手。ui-conversation 的推理测试经席位派发驱动回退路径。

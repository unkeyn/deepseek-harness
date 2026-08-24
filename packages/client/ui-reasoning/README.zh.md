# @deepseek-ai/dsh-client-ui-reasoning

[English](README.md) | 中文

推理呈现插件（浏览器侧）：向 ui-conversation 的 assistant-step 条目为每个推理块声明的 `conversation.chat.reasoning` 席位注册 `ThinkRow` 呈现器。该席位的回退是 ui-conversation 内置的 Think 行，因此从组合中移除本插件（删掉 roster 行）即可恢复基线呈现——本包只做升级，不拥有数据。块文本、流式尾部标记与 locale 席位都在派发时以 owner props 到达；插件不持有 store，不监听任何事件。

相对回退的升级点：折叠摘要行与展开正文通过共享的 `MarkdownInline`/`MarkdownText` 管线渲染真正的 markdown（强调、行内代码、链接正常呈现，原始 `**` 不会到达用户），流式时摘要尾部跟随并显示三个活动进度点，展开/收起走 grid-rows 高度过渡并带旋转箭头，整个披露行以共享的 flow 动效令牌入场。每个动画片段都有 `prefers-reduced-motion` 开关。

## Model Experience

无。该行是对模型已产出推理的呈现；不新增提示词内容、工具或会话事件。

#### KV Cache effect

无。

## Known Limitations and Deferred Work

- **流式摘要为纯文本范围** —— 跟随的摘要行渲染行内 markdown，但增量流式解析器只服务正文；流式中途的不完整强调标记会在摘要中按字面呈现，直到该行完成。

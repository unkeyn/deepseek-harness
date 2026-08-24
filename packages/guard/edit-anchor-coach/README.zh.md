# @deepseek-ai/dsh-edit-anchor-coach

[English](README.md) | 中文

面向字符串锚点编辑器的 pre-execute 教练插件：在 `edit` 调用分发之前，用工具自身的精确匹配规则对照文件**当前**文本预判这次调用是否会失败；对注定失败的调用，用可修正的反馈替代工具的生硬拒绝——锚点实际出现的位置（行号，受 `maxSuggestions` 截断并附总数）、存在哪种纯空白变体（逐行归一化比较）、或锚点大概率想指向哪些现有行（词元重叠，平分时按行号稳定排序）。工具本会接受的调用绝不会被延迟或拒绝。修复决策完全留给模型。

## 配置

```yaml
- id: edit-anchor-coach
  name: '@deepseek-ai/dsh-edit-anchor-coach'
  config:
    tools: ['edit']          # default; tool-name patterns to coach (`*` wildcards)
    maxSuggestions: 3        # default; candidate locations quoted in one denial
    previewChars: 200        # default; per-snippet quote cap
    maxFileBytes: 2000000    # default; larger files pass through unanalyzed
```

任何数值字段在插件加载时遇到非整数或小于 1 的值都会响亮失败。`tools` 条目是对调用时工具名的谓词，不是对注册表条目的引用——匹配不到任何已注册工具的模式是合法的。

## 判定语义

教练用与编辑工具相同的事实重新推导判定，因此一次拒绝恰好等于一次「注定失败的调用」，只是错误信息里带上了修法：

- **逐字匹配且仅一处** —— 原样放行，由工具执行。
- **逐字匹配多处且未设 `replace_all`** —— 拒绝并列出全部引用位置（`lines 1, 2, 3 — 4 locations total`）与两条出路：为 `old_string` 扩充上下文，或设置 `replace_all: true`。
- **无逐字匹配但存在纯空白变体** —— 拒绝并列出变体位置及其当前文本（按 `previewChars` 截断引用）；提示模型重新读取并逐字复制。
- **归一化后仍无匹配** —— 按共享词元给出最接近的现有行（长度小于 3 的词元永不算作特征），或明确说明「没有任何行与锚点相似」。
- **路径不可读、文件超大、锚点为空、参数畸形** —— 不做分析直接放行；这些拒绝归工具所有。

拒绝通过 pre-execute 的 `deny` 决策传递，模型看到的是作为调用错误结果的 `Error: edit-anchor-coach: …`——与工具自身拒绝相同的通道，只是提前一轮就有用。

## Model Experience

### 被拒绝的歧义锚点

#### 模型看到什么

```markdown
Error: edit-anchor-coach: old_string matches 2 locations in <path> (lines 1, 3). Extend old_string with surrounding context so it matches exactly once, or set replace_all: true to replace every occurrence.
```

#### Token 影响

放行的调用零 token。每条拒绝以有界诊断替代工具更短的拒绝（数据相关文本受 `maxSuggestions` × `previewChars` 约束）。

#### KV Cache 影响

仅追加的错误结果；不会使可复用请求前缀失效。

## 已知限制与暂缓事项

- **仅精确与归一化匹配** —— 不做模糊补丁合成；教练负责定位，不会替模型改写 `old_string`。
- **单文件视角** —— 由其他位置的未保存修改导致的过期锚点不在范围内。
- **假定文本文件** —— 二进制内容按 UTF-8 读出的候选毫无意义；超大文件直接绕过分析。
- **仅事实上的建议** —— 它不能接受、改写或快进编辑；pre-execute 接缝在设计上排除了输入改写。

# @deepseek-ai/dsh-fork-web

[English](README.md) | 中文

**`WebRuntime`**（`ctx.web`）定义 harness 具备哪些 web 访问能力（搜索 web、抓取 URL），并通过多个提供方实现，不把模型约定绑定到某个厂商的 API 形状。

本包承担 web 能力的 Service Definition 角色。与 shell/fs 不同，它在一个 seam 上跨越搜索与抓取两种操作，每种操作都可能有多个提供方：

| 包 | 职责 |
|---|---|
| `@deepseek-ai/dsh-fork-web`（本包） | Service Definition：服务、提供方注册表、选择策略、请求／结果词汇、`WebError` 分类体系 |
| `@deepseek-ai/dsh-fork-web-search-brave` | 搜索提供方：Brave |
| `@deepseek-ai/dsh-fork-web-search-firecrawl` | 搜索提供方：Firecrawl |
| `@deepseek-ai/dsh-fork-web-search-pool` | 搜索提供方：用户配置的通用 HTTP 池，支持逐密钥轮换（`custom-pool`） |
| `@deepseek-ai/dsh-fork-web-fetch-http` | 抓取提供方：匿名公共 HTTP(S) |
| `@deepseek-ai/dsh-tool-web` | Consumer：面向模型的 `web_search`／`web_fetch` 工具 schema，构建于 `ctx.web` 之上 |

搜索与抓取没有共享请求 schema 或业务逻辑，但有意共用一个 seam：`ctx.web` 是单一 web 访问中间层，拥有一项提供方选择策略、一套中止／错误词汇和一个面向产品的「该 harness 如何访问 web」配置接口。成对的 `Search`／`Fetch` 方法保持并行是有意为之。

## 服务 API（`ctx.web`）

| 成员 | 语义 |
|---|---|
| `registerSearchProvider(provider)`／`registerFetchProvider(provider)` | 注册后端。同一能力类型下 id 重复时抛出 `WebError` `WEB_DUPLICATE_PROVIDER`。返回 disposer。随调用 fiber 一并 dispose（资源释放）。 |
| `search(request, signal?)` | 解析搜索提供方并运行一次搜索。在结果上强制执行 `request.maxResults`（截断 `sources[]`，设置 `truncated`）。能力无法运行时抛出 `WebError`。 |
| `fetch(request, signal?)` | 解析抓取提供方并获取一个 URL。非 2xx 响应是结果，不会抛出异常。无法安全获取或表示资源时抛出 `WebError`。 |

提供方注册的是**能力**而非工具。`dsh-tool-web` 是面向模型的名称、描述、提示词指引、JSON Schema 和呈现的唯一归属方。

## 选择

选择绝不依赖注册、配置或 HMR（热模块替换）顺序。能力要么具有显式路由，要么在恰好只注册一个可用提供方时自动选择。对搜索而言，`searchProviders` 声明一条按序回退路由（先到先试）；路由中已注册但不可用的成员会被跳过，抛错的成员会把执行移交到下一个条目（取消除外）。单 id 配置（`searchProvider`／`fetchProvider`，或由环境变量 `$DSH_WEB_SEARCH_PROVIDER[S]`／`$DSH_WEB_FETCH_PROVIDER` 提供相同字段）等价于一条单成员路由。`search()`／`fetch()` 在执行时解析：

| 情况 | 执行 |
|---|---|
| 已配置 id 已注册且 `available()` | 运行该提供方 |
| 已配置 id 未注册 | `WEB_PROVIDER_CONFIGURED_MISSING` |
| 已配置 id 已注册但不可用 | 多成员路由中跳过；否则 `WEB_PROVIDER_CONFIGURED_UNAVAILABLE` |
| 无 id，恰好一个已注册的可用提供方 | 运行该提供方 |
| 无 id，没有可用提供方 | `WEB_PROVIDER_UNAVAILABLE` |
| 无 id，多个可用提供方 | `WEB_PROVIDER_AMBIGUOUS` |

失败分支会抛出 `WebError`；调用方按其结构化 code（加消息细节：缺失 id、歧义候选集合）路由。提供方自身的 `available()` 是便宜的局部检查（凭据是否存在、配置是否可解析），供执行时选择使用，且**禁止发起网络调用**；`dsh-tool-web` 永远不会调用它。工具通过 `ctx.web.search()`／`fetch()` 执行，并按抛出的 code 路由，因此提供方选择只有一个归属方。

## 词汇

`WebSearchRequest`（`query`、`maxResults?`）→ `WebSearchResult`（`content?`、`sources[]`、`truncated`）；每个 `WebSearchSource` 都有必填 `url` 与可选 `title`／`snippet`／`publishedAt`（Perplexity 引用可能只含 URL）。`WebFetchRequest`（`url`）→ `WebFetchResult`（最终 `url`、`statusCode`、`body`、`truncated`）；取消作为可选的直接 `AbortSignal` 参数传给 `search()`／`fetch()`。`WebFetchBody` 是这里拥有的封闭判别联合（`html` | `text`）；消费方使用 `switch` 实现穷尽检查，因此新增类型会导致编译失败，直到处理完毕。完整约定见 `src/types.ts`，其中也包含 `WebError` code 分类体系。

## 模型体验

通过 `dsh-tool-web` 间接影响；该工具会保留有界的规范化提供方数据，或者原样保留以下失败：已配置的提供方缺失、提供方不可用、无提供方、存在多个提供方以及 `Error: <message>`。服务还会贡献一节与提供方无关的系统提示词（`web:research`），陈述研究方法论：先搜索，再抓取被引页面验证关键论断；优先并交叉验证一手来源；已知 URL 直接抓取而非再次搜索；无法验证的论断要明确标注。它假设组合同时暴露 `web_search` 与 `web_fetch`（所有随附的 fork 组合均如此）；去掉某个工具的组合应自行替换或移除该节。

#### KV Cache 影响

挂载 system-prompt 服务时，`web:research` 一节会向每个模型请求前缀加入其固定文本；其余变更由上述消费方负责。

## 已知限制与暂缓事项

- **没有观测接口**：没有提供方变更事件或能力状态查询；可用性只能通过执行 `search()`／`fetch()` 并按抛出的 `WebError` code 路由来观测，无提供方失败是通用的 `WEB_PROVIDER_UNAVAILABLE`，不会枚举逐提供方原因（见 [Agent Note](../../../.agents/notes/archived/simplification/2026-07-04-drop-unconsumed-web-observation-surface.md)）。
- **`WebSearchRequest` 只携带 `query` + `maxResults`**：提供方无关的控制项（新近程度、域名过滤条件、区域提示、搜索深度）暂缓至 Exa 与 Perplexity 都能诚实支持时（见 [seam Agent Note](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md)）。
- **`WebFetchBody` 没有 `pdf` 分支**：可提取文本的 PDF 支持属于明确的暂缓工作；封闭联合会使新增该分支成为三个 web 包中由编译强制执行的变更。
- **提供方支持的页面提取不属于 `fetch()` 范围**：Firecrawl/Tavily 风格的 `web_extract` 能力暂缓，而不会扩展抓取操作。

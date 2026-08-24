# Agent Note: 补全 Web 研究能力

Status: implemented

[English](2026-08-23-web-research-capability.md) | 中文

## 问题

fork 注册了支持密钥轮换的搜索池，但从未接入路由：随附组合配置的是 `searchProvider: deepseek-official`，UI 里配置的 `custom-pool` 密钥完全不生效。seam 没有抓取提供方，基础组合又以 `fetch: false` 运行 `tool-web`，模型永远读不到被引页面——搜索摘要就是它 web 访问的天花板。Brave、Exa、Firecrawl 设置卡片写入的命名空间没有任何已挂载的宿主插件提供服务（这一缺陷继承自上游）；而 `searchProvidersByTask` 没有任何调用方：没有消费方能给请求设置 `task`。

## 决策

**默认路由接入池。** fork overlay 现在配置 `searchProviders: [custom-pool, deepseek-official]`。空池、耗尽、冷却中或未配置的池以 `available() === false` 报告自身，在多成员路由中被跳过，由官方 DeepSeek 提供方应答；符合条件的池密钥优先使用。

**交付抓取能力。** 官方匿名 HTTP(S) 抓取提供方的 fork 移植版（`@deepseek-ai/dsh-fork-web-fetch-http`) 以 id `http` 注册；官方 `tool-web` 行被替换（`tool-web-fork`）且不再带 `fetch: false`，`web_fetch` 因此对模型可见。仅同源重定向、字节／字符上限与显式产品 User-Agent 均自上游实现继承。

**教授方法论，而非供应商。** seam 服务贡献一节与提供方无关的系统提示词（`web:research`）：摘要是发现辅助——先抓取被引页面再采信；优先一手来源；跨独立来源交叉验证；已知 URL 不要重复搜索；无法验证的论断要标注。各提供方的差异留在适配器里，与参考设计「面向模型的提示词只提能力、不提厂商」的规则一致。

**删除死接口。** `WebSearchTask`、`searchProvidersByTask` 与请求级 `task` 字段连同测试一起从 fork seam 中移除。设置 UI 中孤立的 Brave／Exa／Firecrawl 卡片、控制器与语言包被移除；DeepSeek 卡片（有服务命名空间）和 Models 页的池面板保留。

## 已考虑的替代方案

**为每个 fork 提供方接线真实 settings section 以救活孤立卡片。** 否决：这是逐提供方的定制工作，且与池面板重复——后者已经覆盖 Firecrawl、Brave 和 Exa 预设及只写密钥。

**为未来调用方保留 task 路由。** 否决：没有任何东西能设置 `task`，未被行使的路由面只会招来未经测试的选择路径。

**在移植抓取时顺带加入 SSRF 内网防护。** 连同上游包的文档化限制一并暂缓；修改该策略属于上游所有者，测试也在那边。

## 后果

深度研究从此形成闭环：`web_search` 经用户池或官方提供方找到来源，`web_fetch` 读取它们，常驻提示词节强制「先验证后引用」。pool README 的路由声明由愿景变为事实；seam README 记录了有序路由语义和新提示词节的 KV-cache 成本。

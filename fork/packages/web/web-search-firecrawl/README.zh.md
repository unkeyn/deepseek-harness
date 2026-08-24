# @deepseek-ai/dsh-fork-web-search-firecrawl

[English](README.md) | 中文

Firecrawl Search 的 `ctx.web` 提供方。设置 `apiKey` 或 `FIRECRAWL_API_KEY`；空密钥会使提供方不可用。`baseURL` 可选，默认使用公开 Firecrawl 搜索端点。带有非空描述的结果会映射为标准来源；HTTP、网络、响应体解析和取消失败使用 `WebError`。

```yaml
- id: web-search-firecrawl
  name: '@deepseek-ai/dsh-fork-web-search-firecrawl'
  config:
    apiKey: !!js process.env.FIRECRAWL_API_KEY
```

## Model Experience

通过 `dsh-tool-web`，搜索向模型暴露可移植的 URL、标题和摘要；凭据与提供方私有错误不会进入模型上下文。

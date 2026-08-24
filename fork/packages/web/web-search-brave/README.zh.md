# @deepseek-ai/dsh-fork-web-search-brave

[English](README.md) | 中文

Brave Search 的 `ctx.web` 提供方。设置 `apiKey` 或 `BRAVE_API_KEY`；空密钥会使提供方不可用。`baseURL` 和 `model` 可选，默认使用公开 Brave 端点与 `brave-search`。提供方将非空描述映射为标准来源，并通过 `WebError` 报告 HTTP、网络、响应体解析和取消失败。

```yaml
- id: web-search-brave
  name: '@deepseek-ai/dsh-fork-web-search-brave'
  config:
    apiKey: !!js process.env.BRAVE_API_KEY
```

## Model Experience

通过 `dsh-tool-web`，搜索向模型暴露 URL、标题、摘要和可选发布时间；凭据和提供方错误不会进入模型上下文。

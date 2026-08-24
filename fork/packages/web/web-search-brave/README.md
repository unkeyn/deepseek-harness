# @deepseek-ai/dsh-fork-web-search-brave

English | [中文](README.zh.md)

Brave Search provider for `ctx.web`. Set `apiKey` or `BRAVE_API_KEY`; an empty key makes the provider unavailable. `baseURL` and `model` are optional and default to the public Brave endpoint and `brave-search`. The provider maps non-empty result descriptions to normalized sources and reports HTTP, network, malformed-body, and cancellation failures through `WebError`.

```yaml
- id: web-search-brave
  name: '@deepseek-ai/dsh-fork-web-search-brave'
  config:
    apiKey: !!js process.env.BRAVE_API_KEY
```

## Model Experience

Through `dsh-tool-web`, searches expose URLs, titles, snippets, and optional publication ages. Provider credentials and errors remain outside model context.

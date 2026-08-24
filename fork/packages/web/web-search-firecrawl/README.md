# @deepseek-ai/dsh-fork-web-search-firecrawl

English | [中文](README.zh.md)

Firecrawl Search provider for `ctx.web`. Set `apiKey` or `FIRECRAWL_API_KEY`; an empty key makes the provider unavailable. `baseURL` is optional and defaults to the public Firecrawl search endpoint. Results with non-empty descriptions become normalized sources; HTTP, network, malformed-body, and cancellation failures use `WebError`.

```yaml
- id: web-search-firecrawl
  name: '@deepseek-ai/dsh-fork-web-search-firecrawl'
  config:
    apiKey: !!js process.env.FIRECRAWL_API_KEY
```

## Model Experience

Through `dsh-tool-web`, searches expose portable URLs, titles, and snippets. Credentials and provider-private errors stay outside model context.

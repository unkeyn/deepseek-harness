---
name: firecrawl-developer-index
description: Search issues, merged pull requests, READMEs, and documentation. Use when the question is how a library or API behaves, what an error means, or whether a bug was fixed; prefer this over a general web page.
---

# Firecrawl Developer Index

Answer a developer question from the primary source: the issue where the bug was reported, the merged pull request that fixed it, the README or documentation page that states the contract.

There is **no fixed recipe**. Read the question, decide what kind it is, and choose the approach below.

## The tools, and what each is uniquely good at

- HTTP: **`GET|POST https://api.firecrawl.dev/v2/search/developer`**
  MCP: **`firecrawl_developer_search(query, k?, skills?)`**
  CLI: **`firecrawl developer <query> [--limit <n>]`**
  Ranked results over the whole index. Each carries `id` (`issue:owner/repo#123`), `url`, and the **matched passages in markdown**, so tables and code blocks survive.

- MCP: **`firecrawl_search(query, categories: ["developer"])`**
  CLI: **`firecrawl search <query> --categories developer`**
  Developer hits in a `developer` group beside `web`.

- MCP: **`firecrawl_scrape(url)` / `firecrawl_search(query)`**
  CLI: **`firecrawl scrape <url>` / `firecrawl search <query>`**
  General web fetch and search, for what no primary source states.

## Filters, and what each one costs you

Only the HTTP surface takes these. On `GET`, pass `types=issue,pull_request` or repeat the parameter; on `POST`, pass arrays. All are optional.

- `types` — which of `doc`, `issue`, `pull_request`, `readme` to search. Defaults to all four.
- `repos` (`owner/name`) scopes the repository half, meaning `issue`, `pull_request`, and `readme`; `sources` (documentation source ids, at most 20) scopes the documentation half, meaning `doc`.
- `passages` (1–5, default 1) is the _maximum_ passages per result, not a guarantee.
- `language`, `topic`, `license`, `min_stars`, `max_stars`, `archived`, `fork` describe a **repository**.

## Match the approach to the question

- **Literal error message or stack-trace string** → search the string itself plus the library name, with `types=["issue","pull_request"]`.
- **Conceptual "how do I do X"** → the full question in natural language, all four types. The answer is usually a `doc` or a `readme`; raise `passages` before raising `k`.
- **Known bug** → the issue reports it, the merged pull request _fixes_ it.
- **API contract** ("what does X return", "is Y required", "what is the default") → `readme` and `doc` are authoritative and a blog post is not. Use `types=["readme","doc"]`.
- **Version-specific behaviour** → an issue's opening report describes the broken version; its resolution supersedes it.
- **Scoped to one library** → `repos=["owner/name"]` when you know the slug, plus `sources` if you want its docs in the same call.
- **Ecosystem-wide** ("which libraries do X", "who else hit this") → no scope.

## Principles

- **Quote the passage, cite the `url`.** The passages are the evidence; hand them over rather than paraphrasing them into a claim the reader can't check.
- **A merge supersedes a report.** When an issue and a pull request disagree, the merged pull request is the current behaviour.
- **Scope last, not first.** Search the whole index, then narrow with `types`, `repos`, or `sources` once you know what the hits look like.
- **Go to the web when the index has nothing to say.**

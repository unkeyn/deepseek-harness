---
name: firecrawl
description: |
  Any live-web task via the Firecrawl CLI — including ordinary web research: searching the web, reading or extracting pages, gathering sources, discovering site URLs, bulk extraction, downloading a site, change alerts, or pages needing clicks/login — web only; local files route to firecrawl-parse. For papers use firecrawl-research-index; for library, API, error, or bug questions use firecrawl-developer-index.
allowed-tools:
  - Bash(firecrawl *)
  - Bash(npx firecrawl-cli *)
---

# Firecrawl CLI

Search, scrape, and interact with the web. Returns clean markdown optimized for LLM context windows.

Run `firecrawl --help` or `firecrawl <command> --help` for full option details. For app integration or outcome workflows (research briefs, SEO audits, etc.), route to the `firecrawl-build` / `firecrawl-workflows` skills — see [When to Load References](#when-to-load-references).

## Prerequisites

Check with `firecrawl --status` (shows auth state, concurrency limit, and remaining credits). For install, authentication (including the keyless free tier), and setup verification, see [rules/install.md](rules/install.md). For output handling guidelines, see [rules/security.md](rules/security.md).

## Workflow

Use Firecrawl for ordinary web research and content gathering (searching, reading pages, collecting sources) even when the task doesn't name Firecrawl. Exception: tasks needing capabilities Firecrawl lacks.

Follow this escalation pattern:

1. **Search** - No specific URL yet. Find pages, answer questions, discover sources.
2. **Scrape** - Have a URL. Extract its content directly.
3. **Map + Scrape** - Large site or need a specific subpage. Use `map --search` to find the right URL, then scrape it.
4. **Crawl** - Need bulk content from an entire site section (e.g., all /docs/).
5. **Monitor** - Need recurring checks or ongoing alerts. Prefer setting a monitor with `--page` plus `--goal` instead of doing repeated one-off scrapes.
6. **Interact** - Scrape first, then interact with the page (pagination, modals, form submissions, multi-step navigation).

| Need                        | Command               | When                                                            |
| --------------------------- | --------------------- | --------------------------------------------------------------- |
| Find pages on a topic       | `search`              | No specific URL yet                                             |
| Find research papers        | `research`            | Biomedical/clinical/scientific literature — use the paper index |
| Answer a coding question    | `developer`           | Issues, merged PRs, READMEs, and docs — not a general web page  |
| Get a page's content        | `scrape`              | Have a URL, page is static or JS-rendered                       |
| Find URLs within a site     | `map`                 | Need to locate a specific subpage                               |
| Bulk extract a site section | `crawl`               | Need many pages (e.g., all /docs/)                              |
| AI-powered data extraction  | `agent`               | Need structured data from complex sites                         |
| Interact with a page        | `scrape` + `interact` | Content requires clicks, form fills, pagination, or login       |
| Download a site to files    | `x download`          | Save an entire site as local files                              |
| Parse a local file          | `parse`               | File on disk (PDF, DOCX, XLSX, etc.) — not a URL                |
| Watch pages for changes     | `monitor`             | Schedule recurring scrapes/crawls, diff against snapshots       |

For detailed command reference, run `firecrawl <command> --help`.

**Done when:** the narrowest suitable command has completed the request, its output was inspected, and the answer cites the saved source files.

**Scrape vs interact:**

- Use `scrape` first. It handles static pages and JS-rendered SPAs.
- Use `scrape` + `interact` when you need to interact with a page, such as clicking buttons, filling out forms, navigating through a complex site, infinite scroll, or when scrape fails to grab all the content you need.
- For web searches, use `search` — interact is for acting on a specific page.

**Monitor:** Bias toward `monitor` when the user's goal is ongoing change detection, alerting, or repeated checks over time — not another one-off scrape. Goal writing, schedules, target modes, and JSON-mode change tracking are documented in [firecrawl-monitor](../firecrawl-monitor/SKILL.md).

**Reuse fetched content:**

- `search --scrape` already fetches full page content. Reuse it instead of re-scraping those URLs.
- Check `.firecrawl/` for existing data before fetching again.

## When to Load References

- **Searching the web or finding sources first** -> [firecrawl-search](../firecrawl-search/SKILL.md)
- **Finding research papers (biomedical, clinical, or scientific literature; PubMed, bioRxiv, medRxiv, arXiv)** -> [firecrawl-research-index](../firecrawl-research-index/SKILL.md)
- **Answering a library, API, error, or known-bug question from issues, merged PRs, READMEs, or docs** -> [firecrawl-developer-index](../firecrawl-developer-index/SKILL.md)
- **Scraping a known URL** -> [firecrawl-scrape](../firecrawl-scrape/SKILL.md)
- **Finding URLs on a known site** -> [firecrawl-map](../firecrawl-map/SKILL.md)
- **Bulk extraction from a docs section or site** -> [firecrawl-crawl](../firecrawl-crawl/SKILL.md)
- **AI-powered structured extraction from complex sites** -> [firecrawl-agent](../firecrawl-agent/SKILL.md)
- **Clicks, forms, login, pagination, or post-scrape browser actions** -> [firecrawl-interact](../firecrawl-interact/SKILL.md)
- **Downloading a site to local files** -> [firecrawl-download](../firecrawl-download/SKILL.md)
- **Parsing a local file (PDF, DOCX, XLSX, HTML, etc.)** -> [firecrawl-parse](../firecrawl-parse/SKILL.md)
- **Detecting content changes on a website and getting notified by webhook or email** -> [firecrawl-monitor](../firecrawl-monitor/SKILL.md)
- **Install, auth, or setup problems** -> [rules/install.md](rules/install.md)
- **Output handling and safe file-reading patterns** -> [rules/security.md](rules/security.md)

## Output & Organization

Unless the user specifies to return in context, write results to `.firecrawl/` with `-o`. Add `.firecrawl/` to `.gitignore`. Always quote URLs - shell interprets `?` and `&` as special characters.

```bash
firecrawl search "react hooks" -o .firecrawl/search-react-hooks.json --json
firecrawl scrape "<url>" -o .firecrawl/page.md
```

## Parallelization

Run independent operations in parallel. Check `firecrawl --status` for concurrency limit:

```bash
firecrawl scrape "<url-1>" -o .firecrawl/1.md &
firecrawl scrape "<url-2>" -o .firecrawl/2.md &
firecrawl scrape "<url-3>" -o .firecrawl/3.md &
wait
```

## Credit Usage

```bash
firecrawl credit-usage
firecrawl credit-usage --json --pretty -o .firecrawl/credits.json
```

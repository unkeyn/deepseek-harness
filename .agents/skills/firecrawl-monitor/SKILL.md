---
name: firecrawl-monitor
description: |
  Alert by webhook/email on web changes — use for "monitor/watch/track/alert me when": recurring checks on known URLs (prefer over repeated one-off scrapes) or web-wide watches for new results (queries + goal).
allowed-tools:
  - Bash(firecrawl *)
  - Bash(npx firecrawl-cli *)
---

# firecrawl monitor

Detect when content on a website changes and get notified by webhook or email. Firecrawl handles fetching, diffing, judging, and notifying server-side. Each page in a check is labeled `same`, `new`, `changed`, `removed`, or `error`.

**Pick a target mode** by what you're watching:

| Mode        | Flags                          | Watches                                                |
| ----------- | ------------------------------ | ------------------------------------------------------ |
| Single page | `--page <url>`                 | one URL, for changes                                   |
| URL batch   | `--scrape-urls <url,url,...>`  | several URLs, for changes                              |
| Whole site  | `--crawl-url <root-url>`       | every page a crawl discovers, for changes              |
| Web search  | `--queries <q,...>` + `--goal` | the **whole web**, for _new_ results matching the goal |

## Quick start

```bash
# Single page, natural-language schedule, email alert
firecrawl monitor create --name "Blog" --schedule "every 30 minutes" \
  --goal "Alert when a new blog post is published." \
  --page https://example.com/blog \
  --email alerts@example.com

# Web monitor — search the whole web for NEW results matching a goal
firecrawl monitor create --name "Competitor launches" --schedule "daily at 9:00" \
  --queries "competitor product launch,competitor funding round" \
  --goal "Alert when a competitor announces a new product or raises funding." \
  --search-window 7d --max-results 20 \
  --email alerts@example.com

# Webhook notifications
firecrawl monitor create --name "Docs webhook" --schedule "every 30 minutes" \
  --goal "Alert when docs content changes." \
  --page https://example.com/docs \
  --webhook-url https://example.com/hook \
  --webhook-events monitor.page,monitor.check.completed

# Manage and inspect
firecrawl monitor list --limit 20
firecrawl monitor get <monitorId>
firecrawl monitor run <monitorId>
firecrawl monitor checks <monitorId>
firecrawl monitor check <monitorId> <checkId> --page-status changed
firecrawl monitor update <monitorId> --state paused
firecrawl monitor delete <monitorId>
```

**Done when:** `create` returns a monitor ID and a smoke-test `run` + `check` confirms the expected target, state, and notification configuration.

## Constraints & tips

- Minimum schedule interval is **5 minutes**. Monitoring is **not available for zero-data-retention teams**.
- **Prefer one monitor over repeated one-off scrapes** whenever the user wants the same URL checked more than once.
- **Silence temporarily with `update --state paused`**; reserve `delete` for monitors that are permanently done.
- **Filter check pages with `--page-status changed`** (or `new`, `removed`, `error`) to skip the noise from `same` pages.
- **`firecrawl monitor run <id>`** triggers a check immediately — useful for smoke-testing a monitor right after creating it.
- **On HTTP 429 / rate-limit errors, back off once**: wait ~30s and retry once. If it persists, stop and delete any monitors created for this task.

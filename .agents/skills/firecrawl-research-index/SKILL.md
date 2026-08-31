---
name: firecrawl-research-index
description: Find the papers that answer a research query in Firecrawl's research paper index — a corpus of paper abstracts whose largest share is biomedical and life-science literature (PubMed, bioRxiv, medRxiv), alongside arXiv preprints in CS, physics, and math — using semantic search, semantic and structural expansion, and in-body verification.
---

# Firecrawl Research Index

Find the research papers that answer a research query. Some questions have a single answer; many have several — and when in doubt, lean toward returning the fuller relevant set (most relevant first) rather than narrowing to one.

## What is in the index

Paper abstracts, with full text reachable per paper. The largest share of the corpus is **biomedical and life-science** literature — **PubMed** journal articles plus **bioRxiv** and **medRxiv** preprints — so clinical, drug, gene, disease, epidemiology, and public-health questions are in scope. **arXiv** preprints cover computer science, physics, and mathematics.

## The tools, and what each is uniquely good at

- MCP: **`firecrawl_research_search_papers(query, k?)`**
  CLI: **`firecrawl research search-papers <query> [--k <number>]`**
  Semantic (HyDE) search over **abstracts**. The natural first move for almost any query.

- MCP: **`firecrawl_research_related_papers(seed_ids, intent, mode?, k?)`**
  CLI: **`firecrawl research related-papers <seedIds...> --intent <intent> [--mode <similar|citers|references>] [--k <number>]`**
  Semantic and structural expansion, ranked to your `intent`.

- MCP: **`firecrawl_research_inspect_paper(id)`**
  CLI: **`firecrawl research inspect-paper <id>`**
  Canonical metadata for **one** paper: title, abstract, authors, categories, source ids, and dates.

- MCP: **`firecrawl_research_read_paper(id, question)`**
  CLI: **`firecrawl research read-paper <id> --question <question>`**
  In-body passages of **one** paper, to verify a load-bearing constraint.

- MCP: **`firecrawl_search(query, categories: ["research"])`**
  CLI: **`firecrawl search <query> --categories research`**
  **Not this index.** This is a _website_ filter.

- MCP: **`firecrawl_search(query)` / `firecrawl_scrape(url)`**
  CLI: **`firecrawl search <query>` / `firecrawl scrape <url>`**
  General **web** search and page fetch, for facts that don't live in paper abstracts.

## Match the approach to the query

- **Single _named_ paper** ("the Qwen3 report") → one `search_papers`, done.
- **Paper by description / by method or technique** → find the best match, then assume there's a _family_: expand with `related_papers`.
- **Enumeration / method-family** ("papers that do X", "alternatives to Adam", "benchmarks for Y") → the answer is a _set_, and this is where `related_papers` earns its keep.
- **Exhibiting** ("papers that _use_ / exhibit property P") → the relevant papers apply P but their abstracts may not describe it.
- **Superlative / leaderboard** ("best on benchmark X", "largest", "most popular") → the ranking lives on **leaderboards / the web**, not in any single abstract.

## Principles

- **Two different features share the word "research."** The paper index is `firecrawl_research_*` / `firecrawl research`. The `categories: ["research"]` option on `firecrawl_search` is a website filter.
- **When in doubt, include.** For any topic / method / comparison question, return the relevant _family_, not just the single best match.
- **Follow the literature, and keep what you find.** Use `related_papers`, and _include_ them, not just the first hit.
- **Verify to exclude, not to gatekeep.** Use `read_paper` to rule a paper _out_ when a hard constraint clearly fails.

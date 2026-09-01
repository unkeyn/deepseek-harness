# Firecrawl CLI install and auth

The Firecrawl CLI is **not bundled** with this repository and is optional in
this deployment. Check whether it exists before reaching for it:

- `Get-Command firecrawl` (Windows PowerShell) or `firecrawl --status`.

If it is missing, prefer the **native search path** instead of installing it:

- `web_search` / `search_web` tools run the configured web-search provider pool
  (see `web_search_pool_status` for per-key health and remaining credits).
- `web_fetch` retrieves a known URL directly.
- The pool's Firecrawl credentials are stored in the harness credential store
  under the refs `FIRECRAWL_API_KEY` … `FIRECRAWL_API_KEY_4`; the pool plugin
  (`web-search-pool`) resolves them per search. Never copy key values into
  shell commands or files.

To install the CLI anyway, use the official Firecrawl distribution
(`npx firecrawl-cli <command>` per the skill's allowed tools), authenticate it
with one of the pool's key refs resolved through the credential store, and
verify with `firecrawl --status`. Spawning Node-based CLIs from tool shells is
subject to the harness file sandbox: a denied spawn is a policy answer, not a
broken install — escalate the exact command or fall back to the native tools.

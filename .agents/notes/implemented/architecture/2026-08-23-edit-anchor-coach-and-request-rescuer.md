# Agent Note: Edit-anchor coach and transient-request rescuer plugins

Status: implemented

English | [中文](2026-08-23-edit-anchor-coach-and-request-rescuer.zh.md)

## Problem

Session-log analysis across 103 recorded sessions (6,883 tool calls, 368 turns) showed two dominant failure classes. First, `edit` produced 369 tool errors — 200 stale anchors ("old_string was not found"), 45 ambiguous matches, plus path guessing — and the tool's bare refusal gave the model nothing to repair with, costing repeat blind attempts. Second, roughly 140 of 368 turns ended in provider errors; gateways answering 400 with transient vocabulary (`upstream_unavailable`) normalize to `INVALID_REQUEST`, which no retry policy covers, so the turn died and the user manually nudged it back (49 bare "продолжай" messages, 9% of user input).

## Decision

Two opt-in function plugins, no core changes.

`@deepseek-ai/dsh-edit-anchor-coach` sits on `tools/pre-execute` and re-derives the edit tool's own verdict from the file's current text before dispatch: verbatim-once passes; verbatim-several without `replace_all` is denied with quoted line numbers and a total; zero matches fall through a whitespace-normalized variant ladder, then word-token nearest-line candidates (tokens under 3 characters never count as distinctive; ties break by line number). A denial is exactly a doomed call whose error now carries the fix — the same `Error:` channel the tool would have used, one round trip earlier in usefulness. Unreadable paths, oversized files, empty anchors, and malformed arguments pass through unanalyzed; the tool owns those refusals.

`@deepseek-ai/dsh-request-rescuer` sits on `agent/request-error` upstream of the exact-provider executor and delegates first (`await next()`): it rescues only a failure the executor declined whose text matches a configured transient pattern gated by normalized codes, with per-rule bounded jittered backoff. The design is registration-order independent. Every rescue reuses the shared `llm/retry` / `llm/retry-started` events under a `rescuer:`-namespaced policy key, so budgets are read back from the durable log (counts survive restarts), the UI shows its existing retry status, and no new session event type is introduced.

## Alternatives considered

- **Tolerant matching inside the edit tool** (a replacer ladder that rewrites anchors) — rejected for this change: input rewriting is excluded at the pre-execute seam by design, and silent fuzz-matching can apply the wrong edit; the coach locates, the model repairs.
- **Broadening `retryableCodes` defaults** — rejected: `INVALID_REQUEST` genuinely covers permanent rejections; vocabulary-gated rescue keeps the widening per provider route and per declared pattern.
- **A new session event type for rescues** — rejected: the existing retry events already carry every fact; a second vocabulary would fork the UI and the log reader.
- **Auto-filling empty `justification` fields** — rejected for now: pre-execute cannot rewrite logged arguments; the friction belongs in the owning tools' schemas.

## Consequences

A doomed edit now returns its repair map instead of a dead end, and a transient-unavailable gateway no longer ends the turn. Both plugins are opt-in (profile `cordis.patch.yml` rows), ship with behavior suites at 100% per-file coverage, and are inert by default (`tools: ['edit']` targets one tool; `patterns: []` rescues nothing).

`packages/guard/edit-anchor-coach/tests/edit-anchor-coach.spec.ts` drives the real tool registry pipeline over temp files; `packages/llm/request-rescuer/tests/request-rescuer.spec.ts` drives a real agent loop with a scripted adapter, including delegation to the mounted `dsh-llm-retry`, budget exhaustion, and cancellation during the rescue wait.

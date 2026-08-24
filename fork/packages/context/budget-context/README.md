# @deepseek-ai/dsh-fork-budget-context

English | [中文](README.zh.md)

Model-facing session budget awareness: when a session carries an absolute context cap, this plugin reports the remaining budget to the model so it spends the scarce window deliberately instead of filling it mindlessly.

## Behavior

The plugin registers one `SystemPrompt.context()` contribution named `session:budget`. At every assembly it reads, live:

- the session's cap from the optional `ctx.compactionPolicy` service (`limitTokens(sessionId)`, the `compaction-policy` settings namespace's `sessionLimits` entries);
- the session's metered usage from `ctx.tokenMeter.measure()`.

When usage reaches `adviseFromPercent` (default 50%) of the cap, the context renders a fixed note stating the usage bucket in 10% steps, the cap, and concrete economy guidance (short tool outputs and prose, no redundant re-reads, no repetition). Buckets keep consecutive renderings identical while usage drifts inside one bucket, so the runtime-context projection appends nothing new; crossing a bucket boundary lands exactly one new durable snapshot.

Any missing collaborator — no compaction policy service, no entry for this session, or no token meter — renders empty text, which contributes nothing. A deployment can therefore mount the plugin unconditionally beside the fork compaction stack.

The note rides the standard runtime-context snapshot: a durable, source-attributed `user/message` that enters model requests append-only and never rewrites the system prompt, preserving KV-cache reuse of the existing prefix. The plugin owns no events, tools, or services.

## Config

| Key | Required | Meaning |
|---|---|---|
| `adviseFromPercent` | no (default `50`) | Usage percent at or above which the note starts appearing; multiples of 5 in `[10, 90]`. |

## Model Experience

A model-visible budget note appears in requests once the session passes half of its cap (by default), phrased through stable buckets. Sessions without a cap see nothing.

#### KV Cache effect

Append-only snapshots after the reusable prefix; identical bucket wording appends nothing between crossings.

## Known Limitations and Deferred Work

- The note states the usage bucket, not exact remaining tokens; exact figures would change every step and churn the durable snapshot.

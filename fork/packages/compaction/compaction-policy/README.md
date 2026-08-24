# @deepseek-ai/dsh-fork-compaction-policy

English | [中文](README.zh.md)

Host-plane settings provider for the automatic compaction threshold and per-session context caps, used by the Web ContextMeter and preset-local `compaction-basic` backends.

## Behavior

The package registers the `compaction-policy` settings namespace with two independent knobs:

- `thresholdPercent` (25–95) — a deployment-wide window-percentage override. `CompactionPolicy.thresholdRatio(fallback)` returns the user override as a ratio or the backend's configured ratio when no user value exists.
- `sessionLimits` — an optional list of `{ sessionId, limitTokens }` entries stating one absolute token cap per session. `CompactionPolicy.limitTokens(sessionId)` returns that session's cap or `undefined`. Duplicate session ids and caps below `MIN_SESSION_LIMIT_TOKENS` (1024) are rejected.

Settings values are read live, so the next `agent/pre-step` pressure check uses a changed threshold or cap without restarting the agent or changing its current step. Because each entry is keyed by session id, every session keeps its own cap across switches and restarts; a session without an entry keeps the plain window-scaled threshold. When both knobs apply, `dsh-fork-compaction-basic` compacts at whichever constraint binds first.

The browser writes this namespace through the standard settings transport (the ContextMeter panel's threshold slider and per-session limit selector). The service has no model-facing tools, prompt sections, session events, or model-request effects.

## Model Experience

None; this package only supplies host configuration to the compaction consumer.

#### KV Cache effect

None; it does not assemble or send model requests.

## Known Limitations and Deferred Work

- Entries for deleted sessions stay in the section until removed through settings; they are inert but accumulate in `settings.yaml`.

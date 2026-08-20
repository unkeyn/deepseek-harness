# @deepseek-ai/dsh-compaction-policy

English | [中文](README.zh.md)

Host-plane settings provider for the automatic compaction threshold used by the Web ContextMeter and preset-local `compaction-basic` backends.

## Behavior

The package registers the `compaction-policy` settings namespace with an optional `thresholdPercent` field from 25% through 95%. `CompactionPolicy.thresholdRatio(fallback)` returns the user override as a ratio or the backend's configured ratio when no user value exists. The settings value is read live, so the next `agent/pre-step` pressure check uses a changed threshold without restarting the agent or changing its current step.

The browser writes this namespace through the standard settings transport. The service has no model-facing tools, prompt sections, session events, or model-request effects.

## Model Experience

None; this package only supplies host configuration to the compaction consumer.

#### KV Cache effect

None; it does not assemble or send model requests.

## Known Limitations and Deferred Work

- The threshold is a global user preference shared by all active compaction backends; per-session thresholds are not supported.

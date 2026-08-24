# Agent Note: Per-session context limits with budget-aware compaction

Status: implemented

English | [中文](2026-08-23-session-context-limits.zh.md)

## Problem

The fork's only user-facing context control was the deployment-wide `thresholdPercent` slider in the ContextMeter panel: one global preference that scales every model's window, shared by all sessions. A user cannot tell one session to live inside a small token cap while another runs unconstrained, and nothing about the selected threshold reaches the model — so a session asked to stay small still fills at full speed and only discovers the constraint when `agent/pre-step` compaction fires. Switching sessions also meant losing any intended limit.

## Decision

Three cooperating pieces on existing seams; the official tree stays byte-for-byte untouched.

`dsh-fork-compaction-policy` (the settings owner) gains a second independent knob beside `thresholdPercent`: a `sessionLimits` list of `{ sessionId, limitTokens }` entries in the same `compaction-policy` namespace. Settings — not a new store — was chosen because the namespace already has live-read wiring into both consumers, the file provider persists it across host restarts, and the browser already holds a bound scope for this exact section; keying entries by durable session id gives every session its own persistent value for free. The service exposes `limitTokens(sessionId)` next to the unchanged `thresholdRatio(fallback)`, rejecting duplicate ids and caps below 1024 tokens (below that floor no retention can fit under the threshold).

`dsh-fork-compaction-basic` consumes the cap where it resolves budgets: `resolveSessionSpec(policy, contextWindow, limitTokens)` sets `threshold = min(window × ratio, cap × 0.95)` and clamps retention to half of that binding threshold. Two deliberate choices live here. The clamp is load-bearing: without it, a cap smaller than the window-scaled retention makes `resolveCompactSpec` throw `TargetPressureConfigError`, which the pre-step listener treats as warn-once-and-disable — exactly the sessions that requested small limits would silently lose automatic compaction. The 5% reserve rejects the exact-cap trigger on purpose: compaction only runs between steps, and the summarization call itself spends cap headroom, so firing at the wall is the classic failure mode (Claude Code's "auto-compact does not trigger at 100%" reports end with dead sessions; mainstream harnesses — OpenHands ~80%, Hermes ~85%, Upsonic default 0.9 — all reserve a buffer for precisely this reason). A fixed internal ratio, not another config knob: it protects an invariant (stay under the cap) rather than tuning deployment behavior.

`dsh-fork-budget-context` (new package) addresses the fill-rate half. It registers one `SystemPrompt.context()` renderer that reports the usage bucket in 10% steps once usage passes half the cap (configurable), with pinned economy guidance. The runtime-context snapshot is already the correct transport for model-visible time-varying text: durable, append-only after the reusable prefix, emitted only on change — and bucketing is what makes "only on change" true between crossings, so a drifting meter does not append a message per step.

The ContextMeter panel gains a per-session limit selector (off plus presets below the routed window; a non-preset value from `settings.yaml` shows as-is instead of silently normalizing). While a cap binds, the headline percentage, ring, and figures read against the cap rather than the window, because the cap is what triggers that session's compaction; without a cap every figure keeps its previous window-relative meaning, so the official-derived behavior changes only where the new feature applies.

## Alternatives considered

**A new RPC plus server-side KV store keyed by session id** (the `credential-pool-store` pattern). Rejected for now: it adds wire surface, schema, and client plumbing to express data the settings transport already carries end to end, and the limit is semantically a user preference like the threshold it sits beside.

**Session-log events carrying the limit.** Model-visible ⟺ logged already covers the guidance note via its snapshot messages; the limit itself never enters requests, so logging it would buy replay fidelity for state that settings restore more simply.

**Percent-of-window limits.** A percent silently changes meaning when the user switches a session to a different model; an absolute cap states the actual constraint the user wants ("stay under ~32k") regardless of routing.

## Consequences

Precedence is documented and enforced: per-session cap > global percent > backend config ratio, combined as min at pressure time; overflow recovery and `compactNow()` are untouched. The fork bundle gains one row (`budget-context`) whose renderer is inert without the policy service or a cap, so mounting it unconditionally is safe. Deleted sessions' entries remain in `settings.yaml` until removed through settings — inert, but accumulating.

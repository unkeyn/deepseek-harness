# Agent Note: Context meter ring follows the compaction threshold

Status: implemented

English | [中文](2026-08-20-context-meter-ring-threshold.zh.md)

## Problem

The [ContextMeter decision](../feature/2026-08-05-composer-context-meter-breakdown.md) exposed a configurable automatic-compaction threshold, but its ring always normalized occupancy against the full model context window. Changing the threshold altered the compaction policy and slider text without changing the ring's visual completion point, so the indicator did not show the selected limit.

## Decision

The ring stroke normalizes the absolute projected occupancy percentage against the selected threshold and clamps the result to 100%. The localized occupancy label, `~used / capacity` figures, and composition bar remain normalized against the full context window, so they continue to report actual capacity usage. The threshold is a Host-backed `compaction-policy` setting shared by the browser and preset-local compaction backends; `compaction-basic` reads it during `agent/pre-step`, after the current step closes and before the next model request. The browser keeps a live local display of the Host value and migrates the former local-only setting once.

The ring uses the unrounded normalized value for smooth SVG progress. The displayed occupancy percentage remains the existing integer projection value, and occupancy at or above the selected threshold produces a complete ring rather than an overlong stroke.

## Alternatives considered

**Scale the label and composition bar to the selected threshold.** Rejected because it would make the panel report a threshold-relative percentage as if it were the model's actual context occupancy and would make the displayed figures disagree with the bar's total.

**Leave the ring normalized to the full context window.** Rejected because the configured threshold would affect compaction timing but not the visual limit indicator, which is the defect this change closes.

**Render a second threshold marker on the ring.** Rejected because the existing 14px control has no room for a legible independent marker; using the threshold as the ring's completion point keeps the selected limit directly readable.

## Consequences

A threshold of 25% fills the ring when occupancy reaches 25% of the model window, while the panel still shows the absolute occupancy and capacity figures. Lowering the threshold makes the ring reflect the selected limit immediately; the next `agent/pre-step` boundary invokes automatic compaction before another model request, and the existing turn then continues. The explicit `Compact now` action remains idle-only.

`packages/client/ui-conversation/tests/context-meter.client.spec.tsx` verifies the SVG stroke scaling, saturation, explicit manual action, and Host setter. `packages/client/ui-conversation/tests/compaction-policy.client.spec.ts` verifies Host adoption and legacy migration. `packages/compaction/compaction-policy/tests/policy.spec.ts` verifies the settings-backed service, and `packages/compaction/compaction-basic/tests/compaction-basic.spec.ts` verifies the live threshold override at `agent/pre-step`. The component remains covered by the assembled GUI test lane through the existing ContextMeter boot path.

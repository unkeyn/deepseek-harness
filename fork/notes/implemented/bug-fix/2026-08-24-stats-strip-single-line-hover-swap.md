# Agent Note: Stats strip wraps, and the ring's hover swap cannot rock the composer

Status: implemented

English | [中文](2026-08-24-stats-strip-single-line-hover-swap.zh.md)

## Problem

The stats strip under the composer wrapped onto a second line when its groups exceeded the card width, and the context ring's hover swap ([breakdown decision](../feature/2026-08-05-composer-context-meter-breakdown.md)) exchanged the billing group for the wider composition rows while hovered. Near the width boundary each swap flipped the wrap: the strip grew one line, the card and the ring inside it moved up, the pointer left the ring, the swap reverted, the ring moved back under the pointer, and the cycle repeated — the composer shook for as long as the pointer rested near the ring.

## Decision

The strip keeps whole groups and wraps onto a second centered line when narrow — clipping figures mid-number reads as broken, and the second line is the accepted narrow-layout shape. Group spacing tightens from 16px to 12px. The oscillation is removed at its event source in ContextMeter: `pointerenter` records the ring's rect, and a `pointerleave` hands the hover state back only once the pointer has also left that entry rect. A swap-induced ring move fires `pointerleave` under a stationary pointer; ignoring it keeps the swap engaged. The rule cannot sustain a cycle: reverting restores the ring to the entry rect exactly, so a self-sustaining enter/leave alternation would need the pointer inside and outside that rect at once.

## Alternatives considered

**Single-line strip with per-group ellipsis and a clipped-text tooltip.** Rejected: truncated figures (`LLM 24m22s · Tool call 1…`) are unreadable, and the whole point of the strip is the numbers.

**Reserve two lines of height.** Rejected: every session pays a blank line to keep one boundary case stable.

**Move the composition out of the strip.** Rejected: the inline swap is the reviewed design; the defect was the enter/leave feedback, not the swap.

**Debounce the revert on `pointerleave`.** Rejected: the revert still fires after the delay and re-enters under the stationary pointer, so the loop persists at the delay's period.

## Consequences

Narrow layouts wrap the strip to a second centered line with whole figures, and hovering the ring swaps the billing group for the composition with at most one height shift per enter and per real leave — never a sustained shake. `fork/packages/client/ui-conversation/tests/context-meter.client.spec.tsx` covers the entry-rect rule (a layout-induced leave keeps the swap; a real exit hands back), and `fork/packages/client/ui-conversation/tests/chat-stats.client.spec.tsx` keeps covering the swap content itself. The base `packages/client/ui-conversation` strip has no hover swap and therefore no oscillation; its README still documents the elide contract it never implemented, which remains the fork's upstream sync job.

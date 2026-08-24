# Agent Note: Context meter hover swap, limit slider, and coalesced Host writes

Status: implemented

English | [中文](2026-08-24-header-context-meter.zh.md)

## Problem

The fork's context meter answered the per-session limit with a `<select>` beside the threshold slider — two different variables (an absolute token cap; a percentage trigger) presented as two competing controls — and the composition rows (system prompt, tools, messages) were buried one click deep in a panel that stayed open until dismissed. The native range inputs dissolved into the dark panel instead of contrasting with it, and dragging a slider published one Host settings write per tick, every round-trip re-entering the controller's adopt path: the thumb visibly trailed the cursor.

## Decision

The meter stays beside the composer's send button; the ring alone is always visible, and its tooltip carries the localized sentence plus the `~used / capacity` figures.

Hover swap instead of a permanent readout: hovering the ring swaps the stats line's billing group (cache hit, input/output tokens) for the heuristic composition rows — system prompt, tools, messages, with the meter's swatch tints — through one shared module store (`contextMeterHover`), because the ring (composer bar) and the strip (composer dock) are sibling slots with no owner in common. Leaving hands the billing group back; a session without the breakdown projection keeps the billing group even while hovered, so the swap has nothing to render rather than an empty strip.

The limit `<select>` and its preset list become a slider from 8K to the routed window in 8K steps whose right end is the uncapped state — a cap equal to the window can never bind, so dragging there writes a clearing — with an `✕` beside a selected cap for an explicit clear; a `settings.yaml` cap between steps displays as-is. Sliders get custom chrome (hairline track, business-blue thumb ringed in the surface color) so they read against the dark panel. Clicking the ring opens the panel above the composer with the percent made intuitive: the localized reading brackets its percent, the `~used / capacity` figures name the denominator, and a proportion bar with the composition rows (system prompt, tools, messages) shows what the occupied share consists of.

Host writes coalesce through a 300ms trailing debounce in `CompactionPolicyController`: the local echo stays synchronous — the slider never waits for the wire — and the settled value publishes once per field.

## Alternatives considered

**A header-embedded meter with a permanent figures readout.** Rejected: the strip crowded the title row, and a click-away that hid the figures read as a bug; the stats line already owns the numbers-under-the-composer home, so the hover swap reuses it instead of adding a second one.

**Keeping the selector and adding the slider.** Rejected: two controls for one value is exactly the confusion the select produced; the slider covers every preset plus everything between.

**Writing through on every tick with no debounce.** Rejected: the wire is the lag.

## Consequences

The header utility seat is empty again, and the composer trailing row carries the ring as before. The stats line's billing group remains the resting state, so no durable figure is lost — the composition is an estimate and only borrows the strip while hovered. `packages/client/ui-conversation/tests/context-meter.client.spec.tsx` covers the ring, the panel lifecycle (toggle, idle close, outside click, Escape, the compaction hold), the limit slider, and the hover-store flip; `chat-stats.client.spec.tsx` covers the swap both ways and the no-breakdown fallback; `compaction-policy.client.spec.ts` covers the synchronous echo, the single coalesced write, and the debounce flush.

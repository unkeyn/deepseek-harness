# Agent Note: The reasoning presentation seat and the shared flow-motion language

Status: implemented

English | [中文](2026-08-23-reasoning-seat-and-flow-presentation.zh.md)

## Problem

The Think row rendered reasoning as raw text, so the model's `**emphasis**` reached the user as literal asterisks, and the collapsed summary shared the defect. The surfaces around the composer each arrived with their own visual behavior: the todo strip and goal bar popped into the dock column, the question takeover appeared without transition, and its options painted as a block. Wide markdown tables scrolled but lost their header row the moment a reader moved down or sideways.

## Decision

- **Reasoning presentation is a slot, not a private component.** ui-conversation's assistant-step entry declares the session-scoped single seat `conversation.chat.reasoning` (owner props: block text, streaming-tail flag, locale seat), and AssistantMarkdown dispatches every reasoning block through it with the built-in Think row as the `fallback` — the commandview pattern. Reasoning stays visible with zero registration, and a presenter plugin upgrades every block by registering one component.
- **The shipped presenter is the new `@deepseek-ai/dsh-client-ui-reasoning` plugin.** Its ThinkRow renders the collapsed summary through `MarkdownInline` and the expanded body through `MarkdownText` (streaming-aware), so emphasis, inline code, and links render for real in both places. While the block streams, three staggered dots pulse beside the followed summary tail; expand/collapse rides a grid-rows `0fr → 1fr` transition with a rotating chevron instead of a mount swap, and the collapsed body leaves the accessibility tree through a visibility flip timed to the transition end. Every animated piece has a `prefers-reduced-motion` kill switch. Removing the roster row restores the baseline row.
- **One motion vocabulary owns presence.** ui-theme's base sheet defines `--dsw-ease-flow` (the ease-out curve), `--dsw-duration-flow`, and `--dsw-motion-rise`. The todo strip, the goal bar, and the question takeover card rise into place on mount with that curve; the question options arrive as a short staggered wave capped at the eighth row; the todo chevron rotates to the expanded state instead of swapping glyphs. Color and hover transitions keep the existing ease tokens.
- **Tables keep the reader oriented.** The markdown sheet stretches every table to the message column (`width: 100%`) and pins the header row (`position: sticky` over the opaque flow background), so a tall table keeps its header while the transcript scrolls and a wide one keeps it while its own scroller moves.
- **`MarkdownInline` and the raw-line helpers live in ui-primitives.** `renderInlineLine` renders one line of authored markdown as phrasing content — paragraph children concatenated, non-paragraph blocks dropped — under the document renderer's untrusted-output policy; `firstRawLine`/`latestRawLine` slice the summary line for callers that render it themselves. The baseline fallback row consumes the same pieces, so the asterisk leak is fixed with and without the plugin.
- **ui-primitives declares `@testing-library/react` as a devDependency.** Component specs there must resolve React and the testing library through the package's own dependency context; after the fork workspace began owning the hoisted react store link, the previous root-level resolution produced two React instances in one test process (null dispatcher on the first hook).

## Alternatives rejected

- **Shadowing the `assistant-step` chat-node key** to replace the whole message renderer: it would fork the text/image/tool-block loop to change one block kind, and the seat-plus-fallback shape gives the same upgrade path without the duplication.
- **Letting tables bleed wider than the message column** (the free-code-tauri treatment): harness messages already span the full content column, so there is no narrower text measure to bleed past; sticky headers deliver the same readability without negative-margin geometry.
- **Exit animations for the dock cards**: graceful leave needs delayed unmount machinery at the dock render site; with no second consumer, the mount-side rise carries the language alone.

## Coverage

`ui-reasoning` pins the ThinkRow markdown rendering, toggle and keyboard paths, streaming summary/dots lifecycle, and the scroll-follow behavior, plus the plugin's registration and HMR disposal over a real cordis Context. `ui-primitives` pins `MarkdownInline`/`renderInlineLine` (emphasis, code, link policy, html literalism, blank and non-paragraph drops) and the raw-line helpers. The ui-conversation reasoning specs drive the fallback path through the seat dispatch.

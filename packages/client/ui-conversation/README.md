---
description: "Target-neutral conversation assembly and browser shell: event and view registries, per-session bindings, input state, slots, and temporary composer takeovers."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-conversation

English | [中文](README.zh.md)

## Summary

`ui-conversation` owns target-neutral Conversation assembly and the shared browser shell. It consumes Session Controller `SessionEventLikeEntry` feeds, exposes React-free registries and per-Session bindings through `ctx.uiConversation`, and contributes the `useConversation`, `useInput`, and `inputActions` standard props through `ctx.uiSession`. It also owns the per-session durable image URL cache: `ctx.uiConversation.imageUrl(sessionId, attachment)` resolves one session-authorized browser URL per attachment and revokes it with the Session binding, so every Conversation target shares one `session.attachment` read. Concrete targets such as Chat are separate packages that register their own Definitions, snapshot builders, Views, and renderers.

## Table of Contents

- [Conversation assembly](#conversation-assembly)
- [Shell and standard props](#shell-and-standard-props)
- [Temporary composer entries](#temporary-composer-entries)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="conversation-assembly"></a>
## Conversation assembly

`UiConversation.events` is the single registry for event Definitions, and `UiConversation.views` is the single registry for target snapshot builders. Both registries reject duplicate keys, preserve registration order, return idempotent disposers, and rebuild existing bindings when their contribution roster changes. `UiConversation.binding(bindingOrSessionId)` returns one identity-stable Conversation binding for the current Session Controller binding. It does not open another event source.

The adapter passes each `SessionEventLikeEntry` directly to the assembler. Its outer `type` distinguishes scalar and packed records, while its inner `event` always exposes `type`, `seq`, `time`, and `data`; Definitions receive that inner `SessionEventLike`. Historical replace and prepend accept both entry variants, while live append accepts only `SessionLiveEventEntry`. Every Definition uses the same `match` and `update` methods for both event forms, while `start` receives only a standard event and the assembler rejects a packed start. Definitions that do not consume Assistant deltas return `null` for the packed tags. Replacement windows and revision gaps rebuild from the complete loaded window; contiguous append and prepend revisions use incremental assembly without expanding packed members. The assembler owns Context matching, Turn/Step locations, target node materialization, target activity, and stable target sources. `ConversationSnapshot` contains only target-neutral views and active-target facts; Session lifecycle state remains in `SessionSnapshot`.

Target packages declaration-merge their snapshot and Location data maps, then register with `ctx.uiConversation.events.register(...)` and `ctx.uiConversation.views.register(...)`. A target reads its Session-owned source with `ctx.uiConversation.binding(binding).target(targetId)`. Registrations are Cordis effects and their returned disposers remove the contribution from the same registry.

<a id="shell-and-standard-props"></a>
## Shell and standard props

The package registers the optional-Session `conversation` shell, strict Session header/body entries, View list, composer chain and bar, input regions, Hero regions, queue dock, draft persistence, and phase calculation. `ctx.uiSession.provide()` materializes the Conversation and input sources from the same Session binding and supplies `inputActions` as a stable standard prop.

View selection is deterministic: a registered persisted selection wins, otherwise registered `chat` wins, otherwise no View renders. It never chooses the first registered View. Shell phase combines Session lifecycle with the active-target set; no target-specific snapshot is read by the shell.

The resident composer survives no-Session and Session transitions. The no-Session state keeps the same composer surface mounted but inert while the Workspace picker connects a blank Session. The surface is a shell-owned Lexical editor: reference chips are atomic decorator nodes carrying the owner's serialization identity (submission expands them through the owner codec), claimed slash commands stay styled leading text, folder text references carry the folder glyph as an icon prefix, and the draft's clipboard projection is mirrored into the per-Session Conversation store. Queue operations address exact queue occurrences through the scoped `ctx.conversation` service; queue previews render sent text through the shared inline reference projection from `ui-primitives` (wire session forms fold to their label), while an edit exposes the literal sent text. Busy Enter behavior is stored in the Host-backed `ui-conversation` settings namespace.

Default sends commit optimistically: Enter clears the draft, occurrence table, and undo history in the same transaction, keeps the composer in `plain`, and runs the send as a detached attempt, so typing and further sends continue during the flight. `sendSession` registers a Session submission echo (`session.beginSubmission`) before serializing, yields one paint so the echo renders on the click's own frame, and encodes images through the browser's native `FileReader` data-URL path. Concurrent failures are restored together in submission order until the user edits the restored content; command submissions keep the frozen `submitting` phase. Detached attempts retain their image ids through admission and Session scope disposal. When an echo retires as observed, the durable image cache exposes its preview immediately, fetches the admitted attachment, replaces the preview with the canonical URL, and revokes each URL after its use ends. Direct subagent continuations skip local echoes because their transport does not preserve the browser request id.

While a normal composer is running, its primary pointer action remains Stop when the draft is empty or input is unavailable. Actionable text or attachments switch the same seat to Queue Send; clearing or successfully submitting the draft restores Stop. The busy-Enter setting continues to select the Queue or Steer keyboard action. Continuable subagents keep separate Send and Stop actions ([decision](../../../.agents/notes/implemented/bug-fix/2026-08-20-running-draft-primary-send.md)).

<a id="temporary-composer-entries"></a>
## Temporary composer entries

`conversation.composer` is a generic chain. Its complete owner currency is:

```ts type-equiv
/** Owner values used to elect a composer takeover. */
interface ComposerChainProps {
  /** Current Session identity used by temporary business-owned entries. */
  sessionId: SessionId | undefined
  /** Current Session lifecycle state, absent without a selected Session. */
  session: SessionSnapshot | undefined
  /** Effective business-owned interaction awaiting the user in this Session. */
  pendingInteraction: SessionPendingInteraction | undefined
}
```

A business package may install one entry only while a Remote waterfall request is pending:

<<<<<<< HEAD
The chat stats line takes its token accounting from the generic token-meter `tokenUsage` projection read through the standard-kit `useProjection`: billed input is uncached input plus cache reads and writes; cache hit divides cache reads by that total. The turn and step counts, the LLM and tool wall times, and the latency/throughput group all ride the whole-log `sessionStats` projection (host-folded from step boundaries, first-token chunks, tool pairs, and assembled messages), so paging and compaction cannot change any strip figure; an assembly without that unit falls back to the window fold over visible nodes, whose fields mirror the projection's. The strip averages each recorded step's TTFT and divides sampled output tokens by their summed decode spans into a latency/throughput group localized through the `conversation` locale namespace (`TTFT avg … · … tok/s` in English); a step missing a timing boundary or a usage sample drops out of those figures instead of skewing them, and durable count, token, and context groups remain visible when compaction leaves no assistant node in the loaded window. The turn-count, step-count, duration, cache, and token labels use the same namespace. Each settled turn additionally appends hover-revealed `TTFT {s}s · {tps} tok/s` labels to its assistant footer after the `Ran for` duration — the turn's first-step TTFT and its turn-aggregate decode throughput — gated on the turn's timing being in the loaded window (a contiguous log suffix, so an in-window turn carries every one of its steps) and omitting whichever figure is unrecorded. A deployment without token-meter drops the token groups; when the line overflows, it elides with an ellipsis and a delayed hover tooltip carries the full text only while actually clipped. ContextMeter's expanded panel exposes a Host-backed 25–95% automatic compaction threshold and a `Compact now` action; the ring reaches a complete turn at the selected threshold, while the label and composition bar retain the absolute context-window percentage. The slider writes the `compaction-policy` settings namespace, and compaction-basic reads that live override before each request at the agent's `agent/pre-step` boundary, so a threshold crossing finishes the current safe step, compacts before the next model request, and preserves the active turn. The explicit action remains disabled during an active turn. `contextPressure` and rendered only once both a numerator and a route capacity are known, that click-opens a panel pairing the `percent used` header and `~used / capacity` figures with a color-segmented bar and `~`-prefixed heuristic composition rows (system prompt, tools, messages) from the `contextBreakdown` projection. The ring and header read `projectedTokens` — the provider sample carried forward over the surface's movement since — so a compaction registers immediately instead of after a further turn; the composition rows stay wholly heuristic and therefore still do not sum to the header ([rationale](../../llm/token-meter/README.md)). Occupancy is deliberately an approximation: numerator and capacity are independent last-wins projection fields, not one atomic request observation.
=======
```tsx
import type { ComposerChainProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChainSelect, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
>>>>>>> upstream/master

interface Request {
  readonly sessionId: SessionId
}

type RequestComposerProps =
  PropsRuntime<'conversation.composer'> & { matched: Request }

const select: ChainSelect<ComposerChainProps, Request> = owner =>
  owner.sessionId === request.sessionId ? request : null

const dispose = ctx.slots.register(
  { name: 'conversation.composer', select },
  RequestComposer,
)

try {
  return await request.result
} finally {
  dispose()
}
```

The selector must be a pure function of the owner currency. Its non-null return is delivered to the component as `matched`; `PropsRuntime<'conversation.composer'>` supplies the standard Session and global props. Chain order remains ascending `priority`, then registration order, and the first non-null selector wins. The shell keeps the default composer mounted beneath a takeover. Request state, listeners, response encoding, and any request-specific child slots belong to the business package; they are not carried by `SessionSnapshot` or declared by this core package.

<a id="model-experience"></a>
## Model Experience

None, as this package renders browser state and sends user-admitted inputs through Session Controller APIs without constructing model requests.

#### KV Cache effect

None; Conversation assembly and browser input state do not alter provider-side prompt caching.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Only registered targets can render** — the shell deliberately has no implicit fallback target beyond the registered `chat` preference.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

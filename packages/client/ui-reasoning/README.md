# @deepseek-ai/dsh-client-ui-reasoning

English | [中文](README.zh.md)

Reasoning presentation plugin, browser half: it registers the `ThinkRow` presenter into the `conversation.chat.reasoning` seat that ui-conversation's assistant-step entry declares for every reasoning block. The seat's fallback is ui-conversation's built-in Think row, so composing this plugin out (removing the roster row) restores the baseline presentation — the package only upgrades it, it never owns the data. Block text, the streaming-tail flag, and the locale seat arrive as owner props at dispatch time; the plugin holds no store and listens to nothing.

The upgrade over the fallback: the collapsed summary line and the expanded body render real markdown through the shared `MarkdownInline`/`MarkdownText` pipeline (emphasis, inline code, and links render; a raw `**` never reaches the user), streaming shows three live progress dots beside the followed summary tail, expand/collapse rides a grid-rows height transition with a rotating chevron, and the whole disclosure animates in with the shared flow-motion tokens. Every animated piece has a `prefers-reduced-motion` kill switch.

## Model Experience

None. The row is presentation over reasoning the model already emitted; it adds no prompt content, no tool, and no session event.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

- **Streaming summary is plain-text-scoped** — the followed summary line renders inline markdown but the incremental streaming parser only serves the body; a mid-stream partial emphasis marker renders literally in the summary until the line completes.

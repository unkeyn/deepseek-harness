# @deepseek-ai/dsh-fork-client-ui-agent-modes

The composer's agent-mode panel: an icon trigger in the tool row's left seat (`conversation.input.left`, beside the Access chip) opening the mode configuration card. The panel is NOT a mode picker — the model routes itself through `select_mode`; the card is where the user assigns each mode its model and custom instruction.

The card has two panes. The left lists the routed modes (Default, Agents, Design, Revisor, Scout) with the assigned model rendered dimmed to the right of each name, a pencil button per row, the Angel checkbox row, and a Presets row. Hovering a mode slides the right pane in from the right (140ms translate + fade) with the model catalog — the same providers and models the model seat shows, from the `sessions.models` RPC; picking a model writes it through the `agent-mode-assignments` settings namespace and shows a check on the assigned row (a `reset` link clears it). The pencil toggles the instruction editor in the right pane: a textarea prefilled with the custom instruction (empty means built-in), Save persists, the pencil again (or the close button) returns to the hover behavior. While any pinned pane (editor or presets) is open, hovering rows changes nothing. A mode with a saved custom instruction keeps its pencil bright. The effective mode — the one the model routed to — carries a check in the left list. The Presets pane saves the current models+instructions configuration under a name, applies a saved preset wholesale, and deletes presets. Angel toggles through `/angel on|off` exactly as before.

Every write surfaces its failure as an inline error line and re-reads the authoritative section afterwards, so the menu always reflects the stored state on reopen.

Reads ride the host-computed `agentMode` projection (effective mode + angel) and the settings/catalog RPCs through the injected face; the trigger renders nothing while the projection key is absent. The trigger locks on a removed session and collapses to icon + chevron under 460px, matching the sibling chips. Outside click and Escape close the card.

## Model Experience

None directly: the panel adds no model-visible input. Settings writes change server-side routing behavior owned by `@deepseek-ai/dsh-fork-agent-modes`; the angel command lands as an ordinary logged command row.

## Known Limitations and Deferred Work

- Write failures surface as a small inline error line in the left pane; there is no toast channel from a composer seat.
- The catalog is loaded once per menu opening and does not live-refresh while the card stays open.

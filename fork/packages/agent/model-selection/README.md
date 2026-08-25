# @deepseek-ai/dsh-fork-agent-model-selection

Cross-plugin registry of the per-agent model-selection refs the web API gateway installs. The gateway keeps ownership of each ref and its three-tier read precedence (process pick → logged request header → deployment default); this service only publishes the installed ref as `ctx.agentModelSelections`, so other plugins apply a selection through the SAME object the gateway reads — one writer per agent, last write wins, exactly like a manual pick in the model seat.

## Service

`AgentModelSelections` (`ctx.agentModelSelections`, no config):

- `bind(agent, ref)` — the gateway publishes the ref it installs for one agent (called from the gateway's lazy `selectionFor`).
- `for(agent)` — the published ref, or `undefined` before the gateway installed one (headless and non-web compositions never install it).

Writers resolve the target themselves (`ctx.llm.resolveCallConfig`) and assign `ref.current`; clearing assigns `undefined`, which restores the ref's logged/default tiers.

## Model Experience

No model-visible effect of its own. A selection written through a published ref takes effect from the next step that enters prompt assembly, identical to a gateway `selectModel` call.

## Known Limitations and Deferred Work

- The registry is populated only by the fork API gateway; a composition without it offers no writable selection surface, and writers must treat `for(agent) === undefined` as "no model slot support".

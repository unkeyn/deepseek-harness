# Agent Note: Self-routing agent modes with UI-assigned models and instructions

Status: implemented

English | [中文](2026-08-24-agent-mode-roster.zh.md)

## Problem

The fork had no way to say "this kind of task should run on that model". Model choice lived only in the manual model seat, guidance lived in one fixed system prompt, and running a second model alongside the main one — the pattern OMP normalizes with named agents plus quick/deep model categories — had no composition-native equivalent. An earlier cut of this feature exposed the modes as a manual picker and drove assignments from cordis.yml, which got the division of labor backwards: the user ended up hand-selecting modes and editing config files, and the roster carried model-slot entries (`@smol`/`@big`) that were really model presets pretending to be modes.

## Decision

**The model routes itself.** The roster is now `default`, `agents`, `design`, `revisor`, `scout` (legacy `smol`/`big`/`code` ids stay valid in old logs and `/mode` but are not exposed). An always-on routing section (order 45) tells the model when each fits — scout: fast read-only codebase exploration; revisor: careful examination and information gathering; design: design work; agents: multi-subagent coordination; default: everything else — and a `select_mode` tool commits the choice as the existing durable `agent-mode/selected` event. No menu gesture activates a mode.

**Assignments live in settings, edited in the UI.** The `agent-mode-assignments` settings namespace (`{ models, instructions }`, schemastery dicts) holds one optional model and one optional custom instruction per mode. The composer panel writes it through the existing settings RPC (`update`/`mutate`), and the controller reads it live via `installSettingsSection` — the agent-default-model pattern. Config `roles.*.instruction` survives only as a static fallback; the slots concept is gone.

**Mode subtypes as delegation tools.** `subagent_<mode>` (five tools) start a one-shot child on the configured `ctx.subagents` provider with the mode's instruction prepended to the task prompt and the mode's assigned model in the child's `agentOptions` — per-start fields the subagent seam already carries, so no loop or provider change. Foreground runs surface the child's text as the tool result; abnormal stop reasons carry the provider diagnostic.

**One selection ref, published — not duplicated.** The gateway publishes each installed selection ref through `ctx.agentModelSelections` (`@deepseek-ai/dsh-fork-agent-model-selection`, one bind line in the fork gateway); mode selection writes through that ref after `resolveCallConfig` validation. A routed mode switch is therefore the same operation as a manual pick — last write wins, no second `installModelSelection` fighting the gateway's listener.

**Angel stays a mirror.** While enabled, each committed user message spawns one background `ctx.llm.stream` call to the configured companion; the answer is injected as plugin-sourced context for the next admitted request. Untouched by this redesign.

**The panel, not a picker.** The composer card keeps the trigger and the Angel toggle, and turns the rest into configuration: mode rows show the assigned model dimmed beside the name, hovering slides the model catalog in from the right (140ms), the pencil opens a custom-instruction editor, and the effective mode — the model's own routing choice — carries the check. Custom menu instead of the shared Menu primitive because the animation and the dual-pane layout belong to this surface alone.

## Alternatives considered

**Keeping the manual picker.** Rejected: the user's division of labor is "I place models, the agent uses them when the task fits"; a picker made the human the router.

**Pre-turn classification calls.** Rejected: an extra model call taxes every message's latency; the model routing itself at task start costs one cheap tool call only when a specialized mode fits.

**Forking tool-subagent for per-call subtypes.** Rejected: `SubagentStartRequest` already carries per-start `agentOptions` and the prompt is the persona carrier; five thin tools over `ctx.subagents.start()` reuse the seam without forking the official tool.

**Config-file assignments.** Rejected as the primary path — the user explicitly refused file editing; settings give live reads, schema validation, and the existing RPC for free.

## Consequences

The user assigns models once in the panel; the model picks scout/revisor/design/agents per task and can delegate each mode as a subagent subtype with its own model and instruction. Costs: the routing section is a fixed ~90-token per-request prefix; a routed switch applies from the step after `select_mode`, so the first request of a newly routed task runs on the previous model; mode delegation is foreground one-shot only; angel's model still comes from config.

Evidence: `fork/packages/agent/modes/tests` (29) and `fork/packages/client/ui-agent-modes/tests` (10) over the rewritten packages, plus the unchanged fork apiproxy suite (378) over the ref-publishing gateway line.

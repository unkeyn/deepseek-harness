# @deepseek-ai/dsh-fork-agent-modes

Per-session roster of specialized working modes that the MODEL routes itself: the model calls `select_mode` at the start of a task that fits a mode, `subagent_<mode>` tools delegate work to mode subtypes, and the user assigns each mode its model and custom instruction from the composer menu — persisted in the `agent-mode-assignments` settings namespace, no config file required. State is durable session events, so resume, fork, and replay recover it from the log alone.

## The roster

- `default` — general work; the model needs no call to stay here.
- `scout` — fast, read-only codebase exploration ("where is everything").
- `revisor` — careful examination: finding, collecting, and verifying information.
- `design` — user-facing design work.
- `agents` — work coordinated across several subagent delegations.
- Legacy `smol`/`big`/`code` ids stay valid in old logs and the `/mode` command but are not exposed by the routing surface.
- `angel` — a toggle, not a mode (see below).

## How routing works

An always-on `agent-mode:routing` prompt section (order 45) tells the model when each mode fits and to call `select_mode` once at a fitting task's start. The tool appends `agent-mode/selected`, and the mode's assigned model — resolved through `ctx.llm.resolveCallConfig` and written through the gateway selection registry (`@deepseek-ai/dsh-fork-agent-model-selection`) — takes effect from the next step, alongside the mode's instruction section (`agent-mode:instruction`, order 50). Returning to `default` clears the model override.

## Mode subagents

`subagent_default`, `subagent_agents`, `subagent_design`, `subagent_revisor`, and `subagent_scout` start a child on the configured `ctx.subagents` provider (default `spawn`) with the mode's instruction prepended to the task prompt and the mode's assigned model as the child's `agentOptions`. Foreground one-shot runs; an abnormal stop reason surfaces as a tool error with the provider's diagnostic.

## User assignments

The `agent-mode-assignments` settings namespace holds `{ models: { <mode>: { provider, model, reasoningEffort? } }, instructions: { <mode>: text }, presets: { <name>: { models, instructions } } }`. The composer menu writes it through the settings RPC; the controller reads it live. An unassigned mode uses the session's own model and the built-in instruction; `roles.*.instruction` in the plugin config remains a static fallback. A preset snapshots the complete models+instructions configuration under a name; applying one replaces the models and instructions maps wholesale while keeping every saved preset.

## Durable state and commands

`agent-mode/selected` (`{ mode }`) and `agent-mode/angel` (`{ enabled }`) are log-only, whole-value-replace `SessionEventMap` members; `foldSelected`/`foldAngel` fold them. `/mode <name>` and `/angel [on|off]` remain available as manual overrides. The `agentMode` session projection folds `{ selected, angel }` for UIs.

## Configuration

```yaml
- id: agent-modes
  name: '@deepseek-ai/dsh-fork-agent-modes'
  config: {}
  # Optional angel companion:
  # config:
  #   angel: { provider: deepseek-official, model: deepseek-chat, maxTokens: 512 }
```

`angel.provider`/`angel.model` are required when the section is present; `angel.instruction` replaces the built-in companion prompt; `delegationProvider` names the `ctx.subagents` provider (default `spawn`). Unknown keys fail at load (Schemastery).

## Model Experience

### Routing and instruction sections

- **What the model sees** — the routing guidance (~90 tokens) on every request; the active mode's instruction at order 50 when it differs from empty.
- **Token effect** — routing guidance is a fixed per-request cost; the instruction adds its length while active.
- **KV Cache effect** — routing guidance is stable (prefix-friendly); a mode switch rewrites the prompt from order 50 onward.

### Mode subagent delegation

- **What the model sees** — the child's final text as `{ result }`; failures carry the stop reason and diagnostic.
- **Token effect** — the child conversation is separate; the parent pays the tool result only.
- **KV Cache effect** — an ordinary tool result appended to the parent history.

### Angel injection

- **What the model sees** — one plugin-sourced user message ("Angel companion notes…") landing in the next admitted request after the triggering message.
- **Token effect** — the answer's length once, plus the companion call itself (never in the main transcript).
- **KV Cache effect** — append-only growth after the reusable prefix.

## Known Limitations and Deferred Work

- A mode's assigned model applies from the step after `select_mode`, so the first request of a newly routed task still runs on the previous model.
- Mode delegation tools are foreground one-shot; background and continuable delegation remain the main `subagent` tool's surface.
- Angel's companion model comes from config, not the assignments UI.
- The assigned model is validated at selection time, so a stale provider/model pairing fails that selection with a named error instead of at assignment time.

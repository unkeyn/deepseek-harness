# @deepseek-ai/dsh-request-rescuer

English | [中文](README.zh.md)

A second-chance executor beside the exact-provider retry policy: on the agent loop's `agent/request-error` waterfall it delegates first (`await next()`), and only when the exact-provider executor declined — the failure's normalized code is outside every configured `retryableCodes` — does it check the failure's own vocabulary against configured transient patterns. A gateway answering 400 with an `upstream_unavailable` body normalizes to `INVALID_REQUEST` and otherwise kills the turn; a matching pattern rescues it with bounded, jittered backoff and a `{ kind: 'retry' }` decision. Every rescue is durable under a `rescuer:`-namespaced policy key on the shared `llm/retry` / `llm/retry-started` events, so budgets are read back from the session log (counts survive restarts) and the UI shows the same retry status it shows for policy retries.

## Config

```yaml
- id: request-rescuer
  name: '@deepseek-ai/dsh-request-rescuer'
  config:
    patterns:
      - match: 'upstream[_ -]?(unavailable|error)'  # regex source, case-insensitive, tested against "code message"
        codes: ['INVALID_REQUEST']                  # optional gate on normalized codes; empty means any
        maxRetries: 4                               # per request coordinate (turn+step+provider+rule)
        initialDelayMs: 1000                        # backoff floor; doubles per attempt
        maxDelayMs: 20000                           # backoff ceiling
```

`patterns` defaults to `[]` — inert by choice, never guessing. Each entry fails loud at load: an uncompilable `match`, a non-integer or sub-1 bound, or `initialDelayMs` above `maxDelayMs`. Rules evaluate in order; the first match owns the failure.

## Chain semantics

- **Delegation first.** The rescuer awaits the downstream decision before acting: a failure the exact-provider executor retries (or any later listener recovers) is never double-scheduled. The design is registration-order independent — whichever order the two executors mount, the rescuer acts only on a declined failure.
- **Durable budget.** Prior attempts are counted by scanning the session log for `llm/retry` events under the rule's own policy key at the same `turn`/`step`/`provider`; the retry chain keeps one stable `retryId` across its attempts.
- **Abort cooperation.** The rescue wait fuses the turn signal with the plugin lifetime; an aborted wait schedules nothing further and preserves the original failure.
- **No vocabulary, no rescue.** A failure that matches no pattern (or a pattern's `codes` gate) passes through untouched — misconfiguration cannot widen what gets retried beyond the declared vocabulary.

## Model Experience

### Scheduled rescue

#### What the model sees

Nothing directly: rescues ride the same non-surface `llm/retry` / `llm/retry-started` status events the policy executor uses, and the retried attempt opens a fresh numbered step like any policy retry.

#### Token effect

Zero model-visible tokens per rescue; the eventual retried request carries the unchanged conversation.

#### KV Cache effect

The failed attempt's prefix stays reusable; the retry replays it warm.

## Known Limitations and Deferred Work

- **Vocabulary-coupled** — patterns match provider prose; a gateway renaming its transient vocabulary needs a config update.
- **AUTH is opt-in** — auto-retrying authentication failures can mask a genuinely expired key, so no default pattern targets them.
- **Per-coordinate budget only** — there is no cross-step circuit breaker; a route failing every step rescues every step within `maxRetries` each time.
- **No provider failover** — the rescue re-aims at the same route; routing elsewhere is the LLM seam's routing decision, not this plugin's.

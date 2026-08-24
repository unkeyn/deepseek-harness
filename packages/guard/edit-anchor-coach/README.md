# @deepseek-ai/dsh-edit-anchor-coach

English | [中文](README.zh.md)

A pre-execute coach for string-anchor editors: before an `edit` call dispatches, it applies the tool's own exact-match rule against the file's current text and, when the call is about to fail, denies it with corrective feedback instead of the tool's bare refusal — where the anchor actually occurs (line numbers, capped at `maxSuggestions` with a total count), which whitespace-only variant exists (per-line normalized comparison), or which current lines the anchor was probably meant to target (word-token overlap, deterministic tie-break by line number). A call the tool would accept is never delayed or denied. The repair decision stays entirely with the model.

## Config

```yaml
- id: edit-anchor-coach
  name: '@deepseek-ai/dsh-edit-anchor-coach'
  config:
    tools: ['edit']          # default; tool-name patterns to coach (`*` wildcards)
    maxSuggestions: 3        # default; candidate locations quoted in one denial
    previewChars: 200        # default; per-snippet quote cap
    maxFileBytes: 2000000    # default; larger files pass through unanalyzed
```

Every numeric field fails loud at plugin load on a non-integer or a value below 1. `tools` entries are predicates over tool names at call time, not registry references — a pattern matching no registered tool is valid.

## Verdict semantics

The coach re-derives the edit tool's verdict from the same facts the tool would read, so a denial is exactly a doomed call whose error now carries the fix:

- **Verbatim, exactly once** — pass through untouched; the tool applies it.
- **Verbatim, several times, without `replace_all`** — denied with every quoted location (`lines 1, 2, 3 — 4 locations total`) and both escapes: extend `old_string` with context or set `replace_all: true`.
- **No verbatim match, whitespace-only variant exists** — denied with the variant location(s) and their current text, quoted under `previewChars`; the model is told to re-read and copy exactly.
- **Nothing normalized matches** — denied with the nearest current lines by shared word tokens (tokens under 3 characters are never distinctive), or an explicit "no line resembles any anchor line".
- **Unreadable path, oversized file, empty anchor, malformed arguments** — pass through unanalyzed; the tool owns those refusals.

Denials ride the pre-execute `deny` decision, so the model sees `Error: edit-anchor-coach: …` as the call's error result — the same channel the tool's own refusal would have used, one round trip earlier in usefulness.

## Model Experience

### Denied ambiguous anchor

#### What the model sees

```markdown
Error: edit-anchor-coach: old_string matches 2 locations in <path> (lines 1, 3). Extend old_string with surrounding context so it matches exactly once, or set replace_all: true to replace every occurrence.
```

#### Token effect

Zero tokens on allowed calls. Each denial replaces the tool's shorter refusal with a bounded diagnostic (`maxSuggestions` × `previewChars` caps the data-dependent text).

#### KV Cache effect

Append-only error results; nothing invalidates the reusable request prefix.

## Known Limitations and Deferred Work

- **Exact-and-normalized matching only** — no fuzzy patch synthesis; the coach locates, it does not rewrite `old_string` for the model.
- **Single-file view** — a stale anchor caused by an unsaved sibling change elsewhere is out of scope.
- **Text files assumed** — binary content read as UTF-8 produces garbage candidates; oversized files bypass analysis instead.
- **Advisory in effect only** — it cannot accept, rewrite, or fast-forward an edit; input rewriting is excluded at the pre-execute seam by design.

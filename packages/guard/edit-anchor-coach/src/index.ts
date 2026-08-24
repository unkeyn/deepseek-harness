/**
 * Edit-anchor coach: a `tools/pre-execute` listener that predicts the two
 * anchor failures an `edit` call is about to hit — a stale or imprecise
 * `old_string` (zero matches) and an ambiguous one (several matches without
 * `replace_all`) — and replaces the tool's bare refusal with corrective
 * feedback computed from the file's CURRENT text: where the anchor actually
 * occurs, which whitespace-only variant exists, or which nearby lines the
 * anchor was probably meant to target.
 *
 * The coach never lets a call through that the tool would refuse anyway, and
 * never refuses one the tool would accept: every verdict is derived from the
 * same exact-match rule the edit tool applies, so a denied call is exactly a
 * doomed call whose error now carries the fix. It is advisory in effect only —
 * the decision of how to repair the anchor stays with the model.
 *
 * @module @deepseek-ai/dsh-edit-anchor-coach
 */

import { readFile, stat } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

export const name = 'edit-anchor-coach'

/**
 * Plugin config, validated by the same-named schemastery schema plus the
 * load-time checks in `apply` (misconfiguration fails loud). `tools` entries
 * are `*`-wildcard predicates over tool names at call time — a pattern
 * matching no registered tool is valid, so deployments running a differently
 * named editor can target it without a registry reference.
 */
export interface Config {
  /** Tool-name patterns the coach analyzes (default `['edit']`). */
  tools?: string[]
  /** Maximum candidate locations quoted in one denial (default `3`). */
  maxSuggestions?: number
  /** Maximum characters of each quoted candidate snippet (default `200`). */
  previewChars?: number
  /** Files larger than this many bytes are passed through unanalyzed (default 2 MiB). */
  maxFileBytes?: number
}

export const Config: z<Config> = z.object({
  tools: z.array(z.string()).default(['edit']),
  maxSuggestions: z.number().default(3),
  previewChars: z.number().default(200),
  maxFileBytes: z.number().default(2_000_000),
})

/** Compile one `*`-wildcard pattern to an anchored RegExp (every other regex metacharacter is matched literally). */
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[|\\{}()[\]^$+?.]/g, String.raw`\$&`)
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`)
}

function validatePositiveInt(name: string, value: number, configSource: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`edit-anchor-coach: invalid ${name} ${value} — must be an integer >= 1 (${configSource})`)
  }
}

/** One analyzed edit call's anchor facts, extracted defensively from parsed arguments. */
interface AnchorRequest {
  readonly filePath: string
  readonly oldString: string
  readonly replaceAll: boolean
}

/** Extract the anchor triple, or `undefined` when the arguments are not a well-formed edit call. */
function anchorOf(exec: ToolExecution): AnchorRequest | undefined {
  const args = exec.arguments
  /* v8 ignore next 3 -- the registry refuses non-object arguments before the pipeline; the array arm defends direct callers only. */
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return undefined
  const record = args as Record<string, unknown>
  if (typeof record['file_path'] !== 'string' || typeof record['old_string'] !== 'string') return undefined
  return {
    filePath: record['file_path'],
    oldString: record['old_string'],
    replaceAll: record['replace_all'] === true,
  }
}

/** Split file text into lines WITHOUT a trailing-empty element for a terminating newline. */
function splitLines(text: string): string[] {
  return text.split('\n').map((line, index, all) => index === all.length - 1 && line === '' ? null : line)
    .filter((line): line is string => line !== null)
}

/** One-based line number of a character offset. */
function lineAt(lines: readonly string[], offset: number): number {
  let counted = 0
  for (const [index, line] of lines.entries()) {
    counted += line.length + 1
    if (offset < counted) return index + 1
  }
  /* v8 ignore next -- every offset comes from indexOf over the same joined text, so it always lands inside a line. */
  return lines.length
}

/** Head-truncate one quoted snippet, marking how much was omitted. */
function preview(text: string, cap: number): string {
  const flat = text.replaceAll(/\s+/g, ' ').trim()
  return flat.length <= cap ? flat : `${flat.slice(0, cap)}… (+${flat.length - cap} more chars)`
}

/** Whitespace-normalized form of one line: edges trimmed, inner runs collapsed. */
function normalizeLine(line: string): string {
  return line.trim().replaceAll(/\s+/g, ' ')
}

/** Lowercase word tokens long enough to be distinctive (used for nearest-line scoring). */
function tokensOf(line: string): Set<string> {
  return new Set(normalizeLine(line).toLowerCase().split(' ').filter(token => token.length >= 3))
}

/**
 * A not-found diagnosis: whitespace-tolerant windows whose per-line normalized
 * content equals the anchor's (`variants`, deduplicated by start line), plus
 * nearest candidates located by shared word tokens when no window matched.
 */
interface NotFoundDiagnosis {
  readonly variants: readonly number[]
  readonly candidates: readonly { readonly line: number; readonly snippet: string }[]
}

function diagnoseNotFound(fileText: string, oldString: string, maxSuggestions: number): NotFoundDiagnosis {
  const fileLines = splitLines(fileText)
  const oldLines = oldString.split('\n')
  const normalizedOld = oldLines.map(normalizeLine)
  if (!normalizedOld.some(line => line.length > 0)) return { variants: [], candidates: [] }
  const variants = new Set<number>()
  for (let start = 0; start + oldLines.length <= fileLines.length; start++) {
    let matched = true
    for (let offset = 0; offset < oldLines.length; offset++) {
      // The loop bound above guarantees every probed index is inside the file.
      if (normalizeLine(fileLines[start + offset] ?? '') !== normalizedOld[offset]) { matched = false; break }
    }
    if (matched) variants.add(start + 1)
    if (variants.size >= maxSuggestions) break
  }
  const candidates: { line: number; snippet: string }[] = []
  if (variants.size === 0) {
    const anchorTokens = new Set(oldLines.flatMap(line => [...tokensOf(line)]))
    if (anchorTokens.size > 0) {
      const scored: { line: number; snippet: string; score: number }[] = []
      for (const [index, line] of fileLines.entries()) {
        let score = 0
        for (const token of tokensOf(line)) {
          if (anchorTokens.has(token)) score++
        }
        if (score > 0) scored.push({ line: index + 1, snippet: line, score })
      }
      scored.sort((left, right) => right.score - left.score || left.line - right.line)
      candidates.push(...scored.slice(0, maxSuggestions))
    }
  }
  return { variants: [...variants], candidates }
}

/**
 * Build the model-facing denial reason for one doomed anchor, or `undefined`
 * when the call would succeed and must pass through untouched.
 * @param request - the extracted anchor facts.
 * @param limits - validated suggestion and size bounds.
 * @returns the denial reason, or nothing to allow the dispatch.
 */
async function coach(
  request: AnchorRequest,
  limits: { maxSuggestions: number; previewChars: number; maxFileBytes: number },
): Promise<string | undefined> {
  if (request.oldString.length === 0) return undefined
  let fileText: string
  try {
    const info = await stat(request.filePath)
    if (!info.isFile() || info.size > limits.maxFileBytes) return undefined
    fileText = await readFile(request.filePath, 'utf8')
  } catch {
    // An unreadable path is the edit tool's own refusal to produce; coaching a
    // path this process cannot see would invent facts about the filesystem.
    return undefined
  }
  const first = fileText.indexOf(request.oldString)
  if (first >= 0) {
    const total = countOccurrences(fileText, request.oldString)
    if (total === 1 || request.replaceAll) return undefined
    const fileLines = splitLines(fileText)
    const lines: number[] = []
    let at = first
    while (at >= 0 && lines.length < limits.maxSuggestions) {
      lines.push(lineAt(fileLines, at))
      at = fileText.indexOf(request.oldString, at + 1)
    }
    const suffix = total > limits.maxSuggestions ? ` — ${total} locations total` : ''
    return `edit-anchor-coach: old_string matches ${total} locations in ${request.filePath}`
      + ` (lines ${lines.join(', ')}${suffix}). Extend old_string with surrounding context so it matches`
      + ' exactly once, or set replace_all: true to replace every occurrence.'
  }
  const diagnosis = diagnoseNotFound(fileText, request.oldString, limits.maxSuggestions)
  if (diagnosis.variants.length > 0) {
    const quoted = diagnosis.variants
      .map(line => `line ${line}: "${preview(fileLineBlock(fileText, line, request.oldString), limits.previewChars)}"`)
      .join('; ')
    return `edit-anchor-coach: old_string has no verbatim match in ${request.filePath}, but a whitespace-only`
      + ` variant exists at ${quoted}. Re-read the file and copy that text exactly into old_string.`
  }
  const nearest = diagnosis.candidates
    .map(candidate => `line ${candidate.line}: "${preview(candidate.snippet, limits.previewChars)}"`)
    .join('; ')
  return `edit-anchor-coach: old_string has no verbatim or whitespace-only match in ${request.filePath}.`
    + ` Current content closest to the anchor: ${nearest || 'no line resembles any anchor line'}.`
    + ' Re-read the file and rebuild old_string from its current text.'
}

/** The multi-line block at a 1-based start line, shaped like the anchor for quoting. */
function fileLineBlock(fileText: string, startLine: number, oldString: string): string {
  const lines = fileText.split('\n')
  return lines.slice(startLine - 1, startLine - 1 + oldString.split('\n').length).join('\n')
}

/** Total non-overlapping occurrences of `needle` in `text`. */
function countOccurrences(text: string, needle: string): number {
  let total = 0
  let at = text.indexOf(needle)
  while (at >= 0) {
    total++
    at = text.indexOf(needle, at + 1)
  }
  return total
}

/**
 * Install the coach's listener.
 * @param ctx - plugin context; the listener is scoped to it and disposed with it.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  // Direct callers may omit fields the schemastery schema would default; every
  // provided value still fails loud here.
  const patterns = ((config.tools as string[] | undefined) ?? ['edit']).map(wildcardToRegExp)
  const limits = {
    maxSuggestions: config.maxSuggestions ?? 3,
    previewChars: config.previewChars ?? 200,
    maxFileBytes: config.maxFileBytes ?? 2_000_000,
  }
  validatePositiveInt('maxSuggestions', limits.maxSuggestions, '`maxSuggestions`')
  validatePositiveInt('previewChars', limits.previewChars, '`previewChars`')
  validatePositiveInt('maxFileBytes', limits.maxFileBytes, '`maxFileBytes`')

  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (!patterns.some(pattern => pattern.test(exec.name))) return next()
    const request = anchorOf(exec)
    if (request === undefined) return next()
    const reason = await coach(request, limits)
    return reason === undefined ? next() : { kind: 'deny', reason }
  })
}

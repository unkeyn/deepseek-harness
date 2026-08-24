import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import * as Coach from '../src/index.ts'
import type { Config } from '../src/index.ts'

/**
 * Behavior suite for the edit-anchor coach, driven through the real tool
 * registry pipeline: verdicts (allow / ambiguous / stale-with-variant /
 * stale-with-candidates), pass-through for unreadable paths and malformed
 * arguments, replace_all semantics, and fail-loud config validation.
 */

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'edit-anchor-coach-'))
  dirs.push(dir)
  return dir
}

/** Mount the runtime + coach; `edit` succeeds with a marker so allows are observable. */
async function harness(config: Config = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(Coach, config)
  ctx.tools.register(defineContentToolFixture({
    name: 'edit',
    description: 'fixture editor',
    parameters: {},
    async execute() { return [{ type: 'text', text: 'EDIT_APPLIED' }] },
  }))
  ctx.tools.register(defineContentToolFixture({
    name: 'other',
    description: 'untracked tool',
    parameters: {},
    async execute() { return [{ type: 'text', text: 'OTHER_OK' }] },
  }))
  return ctx
}

async function runEdit(ctx: Context, args: Record<string, unknown>, name = 'edit'): Promise<string> {
  const result = await ctx.tools.execute({
    callId: CallId('probe-call'),
    name,
    arguments: args,
    signal: new AbortController().signal,
  })
  return result.content.map(block => block.type === 'text' ? block.text : '').join('\n')
}

describe('verdicts', () => {
  it('allows an anchor that matches exactly once', async () => {
    const dir = await scratch()
    const file = join(dir, 'code.ts')
    await writeFile(file, 'const a = 1\nconst b = 2\n')
    const ctx = await harness()

    const out = await runEdit(ctx, { file_path: file, old_string: 'const b = 2', new_string: 'const c = 3' })

    expect(out).toBe('EDIT_APPLIED')
  })

  it('denies an ambiguous anchor with its line numbers and both escapes', async () => {
    const dir = await scratch()
    const file = join(dir, 'dup.ts')
    await writeFile(file, 'x = 1\ny = 9\nx = 1\n')
    const ctx = await harness()

    const out = await runEdit(ctx, { file_path: file, old_string: 'x = 1', new_string: 'z' })

    expect(out).toContain('edit-anchor-coach: old_string matches 2 locations')
    expect(out).toContain('lines 1, 3')
    expect(out).toContain('replace_all: true')
  })

  it('lets a replace_all edit through even when the anchor matches several times', async () => {
    const dir = await scratch()
    const file = join(dir, 'dup.ts')
    await writeFile(file, 'x = 1\nx = 1\n')
    const ctx = await harness()

    const out = await runEdit(ctx, { file_path: file, old_string: 'x = 1', new_string: 'z', replace_all: true })

    expect(out).toBe('EDIT_APPLIED')
  })

  it('coaches a stale anchor to its whitespace-only variant', async () => {
    const dir = await scratch()
    const file = join(dir, 'ws.ts')
    await writeFile(file, 'function f() {\n    return   42\n}\n')
    const ctx = await harness()

    const out = await runEdit(ctx, { file_path: file, old_string: 'return 42', new_string: 'return 0' })

    expect(out).toContain('no verbatim match')
    expect(out).toContain('whitespace-only variant exists at line 2')
    expect(out).toContain('return 42')
    expect(out).toContain('copy that text exactly')
  })

  it('coaches a wholly absent anchor with nearest current content', async () => {
    const dir = await scratch()
    const file = join(dir, 'gone.ts')
    await writeFile(file, 'alpha one\nbeta two\ngamma three\n')
    const ctx = await harness()

    const out = await runEdit(ctx, { file_path: file, old_string: 'beta five\ndelta six', new_string: 'z' })

    expect(out).toContain('no verbatim or whitespace-only match')
    expect(out).toContain('line 2:')
    expect(out).toContain('beta two')
    expect(out).toContain('Re-read the file')
  })

  it('passes an unreadable path through so the edit tool produces its own refusal', async () => {
    const ctx = await harness()

    const out = await runEdit(ctx, { file_path: 'Z:/definitely/absent/file.ts', old_string: 'a', new_string: 'b' })

    // The fixture "edit" has no real-file opinion; the coach added nothing and
    // the call dispatched, which is the contract: the tool owns path refusals.
    expect(out).toBe('EDIT_APPLIED')
  })
})

describe('pass-through edges', () => {
  it('does not analyze tools outside the configured patterns', async () => {
    const dir = await scratch()
    const file = join(dir, 'dup.ts')
    await writeFile(file, 'q\nq\n')
    const ctx = await harness()

    const out = await runEdit(ctx, { file_path: file, old_string: 'q', new_string: 'r' }, 'other')

    expect(out).toBe('OTHER_OK')
  })

  it('matches configured patterns by wildcard', async () => {
    const dir = await scratch()
    const file = join(dir, 'dup.ts')
    await writeFile(file, 'q\nq\n')
    const ctx = await harness({ tools: ['ed*'] })

    const out = await runEdit(ctx, { file_path: file, old_string: 'q', new_string: 'r' })

    expect(out).toContain('edit-anchor-coach: old_string matches 2 locations')
  })

  it('ignores argument shapes without an anchor triple instead of throwing', async () => {
    const ctx = await harness()

    // The registry itself refuses non-object arguments before the pipeline;
    // what reaches the coach is an object lacking file_path/old_string.
    for (const args of [{ other: true }, { file_path: 7, old_string: null }, {}]) {
      const out = await runEdit(ctx, args as Record<string, unknown>)
      expect(out).toBe('EDIT_APPLIED')
    }
  })

  it('lets an empty anchor through for the tool to refuse', async () => {
    const dir = await scratch()
    const file = join(dir, 'a.ts')
    await writeFile(file, 'text\n')
    const ctx = await harness()

    const out = await runEdit(ctx, { file_path: file, old_string: '', new_string: 'x' })

    expect(out).toBe('EDIT_APPLIED')
  })

  it('passes a directory path through unanalyzed', async () => {
    const dir = await scratch()
    const ctx = await harness()

    const out = await runEdit(ctx, { file_path: dir, old_string: 'absent', new_string: 'z' })

    expect(out).toBe('EDIT_APPLIED')
  })

  it('skips files above maxFileBytes unanalyzed', async () => {
    const dir = await scratch()
    const file = join(dir, 'big.ts')
    await writeFile(file, `padding\n${'x'.repeat(64)}\npadding\n`)
    const ctx = await harness({ maxFileBytes: 16 })

    const out = await runEdit(ctx, { file_path: file, old_string: 'absent-anchor', new_string: 'z' })

    expect(out).toBe('EDIT_APPLIED')
  })
})

describe('suggestion bounds', () => {
  it('caps quoted variants at maxSuggestions', async () => {
    const dir = await scratch()
    const file = join(dir, 'many.ts')
    await writeFile(file, ' q \nq\n  q  \n\tq\t\nother\n')
    const ctx = await harness()

    // The padded anchor matches none of the lines verbatim, but all four
    // normalize to the same text.
    const out = await runEdit(ctx, { file_path: file, old_string: '   q   ', new_string: 'r' })

    expect(out).toContain('whitespace-only variant exists at line')
    expect(out.match(/line \d+/g)).toHaveLength(3)
  })

  it('notes the total when verbatim matches exceed the suggestion cap', async () => {
    const dir = await scratch()
    const file = join(dir, 'five.ts')
    await writeFile(file, 'q\nq\nq\nq\nkeep\n')
    const ctx = await harness()

    const out = await runEdit(ctx, { file_path: file, old_string: 'q', new_string: 'r' })

    expect(out).toContain('matches 4 locations')
    expect(out).toContain('4 locations total')
    expect(out).toContain('lines 1, 2, 3')
  })

  it('says when no line resembles any anchor line', async () => {
    const dir = await scratch()
    const file = join(dir, 'short.ts')
    await writeFile(file, 'alpha one\nbeta two\n')
    const ctx = await harness()

    // Every anchor token is under the 3-char distinctiveness floor.
    const out = await runEdit(ctx, { file_path: file, old_string: 'a b\nc d', new_string: 'z' })

    expect(out).toContain('no line resembles any anchor line')
  })

  it('declines a blank-line anchor without inventing candidates', async () => {
    const dir = await scratch()
    const file = join(dir, 'blank.ts')
    await writeFile(file, 'alpha one\n\nbeta two\n')
    const ctx = await harness()

    const out = await runEdit(ctx, { file_path: file, old_string: '\n \n', new_string: 'z' })

    expect(out).toContain('no line resembles any anchor line')
  })

  it('orders equal-score candidates by line number', async () => {
    const dir = await scratch()
    const file = join(dir, 'tie.ts')
    await writeFile(file, 'gamma beta\ngamma alpha\n')
    const ctx = await harness()

    const out = await runEdit(ctx, { file_path: file, old_string: 'beta alpha zzz', new_string: 'z' })

    expect(out.indexOf('line 1:')).toBeGreaterThan(-1)
    expect(out.indexOf('line 1:')).toBeLessThan(out.indexOf('line 2:'))
  })

  it('truncates long quoted snippets at previewChars', async () => {
    const dir = await scratch()
    const file = join(dir, 'long.ts')
    const long = `return ${'x'.repeat(400)}`
    await writeFile(file, `${long}\n`)
    const ctx = await harness()

    // Same text behind edge whitespace: a whitespace-only variant, whose
    // quoted block exceeds the preview cap.
    const out = await runEdit(ctx, { file_path: file, old_string: `  ${long}  `, new_string: 'z' })

    expect(out).toContain('whitespace-only variant exists')
    expect(out).toContain('… (+')
  })
})

describe('config validation', () => {
  it('fails loud on non-positive integers', () => {
    expect(() => Coach.apply(new Context(), { maxSuggestions: 0 })).toThrow(/maxSuggestions/)
    expect(() => Coach.apply(new Context(), { previewChars: 1.5 })).toThrow(/previewChars/)
    expect(() => Coach.apply(new Context(), { maxFileBytes: -1 })).toThrow(/maxFileBytes/)
  })
})

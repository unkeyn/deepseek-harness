import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as BudgetContext from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await import('node:fs/promises').then(fs => fs.rm(root!, { recursive: true, force: true }))
  root = undefined
})

/** Load the shipped zero-config order through the real Loader with in-memory modules. */
async function loadYaml(lines: readonly string[]): Promise<Context> {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { pathToFileURL } = await import('node:url')
  root = await mkdtemp(join(tmpdir(), 'dsh-budget-context-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...lines, ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-token-meter', TokenMeter],
    ['@deepseek-ai/dsh-fork-budget-context', BudgetContext],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('real Loader composition', () => {
  it('loads and disposes the shipped token-meter, system-prompt, budget-context order', async () => {
    const loaded = await loadYaml([
      "- name: '@deepseek-ai/dsh-token-meter'",
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-fork-budget-context'",
    ])
    expect(loaded.get('compactionPolicy')).toBeUndefined()

    // Without the fork compaction policy the contribution renders nothing but
    // the composition itself must be live and disposable.
    const session = Session.create(SessionId('loader-budget'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'x'.repeat(8_000) }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    const assembly = await loaded.systemPrompt.assemble({ agent: { session } as never })
    expect(assembly.contexts.find(entry => entry.name === 'session:budget')?.text ?? '').toBe('')
  })
})

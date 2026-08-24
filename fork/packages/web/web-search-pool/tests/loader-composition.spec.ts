import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WebRuntime from '@deepseek-ai/dsh-fork-web'
import * as Pool from '../src/index.ts'
import { WEB_SEARCH_POOL_SETTINGS_NAMESPACE } from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('web-search-pool through a real Loader composition', () => {
  it('mounts the pool provider, registers its settings namespace, and exposes the management tools', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-web-search-pool-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-system-prompt'",
      "- name: '@deepseek-ai/dsh-tools'",
      "- name: '@deepseek-ai/dsh-fork-web'",
      '  config:',
      '    searchProviders: [custom-pool]',
      "- name: '@deepseek-ai/dsh-fork-web-search-pool'",
      '  config:',
      '    providers:',
      '      - id: provider-a',
      '        name: Provider A',
      '        endpoint: https://search.example.test/api',
      '        keys:',
      '          - id: key-1',
      '            ref: CUSTOM_KEY_A',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    // The settings and credentials backends are infrastructure doubles: the
    // composition under test is the Loader wiring of the pool plugin, its seam,
    // and the tool/prompt registries.
    const registered = new Map<string, unknown>()
    context.provide('settings', {
      register: (ns: string, _schema: unknown, options: { base?: unknown }) => {
        registered.set(ns, options?.base)
        return { get: () => options?.base }
      },
      get: (ns: string) => registered.get(ns),
      update: vi.fn(async (ns: string, patch: unknown) => { registered.set(ns, patch) }),
    } as never)
    context.provide('credentials', {
      resolve: vi.fn(async () => ({ value: 'secret-a', source: 'test' })),
      describe: vi.fn(async () => ({ configured: true, writable: true })),
      set: vi.fn(),
      unset: vi.fn(),
    } as never)
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier === '@deepseek-ai/dsh-system-prompt') return SystemPrompt
        if (specifier === '@deepseek-ai/dsh-tools') return ToolRuntime
        if (specifier === '@deepseek-ai/dsh-fork-web') return WebRuntime
        if (specifier === '@deepseek-ai/dsh-fork-web-search-pool') return Pool
        throw new Error(`unexpected Loader import: ${specifier}`)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    expect(registered.has(WEB_SEARCH_POOL_SETTINGS_NAMESPACE)).toBe(true)
    expect(context.web.search).toBeTypeOf('function')
    const names = context.tools.schemas().map(schema => schema.name)
    expect(names).toEqual(expect.arrayContaining(['web_search_pool_status', 'web_search_pool_rotate']))
  })
})

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import * as yaml from 'js-yaml'
import { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'

const ROOT = new URL('../../..', import.meta.url)

const replacements = [
  ['llm', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-fork-llm'],
  ['llm-retry', '@deepseek-ai/dsh-llm-retry', '@deepseek-ai/dsh-fork-llm-retry'],
  ['llm-pi-ai', '@deepseek-ai/dsh-llm-pi-ai', '@deepseek-ai/dsh-fork-llm-pi-ai'],
  ['llm-deepseek', '@deepseek-ai/dsh-llm-deepseek', '@deepseek-ai/dsh-fork-llm-deepseek'],
  ['web', '@deepseek-ai/dsh-web', '@deepseek-ai/dsh-fork-web'],
  ['compaction-basic', '@deepseek-ai/dsh-compaction-basic', '@deepseek-ai/dsh-fork-compaction-basic'],
  ['api-gateway', '@deepseek-ai/dsh-host-apiproxy', '@deepseek-ai/dsh-fork-host-apiproxy'],
  ['cordis-client-runner', '@deepseek-ai/dsh-cordis-client-runner', '@deepseek-ai/dsh-fork-cordis-client-runner'],
  ['ui-layout', '@deepseek-ai/dsh-client-ui-layout', '@deepseek-ai/dsh-fork-client-ui-layout'],
  ['ui-conversation', '@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-fork-client-ui-conversation'],
  ['ui-model-selection', '@deepseek-ai/dsh-client-ui-model-selection', '@deepseek-ai/dsh-fork-client-ui-model-selection'],
  ['ui-settings-models', '@deepseek-ai/dsh-client-ui-settings-models', '@deepseek-ai/dsh-fork-client-ui-settings-models'],
  ['ui-settings-plugins', '@deepseek-ai/dsh-client-ui-settings-plugins', '@deepseek-ai/dsh-fork-client-ui-settings-plugins'],
] as const

async function loadPatch(path: string): Promise<EntryOptions[]> {
  const data = yaml.load(await readFile(new URL(path, ROOT), 'utf8'), { schema: entryListSchema })
  if (!Array.isArray(data)) throw new Error(`${path} is not an entry list`)
  return data as EntryOptions[]
}

function collect(entries: EntryOptions[], result: EntryOptions[] = []): EntryOptions[] {
  for (const entry of entries) {
    result.push(entry)
    if (entry.group && Array.isArray(entry.config)) collect(entry.config, result)
  }
  return result
}

describe('fork bundle composition', () => {
  it('disables official rows and mounts each fork replacement', async () => {
    let rows: EntryOptions[] = []
    const warnings: string[] = []
    for (const path of [
      'packages/bundle/base/cordis.patch.yml',
      'packages/bundle/web-app/cordis.patch.yml',
      'fork/bundle/cordis.patch.yml',
    ]) {
      rows = applyEntryPatches(rows, await loadPatch(path), (message) => warnings.push(message))
    }

    expect(warnings).toEqual([])
    const all = collect(rows)
    const ids = all.map(entry => entry.id).filter((id): id is string => id !== undefined)
    expect(new Set(ids).size).toBe(ids.length)

    for (const [id, officialName, forkName] of replacements) {
      expect(all.find(entry => entry.id === id)).toMatchObject({ id, name: officialName, disabled: true })
      expect(all.find(entry => entry.id === `${id}-fork`)).toMatchObject({ id: `${id}-fork`, name: forkName })
    }

    expect(all.find(entry => entry.id === 'web-fork')).toMatchObject({
      config: { searchProviders: ['custom-pool', 'deepseek-official'] },
    })
    expect(all.find(entry => entry.id === 'tool-web')).toMatchObject({
      name: '@deepseek-ai/dsh-tool-web',
      disabled: true,
    })
    expect(all.find(entry => entry.id === 'tool-web-fork')).toMatchObject({
      name: '@deepseek-ai/dsh-tool-web',
      config: { searchTimeoutMs: 60_000 },
    })
    expect(all.find(entry => entry.id === 'web-fetch-fork')).toMatchObject({
      name: '@deepseek-ai/dsh-fork-web-fetch-http',
    })
    for (const id of [
      'model-catalog-fork', 'compaction-policy-fork', 'budget-context', 'credential-health',
      'credential-pool-store', 'credential-broker', 'web-search-brave-fork',
      'web-search-firecrawl-fork', 'web-search-pool', 'freebuff-rpc',
    ]) expect(all.some(entry => entry.id === id)).toBe(true)
    expect(all.find(entry => entry.id === 'budget-context')).toMatchObject({
      name: '@deepseek-ai/dsh-fork-budget-context',
    })
    expect(all.find(entry => entry.id === 'command-freebuff-login')).toMatchObject({
      name: '@deepseek-ai/dsh-fork-command-freebuff',
    })

    const restored = applyEntryPatches(rows, [
      { id: 'llm-fork', disabled: true },
      { id: 'llm', disabled: false },
    ], (message) => warnings.push(message))
    expect(restored.find(entry => entry.id === 'llm')).toMatchObject({ disabled: false })
    expect(restored.find(entry => entry.id === 'llm-fork')).toMatchObject({ disabled: true })
  })
})

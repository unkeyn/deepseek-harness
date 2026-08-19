import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Storage from '@deepseek-ai/dsh-storage'
import { apply as applyJson, Config as JsonConfig } from '@deepseek-ai/dsh-storage-json'
import CredentialPoolStore from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('credential pool store through a real Loader composition', () => {
  it('mounts storage, JSON backend, and pool store from Cordis rows', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pool-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-storage'",
      "- name: '@deepseek-ai/dsh-storage-json'",
      '  config:',
      `    root: ${root.replaceAll('\\', '/')}`,
      "- name: '@deepseek-ai/dsh-credential-pool-store'",
      '  config:',
      '    backend: json',
      '    unitName: credential_pools',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier === '@deepseek-ai/dsh-storage') return Storage
        if (specifier === '@deepseek-ai/dsh-storage-json') return { apply: applyJson, Config: JsonConfig, inject: ['storage'] }
        if (specifier === '@deepseek-ai/dsh-credential-pool-store') return CredentialPoolStore
        throw new Error(`unexpected Loader import: ${specifier}`)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    expect(context.credentialPoolStore.getSnapshot()).toEqual({ version: 3, generation: 0, pools: [], credentials: [] })
  })
})

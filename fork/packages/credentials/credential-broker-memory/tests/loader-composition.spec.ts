import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { MemoryCredentialBroker } from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('credential broker memory through a real Loader composition', () => {
  it('mounts configured entries and exposes only pool metadata', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-broker-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@deepseek-ai/dsh-fork-credential-broker-memory'",
      '  config:',
      '    entries:',
      '      - pool: main',
      '        credential: key-a',
      '        reference: DEEPSEEK_API_KEY',
      '        authKind: api-key',
      '',
    ].join('\n'))

    context = new Context()
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier === '@deepseek-ai/dsh-fork-credential-broker-memory') return { apply: (await import('../src/index.ts')).apply, MemoryCredentialBroker }
        throw new Error(`unexpected Loader import: ${specifier}`)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({
      name: 'cordis:include',
      config: { path: pathToFileURL(configPath).href },
    })
    await context.loader.await()

    expect(context.credentialBroker).toBeInstanceOf(MemoryCredentialBroker)
    expect(context.credentialBroker.listPools()).toEqual(['main'])
  })
})

import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import * as LlmBearer from '../src/index.ts'

let root: string | undefined
let context: Context | undefined
let server: Server | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (server !== undefined) await new Promise(resolve => server?.close(resolve))
  server = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

function jwt(exp: number): string {
  return `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`
}

async function endpoint(): Promise<string> {
  server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end([
        'data: {"type":"run_start","session_id":"loader-session"}',
        '',
        'data: {"type":"text_delta","content":"loaded"}',
        '',
        'data: {"type":"done"}',
        '',
        'data: [DONE]',
        '',
        '',
      ].join('\n'))
    })
  })
  await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock server has no port')
  return `http://127.0.0.1:${address.port}`
}

describe('llm-bearer real composition', () => {
  it('boots dormant and serves a route added through settings with a managed credential', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-bearer-composition-'))
    const settingsPath = join(root, 'settings.yaml')
    await writeFile(settingsPath, '# personal settings\n')
    await writeFile(
      join(root, '.credentials.yaml'),
      `TWINMIND_BEARER_TOKEN: ${jwt(Math.floor(Date.now() / 1000) + 3600)}\n`,
      { mode: 0o600 },
    )
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      '- id: llm',
      "  name: 'test-llm-service'",
      '- id: settings',
      "  name: '@deepseek-ai/dsh-settings-file'",
      '  config:',
      `    path: ${JSON.stringify(settingsPath)}`,
      '    debounceMs: 10',
      '- id: credentials',
      "  name: '@deepseek-ai/dsh-credentials-local'",
      '  config:',
      `    path: ${JSON.stringify(join(root, '.credentials.yaml'))}`,
      '    debounceMs: 10',
      '- id: llm-bearer',
      "  name: '@deepseek-ai/dsh-llm-bearer'",
      '',
    ].join('\n'))

    const ctx = new Context()
    context = ctx
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['test-llm-service', LlmRuntime],
      ['@deepseek-ai/dsh-settings-file', FileSettingsProvider],
      ['@deepseek-ai/dsh-credentials-local', LocalCredentialProvider],
      ['@deepseek-ai/dsh-llm-bearer', LlmBearer],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    expect(ctx.llm.listProviders()).toEqual([])

    await writeFile(settingsPath, [
      'llm-bearer:',
      '  providers:',
      '    twinmind:',
      '      auth:',
      '        type: bearer',
      '        accessTokenEnv: TWINMIND_BEARER_TOKEN',
      '      api: twinmind-chat',
      `      baseURL: ${await endpoint()}`,
      '      models:',
      '        - id: auto',
      '',
    ].join('\n'))
    await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id), { timeout: 5000 })
      .toEqual(['twinmind'])

    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream({
      provider: 'twinmind',
      model: 'auto',
      messages: [createUserMessage({ content: [{ type: 'text', text: 'Hello' }], source: { kind: 'user' } })],
    })) assembler.push(chunk)
    expect(assembler.message({ kind: 'model', provider: 'twinmind', model: 'auto' }).content)
      .toEqual([{ type: 'text', text: 'loaded' }])
  })
})

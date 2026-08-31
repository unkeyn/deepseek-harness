import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { z } from 'zod'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { BearerProviderBridgeEntry, BearerProviderDirectory } from '@deepseek-ai/dsh-fork-llm-bearer'
import * as bridgePlugin from '../src/index.ts'

const signal = new AbortController().signal

describe('Bearer MCP bridge', () => {
  let ctx: Context
  let server: Server
  let root: string
  let endpoint: string
  let setBridgeEnabled: (enabled: boolean) => void = () => {}
  const authorization: string[] = []

  function safePath(path: string): string {
    const candidate = resolve(path)
    if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) throw new Error('path escaped test root')
    return candidate
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    authorization.push(request.headers.authorization ?? '')
    const mcp = new McpServer(
      { name: 'bearer-bridge-test', version: '1.0.0' },
      { capabilities: { tools: {} } },
    )
    mcp.registerTool('write_file', {
      description: 'Write one file in the test directory.',
      inputSchema: { path: z.string(), content: z.string() },
    }, async args => {
      await writeFile(safePath(args.path), args.content, 'utf8')
      return { content: [{ type: 'text', text: 'written' }] }
    })
    mcp.registerTool('read_file', {
      description: 'Read one file in the test directory.',
      inputSchema: { path: z.string() },
    }, async args => ({ content: [{ type: 'text', text: await readFile(safePath(args.path), 'utf8') }] }))
    mcp.registerTool('list_directory', {
      description: 'List files in the test directory.',
      inputSchema: { path: z.string() },
    }, async args => ({ content: [{ type: 'text', text: (await readdir(safePath(args.path))).join('\n') }] }))
    mcp.registerTool('delete_file', {
      description: 'Delete one file in the test directory.',
      inputSchema: { path: z.string() },
    }, async args => {
      await unlink(safePath(args.path))
      return { content: [{ type: 'text', text: 'deleted' }] }
    })
    const transport = new StreamableHTTPServerTransport({})
    response.on('close', () => { void transport.close(); void mcp.close() })
    await mcp.connect(transport as Transport)
    await transport.handleRequest(request, response)
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-bearer-bridge-test-'))
    server = createServer((request, response) => {
      handle(request, response).catch(error => { response.writeHead(500).end(String(error)) })
    })
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolveListen())
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server did not receive a TCP address')
    endpoint = `http://127.0.0.1:${address.port}/mcp`

    const entry: BearerProviderBridgeEntry = {
      provider: 'test',
      displayName: 'Test Bearer',
      chatURL: 'https://chat.example.test/v1/chat',
      bridge: {
        enabled: true,
        endpoint,
        tokenExchange: false,
        toolCallTimeoutMs: 15_000,
      },
      tokenRefs: ['TEST_BEARER_TOKEN'],
      resolveToken: async () => 'bridge-test-token',
    }
    let enabled = true
    const watchers = new Set<() => void>()
    setBridgeEnabled = (next) => {
      enabled = next
      for (const watcher of watchers) watcher()
    }
    const directory: BearerProviderDirectory = {
      list: () => enabled ? [entry] : [],
      subscribe: (listener) => {
        watchers.add(listener)
        return () => { watchers.delete(listener) }
      },
    }
    ctx = new Context()
    ctx.provide('bearerProviders', directory)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const bridgeFiber = ctx.plugin(bridgePlugin)
    await bridgeFiber.await()
  }, 30_000)

  afterAll(async () => {
    if (ctx) await ctx.fiber.dispose()
    await new Promise<void>(resolveClose => { server.close(() => resolveClose()) })
    await rm(root, { recursive: true, force: true })
  })

  it('publishes one stable tool namespace for the Bearer provider', () => {
    const names = ctx.tools.schemas().map(tool => tool.name)
    expect(names).toEqual(expect.arrayContaining([
      'mcp__bearer_test__write_file',
      'mcp__bearer_test__read_file',
      'mcp__bearer_test__list_directory',
      'mcp__bearer_test__delete_file',
    ]))
  })

  it('performs write, read, list, and delete through the mounted MCP tools', async () => {
    const filePath = join(root, 'test.txt')
    const call = async (name: string, args: Record<string, string>) => ctx.tools.execute({
      signal,
      callId: `bearer-bridge-${name}` as never,
      name,
      arguments: args,
    })

    expect((await call('mcp__bearer_test__write_file', { path: filePath, content: 'bridge works' })).isError).toBe(false)
    expect(await readFile(filePath, 'utf8')).toBe('bridge works')

    const read = await call('mcp__bearer_test__read_file', { path: filePath })
    expect(read.isError).toBe(false)
    expect(JSON.stringify(read.content)).toContain('bridge works')

    const listed = await call('mcp__bearer_test__list_directory', { path: root })
    expect(listed.isError).toBe(false)
    expect(JSON.stringify(listed.content)).toContain('test.txt')

    expect((await call('mcp__bearer_test__delete_file', { path: filePath })).isError).toBe(false)
    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(authorization).toContain('Bearer bridge-test-token')
  })

  it('unmounts and remounts tools when the provider checkbox changes', async () => {
    setBridgeEnabled(false)
    await waitFor(() => !ctx.tools.schemas().some(tool => tool.name === 'mcp__bearer_test__read_file'))
    setBridgeEnabled(true)
    await waitFor(() => ctx.tools.schemas().some(tool => tool.name === 'mcp__bearer_test__read_file'))
  })
})

describe('Bearer MCP bridge namespaces', () => {
  it('keeps long provider ids stable without truncation collisions', () => {
    const first = bridgePlugin.bridgeServerName('provider-with-a-very-long-name-alpha')
    const second = bridgePlugin.bridgeServerName('provider-with-a-very-long-name-beta')
    expect(first).toMatch(/^[A-Za-z0-9_-]{1,32}$/)
    expect(second).toMatch(/^[A-Za-z0-9_-]{1,32}$/)
    expect(first).not.toBe(second)
  })
})

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) throw new Error('timed out waiting for MCP bridge reconciliation')
    await new Promise<void>(resolveWait => setTimeout(resolveWait, 20))
  }
}

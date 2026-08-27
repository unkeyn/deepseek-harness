import { createServer } from 'node:http'
import type { IncomingMessage, Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import * as LlmBearer from '../src/index.ts'

const servers: Server[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

function jwt(exp: number): string {
  return `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`
}

async function twinMindServer(script: string[][]): Promise<{
  url: string
  paths: string[]
  headers: IncomingMessage['headers'][]
  requests: unknown[]
}> {
  const paths: string[] = []
  const headers: IncomingMessage['headers'][] = []
  const requests: unknown[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => { body += String(chunk) })
    request.on('end', () => {
      paths.push(request.url ?? '')
      headers.push(request.headers)
      requests.push(JSON.parse(body))
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const event of script.shift() ?? []) response.write(`data: ${event}\n\n`)
      response.end()
    })
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock server has no port')
  return { url: `http://127.0.0.1:${address.port}`, paths, headers, requests }
}

async function assemble(ctx: Context, messages: Parameters<typeof createUserMessage>[0][], modelMessages: never[] = []) {
  const assembler = new BlockAssembler()
  const userMessages = messages.map(createUserMessage)
  for await (const chunk of ctx.llm.stream({ provider: 'twinmind', model: 'auto', messages: [...modelMessages, ...userMessages] })) {
    assembler.push(chunk)
  }
  return assembler.message({
    kind: 'model',
    provider: 'twinmind',
    model: 'auto',
    ...assembler.replayState === undefined ? {} : { replayState: assembler.replayState },
  })
}

describe('llm-bearer TwinMind route', () => {
  it('sends Bearer auth to /api/v3/chat and resumes provider state', async () => {
    const eventSet = (sessionId: string, text: string) => [
      JSON.stringify({ type: 'run_start', session_id: sessionId }),
      JSON.stringify({ type: 'text_start', content: text }),
      JSON.stringify({ type: 'done' }),
      '[DONE]',
    ]
    const server = await twinMindServer([eventSet('session-1', 'hello'), eventSet('session-2', 'again')])
    vi.stubEnv('TWINMIND_BEARER_TOKEN', jwt(Math.floor(Date.now() / 1000) + 3600))
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const fiber = await ctx.plugin(LlmBearer, {
      providers: {
        twinmind: {
          auth: { type: 'bearer', accessTokenEnv: 'TWINMIND_BEARER_TOKEN' },
          api: 'twinmind-chat',
          baseURL: server.url,
          models: [{ id: 'auto' }],
        },
      },
    })

    const first = await assemble(ctx, [{ content: [{ type: 'text', text: 'First' }], source: { kind: 'user' } }])
    expect(first.content).toEqual([{ type: 'text', text: 'hello' }])

    const assembler = new BlockAssembler()
    const secondUser = createUserMessage({ content: [{ type: 'text', text: 'Second' }], source: { kind: 'user' } })
    for await (const chunk of ctx.llm.stream({ provider: 'twinmind', model: 'auto', messages: [first, secondUser] })) {
      assembler.push(chunk)
    }
    expect(assembler.message({ kind: 'model', provider: 'twinmind', model: 'auto' }).content)
      .toEqual([{ type: 'text', text: 'again' }])
    expect(server.paths).toEqual(['/api/v3/chat', '/api/v3/chat'])
    expect(server.headers[0]?.authorization).toMatch(/^Bearer header\./)
    expect(server.requests[0]).toMatchObject({ query: 'First', model: 'auto' })
    expect(server.requests[1]).toMatchObject({ query: 'Second', session_id: 'session-1' })
    await fiber.dispose()
    expect(ctx.llm.listProviders()).toEqual([])
  })
})

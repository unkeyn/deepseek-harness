import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverTwinMindModels } from '../src/discovery.ts'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

async function listingServer(): Promise<{ url: string; authorization: () => string | undefined }> {
  let authorization: string | undefined
  const server = createServer((request, response) => {
    authorization = request.headers.authorization
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      default_model: { name: 'auto', display_name: 'Basic', minimum_tier: 'free' },
      providers: [
        {
          id: 'google',
          display_name: 'Google',
          models: [
            { name: 'gemini-thinking', display_name: 'Gemini Thinking', minimum_tier: 'max' },
            { name: 'auto', display_name: 'Duplicate', minimum_tier: 'free' },
          ],
        },
      ],
    }))
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock server has no port')
  return { url: `http://127.0.0.1:${address.port}`, authorization: () => authorization }
}

describe('TwinMind model discovery', () => {
  it('reads the authenticated web-client directory and flattens provider sections', async () => {
    const server = await listingServer()
    await expect(discoverTwinMindModels({
      baseURL: server.url,
      api: 'twinmind-chat',
      apiKey: 'live-token',
    })).resolves.toEqual([
      { id: 'auto', name: 'Basic', inputModalities: ['text'], catalogMatched: false },
      { id: 'gemini-thinking', name: 'Gemini Thinking', inputModalities: ['text'], catalogMatched: false },
    ])
    expect(server.authorization()).toBe('Bearer live-token')
  })
})

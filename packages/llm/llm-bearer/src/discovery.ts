/** TwinMind's authenticated model-directory interrogation. */

import { assertUsableApiKey, attributionHeaders, LlmError } from '@deepseek-ai/dsh-llm'
import type { LlmDiscoveredModel, LlmModelDiscoveryRequest } from '@deepseek-ai/dsh-llm'

const MAX_RESPONSE_BYTES = 1024 * 1024

interface TwinMindModelEntry {
  name?: unknown
  display_name?: unknown
}

interface TwinMindProviderEntry {
  models?: unknown
}

function listingUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '').replace(/\/api\/v3\/chat$/, '')}/api/v3/chat/models`
}

async function readListing(response: Response, url: string): Promise<unknown> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new LlmError(`${url} answered with more than ${MAX_RESPONSE_BYTES} bytes`, 'DISCOVERY_FAILED')
  }
  if (response.body === null) throw new LlmError(`${url} answered without a body`, 'DISCOVERY_FAILED')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        throw new LlmError(`${url} answered with more than ${MAX_RESPONSE_BYTES} bytes`, 'DISCOVERY_FAILED')
      }
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {
      // Cancel after a completed or abandoned bounded read is best-effort response cleanup.
    })
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown
  } catch (error: unknown) {
    throw new LlmError(`${url} did not answer with JSON`, 'DISCOVERY_FAILED', { cause: error })
  }
}

function modelsFrom(body: unknown): readonly LlmDiscoveredModel[] {
  const listing = body as { default_model?: unknown; providers?: unknown } | null
  if (listing === null || !Array.isArray(listing.providers)) {
    throw new LlmError('TwinMind model listing has no providers array', 'DISCOVERY_FAILED')
  }
  const rawModels: unknown[] = [listing.default_model]
  for (const rawProvider of listing.providers) {
    const provider = rawProvider as TwinMindProviderEntry | null
    if (Array.isArray(provider?.models)) rawModels.push(...provider.models as unknown[])
  }
  const models: LlmDiscoveredModel[] = []
  const seen = new Set<string>()
  for (const raw of rawModels) {
    const entry = raw as TwinMindModelEntry | null
    if (typeof entry?.name !== 'string' || entry.name.length === 0 || seen.has(entry.name)) continue
    seen.add(entry.name)
    models.push({
      id: entry.name,
      ...typeof entry.display_name === 'string' && entry.display_name.length > 0
        ? { name: entry.display_name }
        : {},
      inputModalities: ['text'],
      catalogMatched: false,
    })
  }
  return models
}

/**
 * Read TwinMind's web-client model directory for one Bearer draft.
 * @param request - draft endpoint and one-shot Bearer credential.
 * @param storedToken - resolves the named route's stored token when the draft carries none.
 * @returns models advertised by TwinMind in endpoint order.
 */
export async function discoverTwinMindModels(
  request: LlmModelDiscoveryRequest,
  storedToken?: () => Promise<string | undefined>,
): Promise<readonly LlmDiscoveredModel[]> {
  if (request.api !== undefined && request.api !== 'twinmind-chat') {
    throw new LlmError(`Bearer protocol "${request.api}" has no model listing this build can read`, 'DISCOVERY_UNSUPPORTED')
  }
  if (request.baseURL === undefined || request.baseURL.length === 0) {
    throw new LlmError('TwinMind model discovery needs a baseURL', 'DISCOVERY_FAILED')
  }
  const supplied = request.apiKey ?? await storedToken?.()
  if (supplied === undefined) throw new LlmError('TwinMind model discovery needs a Bearer token', 'DISCOVERY_FAILED')
  const token = assertUsableApiKey(supplied, 'llm-bearer', 'Bearer discovery credential')
  const url = listingUrl(request.baseURL)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${token}`, ...attributionHeaders() },
      ...request.signal === undefined ? {} : { signal: request.signal },
    })
  } catch (error: unknown) {
    if (request.signal?.aborted) throw new LlmError('TwinMind model discovery aborted', 'ABORTED', { cause: error })
    throw new LlmError(`could not reach ${url}`, 'DISCOVERY_FAILED', { cause: error })
  }
  if (!response.ok) {
    throw new LlmError(
      `${url} answered ${response.status}${response.status === 401 || response.status === 403 ? '; check the Bearer token' : ''}`,
      'DISCOVERY_FAILED',
    )
  }
  return modelsFrom(await readListing(response, url))
}

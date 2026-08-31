/**
 * Repair the one SSE framing mistake made by some OpenAI-compatible gateways.
 *
 * OpenAI's client expects an empty line between SSE events. A few gateways
 * emit `data: {...}\n data: {...}\n` instead. The payload is otherwise valid,
 * but the client joins those lines into one event and never exposes the final
 * `finish_reason` to pi-ai. This transform preserves a real stream and only
 * inserts a boundary when two consecutive complete JSON `data:` lines prove
 * that the gateway omitted it. Properly framed streams pass through unchanged.
 */

const SSE_CONTENT_TYPE = /(?:^|;)\s*text\/event-stream(?:;|$)/i

function isCompleteDataLine(line: string): boolean {
  if (!line.startsWith('data:')) return false
  const value = line.slice(5).trim()
  if (value === '[DONE]') return true
  if (value.length === 0) return false
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

/** Wrap one response body with a framing-only SSE transform. */
function normalizeResponse(response: Response): Response {
  if (!SSE_CONTENT_TYPE.test(response.headers.get('content-type') ?? '') || response.body === null) {
    return response
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let pending = ''
  let previousCompleteData = false

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read()
        if (next.done) {
          pending += decoder.decode()
          if (pending.length > 0) {
            const completeData = isCompleteDataLine(pending)
            if (completeData && previousCompleteData) controller.enqueue(encoder.encode('\n'))
            controller.enqueue(encoder.encode(`${pending}\n\n`))
          }
          controller.close()
          return
        }

        pending += decoder.decode(next.value, { stream: true })
        const lines = pending.split(/\r?\n/)
        pending = lines.pop() ?? ''
        for (const line of lines) {
          const completeData = isCompleteDataLine(line)
          // The previous line already ended with its newline. This extra
          // newline turns `data A\ndata B` into `data A\n\ndata B`.
          if (completeData && previousCompleteData) controller.enqueue(encoder.encode('\n'))
          controller.enqueue(encoder.encode(`${line}\n`))
          previousCompleteData = completeData
          if (line.trim().length === 0) previousCompleteData = false
        }
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel(reason) {
      await reader.cancel(reason)
    },
  })

  const headers = new Headers(response.headers)
  // A transformed body can be longer than the original one. Fetch normally
  // uses chunked transfer for SSE, but removing this stale header keeps the
  // wrapper correct for gateways that set Content-Length anyway.
  headers.delete('content-length')
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/** Fetch implementation for OpenAI-compatible adapters with tolerant SSE framing. */
export const normalizeOpenAiSseFetch: typeof globalThis.fetch = async (input, init) => {
  const response = await globalThis.fetch(input, init)
  return normalizeResponse(response)
}

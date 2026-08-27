/** TwinMind SSE framing. */

import { EventSourceParserStream } from 'eventsource-parser/stream'
import { LlmError } from '@deepseek-ai/dsh-llm'

/**
 * Decode complete SSE data payloads until TwinMind's terminal sentinel.
 * @param stream - response byte stream carrying event-source framing.
 * @returns complete data payloads, including the terminal sentinel.
 */
export async function* parseSse(stream: ReadableStream<BufferSource>): AsyncGenerator<string> {
  const events = stream
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
  for await (const { data } of events) {
    yield data
    if (data === '[DONE]') return
  }
  throw new LlmError('TwinMind SSE stream ended without [DONE]', 'STREAM_CLOSED')
}

/** Placeholder plugin for the custom OpenAI-compatible package skeleton. */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'llm-openai-compatible'

/**
 * Mount the package skeleton without runtime registrations.
 * @param _ctx - Cordis context reserved for the provider implementation.
 */
export function apply(_ctx: Context): void {}

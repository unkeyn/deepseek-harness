import { createRequire } from 'node:module'

/** Runtime constructor shared with the official LLM package at host boundaries. */
export interface OfficialLlmErrorConstructor {
  new (message: string, code: string, options?: ErrorOptions): Error & { readonly code: string; readonly failure: object }
  readonly prototype: object
}

let cached: OfficialLlmErrorConstructor | undefined

/** Resolve the official error lazily, after the loader has finished importing sibling entries. */
export function resolveOfficialLlmError(): OfficialLlmErrorConstructor | undefined {
  if (cached !== undefined) return cached
  const require = createRequire(import.meta.url)
  try {
    cached = (require('@deepseek-ai/dsh-llm') as { LlmError: OfficialLlmErrorConstructor }).LlmError
    return cached
  } catch (error: unknown) {
    if (error instanceof Error && /Cannot find (?:package|module)/u.test(error.message)) {
      cached = (require('../../../../../packages/llm/llm/lib/index.js') as { LlmError: OfficialLlmErrorConstructor }).LlmError
      return cached
    }
    // Node reports an ESM race when a concurrent loader entry is still
    // evaluating the official module. The next request retries the lookup.
    if (error instanceof Error && (error as { code?: unknown }).code === 'ERR_REQUIRE_ESM_RACE_CONDITION') return undefined
    throw error
  }
}

/** Make fork-created errors pass the official `instanceof LlmError` checks. */
export function adoptOfficialLlmErrorPrototype(ctor: { readonly prototype: object }): void {
  const official = resolveOfficialLlmError()
  if (official !== undefined && !official.prototype.isPrototypeOf(ctor.prototype)) {
    Object.setPrototypeOf(ctor.prototype, official.prototype)
  }
}

/** Recognize official errors without throwing while their ESM module is loading. */
export function isOfficialLlmError(value: unknown): boolean {
  const official = resolveOfficialLlmError()
  return official !== undefined && value instanceof official
}

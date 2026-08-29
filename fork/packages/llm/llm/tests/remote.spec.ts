import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol-runtime'
import { describe, expect, it } from 'vitest'
import LlmRuntime from '../src/index.ts'

describe('llm Remote compatibility', () => {
  it('publishes the provider-directory and discovery methods expected by the current Models page', () => {
    const runtime = new LlmRuntime(new Context())

    expect(remoteMethods(runtime).map(method => method.exportName ?? method.method))
      .toEqual(['listProviders', 'listConfigurableProviders', 'discoverModels'])
  })
})

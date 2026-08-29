import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol-runtime'
import { AuthorizationController } from '../src/index.ts'
import type { AuthorizationFlowView } from '../src/types.ts'

const key = 'llm-pi-ai/openai-codex' as never

describe('AuthorizationController', () => {
  it('publishes the five redacted authorization operations', () => {
    const ctx = new Context()
    ctx.provide('authorization', {
      list: () => [],
      describe: () => undefined,
      cancel: vi.fn(),
    } as never)

    const controller = new AuthorizationController(ctx)

    expect(remoteMethods(controller).map(method => method.exportName ?? method.method))
      .toEqual(['list', 'start', 'state', 'answer', 'cancel'])
  })

  it('carries notices and prompts without returning the submitted answer', async () => {
    const flow: AuthorizationFlowView = {
      key,
      label: 'ChatGPT (Codex)',
      methods: [{ id: 'oauth', label: 'Sign in with ChatGPT' }],
      inFlight: false,
    }
    const answered = vi.fn()
    const auth = {
      list: () => [flow],
      describe: () => flow,
      cancel: vi.fn(),
      begin: async (request: {
        interaction: {
          notify: (notice: { message: string; url?: string }) => void
          prompt: (prompt: { kind: 'text'; message: string }) => Promise<string>
        }
      }) => {
        request.interaction.notify({ message: 'Continue in your browser', url: 'https://example.test/login' })
        const value = await request.interaction.prompt({ kind: 'text', message: 'Paste the callback code' })
        answered(value)
        return { status: 'authorized' as const }
      },
    }
    const ctx = new Context()
    ctx.provide('authorization', auth as never)
    const controller = new AuthorizationController(ctx)

    const { attemptId } = controller.start(key, 'oauth')
    await vi.waitFor(() => expect(controller.state(attemptId)?.prompt).toMatchObject({
      kind: 'text',
      message: 'Paste the callback code',
    }))
    expect(controller.state(attemptId)?.notice).toEqual({
      message: 'Continue in your browser',
      url: 'https://example.test/login',
    })

    controller.answer(attemptId, 'one-time-code')
    await vi.waitFor(() => expect(controller.state(attemptId)?.status).toBe('authorized'))
    expect(answered).toHaveBeenCalledWith('one-time-code')
    expect(controller.state(attemptId)).not.toHaveProperty('answer')
  })
})

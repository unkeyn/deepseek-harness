import { describe, expect, it } from 'vitest'
import { executeFreebuffLoginCommand } from '../src/index.ts'

const signal = new AbortController().signal

describe('Freebuff login command', () => {
  it('returns the device URL and completes the retained challenge', async () => {
    const calls: string[] = []
    const service = {
      async beginLogin() {
        calls.push('begin')
        return {
          fingerprintId: 'client',
          loginUrl: 'https://freebuff.test/device',
          fingerprintHash: 'hash',
          expiresAt: '2030-01-01T00:00:00Z',
        }
      },
      async completePendingLogin() {
        calls.push('complete')
        return {
          challenge: {
            fingerprintId: 'client',
            loginUrl: 'https://freebuff.test/device',
            fingerprintHash: 'hash',
            expiresAt: '2030-01-01T00:00:00Z',
          },
          account: { accountId: 'account-1' },
        }
      },
    }

    await expect(executeFreebuffLoginCommand(service, { rawInput: '', signal })).resolves.toEqual({
      kind: 'success',
      text: 'Open https://freebuff.test/device in a browser, approve the device login, then run /freebuff-login wait.',
    })
    await expect(executeFreebuffLoginCommand(service, { rawInput: 'wait', signal })).resolves.toEqual({
      kind: 'success',
      text: 'Freebuff login completed for account account-1.',
    })
    expect(calls).toEqual(['begin', 'complete'])
  })

  it('rejects unknown actions without touching the service', async () => {
    const service = {
      beginLogin: async () => { throw new Error('must not start') },
      completePendingLogin: async () => { throw new Error('must not complete') },
    }
    await expect(executeFreebuffLoginCommand(service, { rawInput: 'cancel', signal })).resolves.toEqual({
      kind: 'error',
      text: 'Usage: /freebuff-login [wait]',
    })
  })
})

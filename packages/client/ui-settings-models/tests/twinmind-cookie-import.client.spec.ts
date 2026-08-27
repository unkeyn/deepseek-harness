import { describe, expect, it } from 'vitest'
import { twinMindCredentialsFromCookieJson } from '../src/client/twinMindCookieImport.ts'

const JWT = 'header.eyJleHAiOjQxMDI0NDQ4MDB9.signature'

describe('TwinMind cookie import', () => {
  it('extracts only the two credential cookies from an export array', () => {
    expect(twinMindCredentialsFromCookieJson(JSON.stringify([
      { name: 'session', value: JWT, domain: 'app.twinmind.com', httpOnly: true },
      { name: 'analytics', value: 'not-a-credential', domain: '.twinmind.com' },
      { name: 'firebase_refresh_token', value: 'refresh-value', domain: 'app.twinmind.com', httpOnly: true },
    ]))).toEqual({ accessToken: JWT, refreshToken: 'refresh-value' })
  })

  it('rejects malformed, cross-domain, and incomplete exports', () => {
    expect(() => twinMindCredentialsFromCookieJson('nope')).toThrow(/valid JSON/)
    expect(() => twinMindCredentialsFromCookieJson(JSON.stringify([
      { name: 'session', value: JWT, domain: 'evil.example' },
      { name: 'firebase_refresh_token', value: 'refresh-value', domain: 'app.twinmind.com' },
    ]))).toThrow(/session/)
    expect(() => twinMindCredentialsFromCookieJson(JSON.stringify([
      { name: 'session', value: JWT, domain: 'app.twinmind.com' },
    ]))).toThrow(/firebase_refresh_token/)
  })
})

import { describe, expect, it } from 'vitest'
import {
  bearerCredentialsFromCookieJson, refreshImportedFirebaseCredentials,
} from '../src/client/bearerCookieImport.ts'

describe('Bearer cookie import', () => {
  it('extracts common access and refresh cookies without a provider-domain assumption', () => {
    expect(bearerCredentialsFromCookieJson(JSON.stringify({
      cookies: [
        { name: 'session', value: 'access-value', domain: 'provider.example' },
        { name: 'refresh_token', value: 'refresh-value', domain: 'auth.example' },
        { name: 'unrelated', value: 'ignored', domain: 'provider.example' },
      ],
    }))).toEqual({ accessToken: 'access-value', refreshToken: 'refresh-value' })
  })

  it('accepts an authorization cookie and removes its Bearer prefix', () => {
    expect(bearerCredentialsFromCookieJson(JSON.stringify([
      { name: 'authorization', value: 'Bearer access-value' },
    ]))).toEqual({ accessToken: 'access-value' })
  })

  it('recognizes Firebase refresh cookies and fills a known deployment profile', () => {
    expect(bearerCredentialsFromCookieJson(JSON.stringify([
      { name: 'session', value: 'session-value', domain: 'app.twinmind.com' },
      { name: 'firebase_refresh_token', value: 'refresh-value', domain: 'app.twinmind.com' },
    ]))).toEqual({
      accessToken: 'session-value',
      refreshToken: 'refresh-value',
      refresh: {
        endpoint: 'https://securetoken.googleapis.com/v1/token',
        apiKey: 'AIzaSyD2Sd_NP3vA4rwvoroKqDefpXZeCMDXcIQ',
      },
    })
  })

  it('infers the shared Firebase endpoint without inventing an unknown project key', () => {
    expect(bearerCredentialsFromCookieJson(JSON.stringify([
      { name: 'session', value: 'session-value', domain: 'unknown.example' },
      { name: 'firebase_refresh_token', value: 'refresh-value', domain: 'unknown.example' },
    ]))).toEqual({
      accessToken: 'session-value',
      refreshToken: 'refresh-value',
      refresh: { endpoint: 'https://securetoken.googleapis.com/v1/token' },
    })
  })

  it('rejects ambiguous or credential-free exports', () => {
    expect(() => bearerCredentialsFromCookieJson(JSON.stringify([
      { name: 'access_token', value: 'first' },
      { name: 'access_token', value: 'second' },
    ]))).toThrow(/conflicting access_token/i)
    expect(() => bearerCredentialsFromCookieJson(JSON.stringify([
      { name: 'theme', value: 'dark' },
    ]))).toThrow(/does not contain an access cookie/i)
  })

  it('exchanges a Firebase refresh cookie for an API Bearer ID token immediately', async () => {
    const fetcher = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      expect(String(input)).toBe(
        'https://securetoken.googleapis.com/v1/token?key=public-firebase-key',
      )
      expect(init?.method).toBe('POST')
      expect(String(init?.body)).toBe('grant_type=refresh_token&refresh_token=refresh-cookie')
      return new Response(JSON.stringify({
        id_token: 'fresh-id-token',
        refresh_token: 'rotated-refresh-token',
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    await expect(refreshImportedFirebaseCredentials({
      accessToken: 'browser-session-cookie',
      refreshToken: 'refresh-cookie',
      refresh: {
        endpoint: 'https://securetoken.googleapis.com/v1/token',
        apiKey: 'public-firebase-key',
      },
    }, fetcher as typeof fetch)).resolves.toEqual({
      accessToken: 'fresh-id-token',
      refreshToken: 'rotated-refresh-token',
      refresh: {
        endpoint: 'https://securetoken.googleapis.com/v1/token',
        apiKey: 'public-firebase-key',
      },
    })
  })

  it('does not send credentials when a Firebase project key is unknown', async () => {
    const fetcher = async (): Promise<Response> => {
      throw new Error('must not be called')
    }
    const imported = {
      accessToken: 'browser-session-cookie',
      refreshToken: 'refresh-cookie',
      refresh: { endpoint: 'https://securetoken.googleapis.com/v1/token' },
    }
    await expect(refreshImportedFirebaseCredentials(imported, fetcher as typeof fetch)).resolves.toBe(imported)
  })
})

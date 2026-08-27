/** Local-only extraction of TwinMind credentials from a browser cookie export. */

/** Credentials needed by the TwinMind Bearer route. */
export interface TwinMindCookieCredentials {
  /** Firebase ID token stored in TwinMind's HttpOnly `session` cookie. */
  accessToken: string
  /** Firebase refresh token stored in its dedicated HttpOnly cookie. */
  refreshToken: string
}

interface CookieExportRow {
  name?: unknown
  value?: unknown
  domain?: unknown
}

function cookieRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'object' && value !== null && Array.isArray((value as { cookies?: unknown }).cookies)) {
    return (value as { cookies: unknown[] }).cookies
  }
  throw new Error('Paste a cookie-export JSON array.')
}

function tokenNamed(rows: unknown[], name: string): string {
  const candidates = rows
    .map(row => row as CookieExportRow | null)
    .filter(row => row !== null && row.name === name && row.domain === 'app.twinmind.com')
    .map(row => row?.value)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
  const unique = [...new Set(candidates)]
  if (unique.length === 0) throw new Error(`Cookie export does not contain app.twinmind.com ${name}.`)
  if (unique.length > 1) throw new Error(`Cookie export contains conflicting ${name} values.`)
  const token = unique[0]
  if (token === undefined || /[\r\n]/.test(token)) throw new Error(`Cookie ${name} is not a usable HTTP credential.`)
  return token
}

/**
 * Parse a pasted export without retaining unrelated cookies.
 * @param source - JSON array or `{cookies: [...]}` export text.
 * @returns only the two TwinMind credential values.
 */
export function twinMindCredentialsFromCookieJson(source: string): TwinMindCookieCredentials {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error: unknown) {
    throw new Error('Cookie export is not valid JSON.', { cause: error })
  }
  const rows = cookieRows(parsed)
  const accessToken = tokenNamed(rows, 'session')
  if (accessToken.split('.').length !== 3) throw new Error('TwinMind session cookie is not a Firebase JWT.')
  return {
    accessToken,
    refreshToken: tokenNamed(rows, 'firebase_refresh_token'),
  }
}

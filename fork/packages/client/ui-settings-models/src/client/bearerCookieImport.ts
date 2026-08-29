/** Local-only extraction of Bearer credentials from a browser cookie export. */

/** Credentials found in a browser cookie export. */
export interface BearerCookieCredentials {
  /** Access value selected from a common session/token cookie. */
  accessToken: string
  /** Optional refresh value selected from a common refresh cookie. */
  refreshToken?: string
  /** Refresh transport inferred from provider-specific cookie evidence. */
  refresh?: {
    /** Token endpoint; Firebase uses one shared endpoint for every project. */
    endpoint: string
    /** Public project Web API key when a compatibility profile can identify it. */
    apiKey?: string
  }
}

interface FirebaseRefreshReply {
  id_token?: unknown
  access_token?: unknown
  refresh_token?: unknown
}

interface CookieExportRow {
  name?: unknown
  value?: unknown
  domain?: unknown
}

const ACCESS_COOKIE_NAMES = ['access_token', 'accessToken', 'access-token', 'session', 'token', 'authorization']
const REFRESH_COOKIE_NAMES = ['refresh_token', 'refreshToken', 'refresh-token', 'firebase_refresh_token']
const FIREBASE_REFRESH_ENDPOINT = 'https://securetoken.googleapis.com/v1/token'

/**
 * Provider compatibility belongs in this small registry rather than in the
 * generic Bearer form. Firebase Web API keys identify a project but are not
 * carried by cookie exports, so a known deployment needs an explicit mapping.
 */
const FIREBASE_COOKIE_PROFILES: readonly {
  domains: readonly string[]
  apiKey: string
}[] = [
  {
    domains: ['app.twinmind.com', '.twinmind.com'],
    apiKey: 'AIzaSyD2Sd_NP3vA4rwvoroKqDefpXZeCMDXcIQ',
  },
]

function cookieRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'object' && value !== null && Array.isArray((value as { cookies?: unknown }).cookies)) {
    return (value as { cookies: unknown[] }).cookies
  }
  throw new Error('Paste a browser cookie-export JSON array.')
}

function usableCookieValue(value: unknown, label: string): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || /[\r\n]/.test(value)) return undefined
  return label === 'authorization' && /^Bearer\s+/i.test(value) ? value.replace(/^Bearer\s+/i, '') : value
}

function findCookie(rows: unknown[], names: readonly string[], required: boolean): string | undefined {
  const candidates = rows
    .map(row => row as CookieExportRow | null)
    .filter(row => row !== null && typeof row?.name === 'string' && names.includes(row.name))
    .map(row => usableCookieValue(row?.value, String(row?.name)))
    .filter((value): value is string => value !== undefined)
  const unique = [...new Set(candidates)]
  if (unique.length > 1) throw new Error(`Cookie export contains conflicting ${names[0]} values.`)
  if (unique.length === 0) {
    if (required) throw new Error(`Cookie export does not contain an access cookie (${names.join(', ')}).`)
    return undefined
  }
  return unique[0]
}

function firebaseRefresh(rows: unknown[]): BearerCookieCredentials['refresh'] | undefined {
  const cookies = rows.map(row => row as CookieExportRow | null).filter(row => row !== null)
  if (!cookies.some(row => row?.name === 'firebase_refresh_token')) return undefined
  const domains = new Set(cookies.flatMap((row) => {
    if (typeof row?.domain !== 'string') return []
    return [row.domain.toLowerCase()]
  }))
  const profile = FIREBASE_COOKIE_PROFILES.find(candidate => candidate.domains.some(domain => domains.has(domain)))
  return {
    endpoint: FIREBASE_REFRESH_ENDPOINT,
    ...profile === undefined ? {} : { apiKey: profile.apiKey },
  }
}

/**
 * Parse a browser export without retaining unrelated cookies. Names are
 * deliberately provider-neutral and cover the common session/token formats.
 * @param source - JSON array or `{cookies: [...]}` export text.
 * @returns only the access and optional refresh values.
 */
export function bearerCredentialsFromCookieJson(source: string): BearerCookieCredentials {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error: unknown) {
    throw new Error('Cookie export is not valid JSON.', { cause: error })
  }
  const rows = cookieRows(parsed)
  const accessToken = findCookie(rows, ACCESS_COOKIE_NAMES, true)
  const refreshToken = findCookie(rows, REFRESH_COOKIE_NAMES, false)
  const refresh = refreshToken === undefined ? undefined : firebaseRefresh(rows)
  return {
    accessToken: accessToken as string,
    ...refreshToken === undefined ? {} : { refreshToken },
    ...refresh === undefined ? {} : { refresh },
  }
}

/**
 * Replace a Firebase browser session cookie with the ID token accepted by API
 * Bearer authentication. Firebase session cookies can have a valid-looking,
 * long expiry but are not interchangeable with ID tokens, so waiting for the
 * session cookie to expire would leave the first model probe permanently 401.
 *
 * Unknown deployments remain untouched: their public Firebase Web API key
 * cannot be inferred safely and the generic manual fields stay available.
 */
export async function refreshImportedFirebaseCredentials(
  credentials: BearerCookieCredentials,
  fetcher: typeof fetch = fetch,
): Promise<BearerCookieCredentials> {
  const refresh = credentials.refresh
  if (credentials.refreshToken === undefined || refresh?.apiKey === undefined) return credentials

  const endpoint = new URL(refresh.endpoint)
  if (!endpoint.searchParams.has('key')) endpoint.searchParams.set('key', refresh.apiKey)
  let response: Response
  try {
    response = await fetcher(endpoint.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: credentials.refreshToken,
      }),
    })
  } catch (error: unknown) {
    throw new Error('Firebase token refresh could not be reached.', { cause: error })
  }
  if (!response.ok) {
    throw new Error(`Firebase rejected the refresh cookie (HTTP ${String(response.status)}). Sign in again and export fresh cookies.`)
  }
  let reply: FirebaseRefreshReply
  try {
    reply = await response.json() as FirebaseRefreshReply
  } catch (error: unknown) {
    throw new Error('Firebase token refresh returned an invalid response.', { cause: error })
  }
  const accessToken = typeof reply.id_token === 'string' ? reply.id_token : reply.access_token
  if (typeof accessToken !== 'string' || accessToken.length === 0 || /[\r\n]/.test(accessToken)) {
    throw new Error('Firebase token refresh did not return an ID token.')
  }
  const rotatedRefresh = typeof reply.refresh_token === 'string'
    && reply.refresh_token.length > 0
    && !/[\r\n]/.test(reply.refresh_token)
    ? reply.refresh_token
    : credentials.refreshToken
  return { ...credentials, accessToken, refreshToken: rotatedRefresh }
}

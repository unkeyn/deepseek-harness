/** Authorization-flow adapter for pi-ai providers that ship a login method. */

import { createModels } from '@earendil-works/pi-ai'
import type { AuthEvent, AuthPrompt, AuthType, Provider } from '@earendil-works/pi-ai'
import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationMethod, AuthorizationPrompt, AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import { isCredentialKeySegment } from '@deepseek-ai/dsh-credentials'
import { catalogProvider, catalogProviderIds } from './catalog.ts'
import { recordKeyFor } from './auth.ts'
import type { PiAiAuthInjection } from './adapter.ts'

function loginMethods(provider: Provider | undefined): AuthorizationMethod[] {
  const methods: AuthorizationMethod[] = []
  const oauth = provider?.auth.oauth
  if (oauth !== undefined) methods.push({ id: 'oauth', label: oauth.loginLabel ?? oauth.name })
  const apiKey = provider?.auth.apiKey
  if (apiKey?.login !== undefined) methods.push({ id: 'api-key', label: apiKey.name })
  return methods
}

function relay(event: AuthEvent, session: AuthorizationSession): void {
  switch (event.type) {
    case 'info': {
      const link = event.links?.[0]
      session.notify({ message: event.message, ...(link === undefined ? {} : { url: link.url }) })
      return
    }
    case 'auth_url':
      session.notify({ message: event.instructions ?? 'Open this page to continue signing in.', url: event.url })
      return
    case 'device_code':
      session.notify({ message: 'Enter this code on the verification page to finish signing in.', url: event.verificationUri, code: event.userCode })
      return
    case 'progress':
      session.notify({ message: event.message })
      return
    default:
      session.notify({ message: 'Signing in…' })
  }
}

function restate(prompt: AuthPrompt): AuthorizationPrompt {
  const signal = prompt.signal === undefined ? {} : { signal: prompt.signal }
  switch (prompt.type) {
    case 'select': return { ...signal, kind: 'select', message: prompt.message, options: prompt.options }
    case 'secret':
      return { ...signal, kind: 'secret', message: prompt.message, ...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder }) }
    default:
      return { ...signal, kind: 'text', message: prompt.message, ...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder }) }
  }
}

/** Register current pi-ai OAuth/API-key flows on the Harness authorization seam. */
export function registerPiAiFlows(ctx: Context, auth: PiAiAuthInjection): void {
  for (const providerId of catalogProviderIds()) {
    const provider = catalogProvider(providerId)
    const [first, ...rest] = loginMethods(provider)
    if (provider === undefined || first === undefined || !isCredentialKeySegment(providerId)) continue
    ctx.authorization.registerFlow({
      key: recordKeyFor(providerId),
      label: provider.name,
      methods: [first, ...rest],
      async run(session) {
        const models = createModels(auth)
        models.setProvider(provider)
        const type: AuthType = session.method === 'oauth' ? 'oauth' : 'api_key'
        await models.login(providerId, type, {
          signal: session.signal,
          notify: event => relay(event, session),
          prompt: prompt => session.prompt(restate(prompt)),
        })
      },
    })
  }
}

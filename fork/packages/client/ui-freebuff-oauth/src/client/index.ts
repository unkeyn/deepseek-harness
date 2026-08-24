/** Browser plugin that contributes the Freebuff OAuth tab. */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { IApiClient } from '@deepseek-ai/dsh-fork-host-apiproxy/client'
import { RpcId } from '@deepseek-ai/dsh-fork-host-apiproxy/api'
import {
  freebuffBeginLoginValueSchema,
  freebuffCompleteLoginValueSchema,
  freebuffLogoutValueSchema,
  freebuffOpenDesktopValueSchema,
  freebuffStatusValueSchema,
} from '@deepseek-ai/dsh-fork-host-apiproxy/api/freebuff.schema'
import type { RpcResult, RpcResponse } from '@deepseek-ai/dsh-fork-host-apiproxy/api'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: imports the shared Models panel declaration owned by the Models
// settings plugin (`settings.models.panel`).
import type {} from '@deepseek-ai/dsh-fork-client-ui-settings-models/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { FreebuffOAuthTab } from './FreebuffOAuthTab.tsx'
import { FreebuffOAuthController, type FreebuffOAuthFace } from './controller.ts'
import { en, zh } from './locales.ts'
import type { FreebuffOAuthLocaleKey } from './locales.ts'

/** Locale namespace owned by this plugin. */
const NS = 'settings.oauth'

/** Services required by this browser plugin. */
export const inject = ['slots', 'locale', 'connection']

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Freebuff OAuth settings tab copy. */
    'settings.oauth': FreebuffOAuthLocaleKey
  }
}

/** Public faces for focused client tests and external tab composition. */
export type { FreebuffOAuthAccountState, FreebuffOAuthFace, FreebuffOAuthState } from './controller.ts'
export type { FreebuffOAuthLocaleKey } from './locales.ts'
export type { FreebuffOAuthTabProps } from './FreebuffOAuthTab.tsx'

const CLIENT_RPC_ID = RpcId('freebuff-client-bridge')

/** Create the Freebuff API face over the shared Connection RPC transport. */
export function createFreebuffOAuthApi(
  rpc: Pick<ConnectionHandle, 'rpc'>['rpc'],
): IApiClient['freebuff'] {
  const call = async <T>(
    endpoint: string,
    payload: {},
    schema: { parse(value: unknown): T },
    signal?: AbortSignal,
  ): Promise<RpcResponse<T>> => {
    const result: RpcResult<unknown> = await rpc.call('/freebuff', endpoint, payload, signal)
    if (!result.ok) return { rpcId: CLIENT_RPC_ID, result }
    return { rpcId: CLIENT_RPC_ID, result: { ok: true, value: schema.parse(result.value) } }
  }
  return {
    status: (payload, signal) => call('freebuff.status', payload, freebuffStatusValueSchema, signal),
    beginLogin: (payload, signal) => call('freebuff.beginLogin', payload, freebuffBeginLoginValueSchema, signal),
    completeLogin: (payload, signal) => call('freebuff.completeLogin', payload, freebuffCompleteLoginValueSchema, signal),
    logout: (payload, signal) => call('freebuff.logout', payload, freebuffLogoutValueSchema, signal),
    openDesktop: (payload, signal) => call('freebuff.openDesktop', payload, freebuffOpenDesktopValueSchema, signal),
  }
}

/** Register the feature-owned OAuth panel in the shared Models settings section. */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const t = ctx.locale.bind(NS)
  const controller = new FreebuffOAuthController(createFreebuffOAuthApi(connection.rpc))

  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'ui-freebuff-oauth: dictionaries')
  ctx.effect(() => () => { controller.dispose() }, 'ui-freebuff-oauth: controller')

  ctx.slots.inject('settings.models.panel', () => ctx.slots.register({
    name: 'settings.models.panel',
    id: 'oauth',
    order: 20,
    label: () => t('tab'),
    locale: NS,
    inject: () => controller.inject() as FreebuffOAuthFace,
  }, FreebuffOAuthTab))
}

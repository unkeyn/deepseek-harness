/**
 * pi-ai authentication adapters for the fork LLM plugin.
 *
 * pi-ai owns the OAuth/API-key protocol; the Harness owns durable credential
 * records and the authorization UI. Keeping this bridge in the fork package
 * means the upstream LLM packages remain untouched while sign-in and refresh
 * continue to use the same current credential plane.
 */

import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve as resolvePath } from 'node:path'
import type { AuthContext, Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai'
import type { Context } from '@deepseek-ai/cordis'
import {
  credentialKey, credentialKeyId, credentialKeyScope, credentialRef,
  isCredentialKeySegment, isCredentialRefName,
} from '@deepseek-ai/dsh-credentials'
import type { CredentialKey, CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { LlmError } from '@deepseek-ai/dsh-fork-llm'

/** Record namespace reserved for pi-ai credentials. */
export const RECORD_SCOPE = 'llm-pi-ai'

/** Address one pi-ai provider inside the Harness credential store. */
export function recordKeyFor(providerId: string): CredentialKey {
  return credentialKey(RECORD_SCOPE, providerId)
}

/** Remove explicit undefined values before a grant is persisted as JSON. */
function jsonImage(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => item === undefined ? null : jsonImage(item))
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) if (item !== undefined) result[key] = jsonImage(item)
    return result
  }
  return value
}

function toPiCredential(record: CredentialRecord | undefined): Credential | undefined {
  if (record === undefined) return undefined
  if (record.kind === 'api-key') {
    return {
      type: 'api_key',
      ...(record.key === undefined ? {} : { key: record.key }),
      ...(record.env === undefined ? {} : { env: { ...record.env } }),
    }
  }
  return record.payload as Credential
}

function toRecord(credential: Credential): CredentialRecord {
  if (credential.type === 'api_key') {
    return {
      kind: 'api-key',
      ...(credential.key === undefined ? {} : { key: credential.key }),
      ...(credential.env === undefined ? {} : { env: { ...credential.env } }),
    }
  }
  return { kind: 'grant', payload: jsonImage(credential) }
}

function writableStore(ctx: Context): CredentialProvider {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    throw new LlmError(
      'llm-pi-ai: no credentials service is mounted; there is nowhere to store a sign-in result',
      'NO_CREDENTIAL_STORE',
    )
  }
  return credentials
}

/** Durable pi-ai credential store backed by current Harness records. */
export function credentialStoreFrom(ctx: Context): CredentialStore {
  return {
    async read(providerId) {
      const credentials = ctx.get('credentials')
      if (credentials === undefined || !isCredentialKeySegment(providerId)) return undefined
      return toPiCredential(await credentials.readRecord(recordKeyFor(providerId)))
    },
    async list(): Promise<readonly CredentialInfo[]> {
      const records = await ctx.get('credentials')?.listRecords() ?? []
      return records
        .filter(record => credentialKeyScope(record.key) === RECORD_SCOPE)
        .map(record => ({
          providerId: credentialKeyId(record.key),
          type: record.kind === 'api-key' ? 'api_key' : 'oauth',
        }))
    },
    async modify(providerId, mutate) {
      if (!isCredentialKeySegment(providerId)) {
        throw new LlmError(`llm-pi-ai: provider id "${providerId}" cannot address a credential record`, 'UNSTORABLE_PROVIDER_ID')
      }
      const stored = await writableStore(ctx).modifyRecord(recordKeyFor(providerId), async current => {
        const next = await mutate(toPiCredential(current))
        return next === undefined ? undefined : toRecord(next)
      })
      return toPiCredential(stored)
    },
    async delete(providerId) {
      if (!isCredentialKeySegment(providerId)) return
      await writableStore(ctx).deleteRecord(recordKeyFor(providerId))
    },
  }
}

/** pi-ai ambient environment/file lookups over Harness credentials and host. */
export function authContextFrom(ctx: Context): AuthContext {
  return {
    async env(name) {
      if (isCredentialRefName(name)) {
        const hit = await ctx.get('credentials')?.resolve(credentialRef(name))
        if (hit !== undefined) return hit.value
      }
      return launchEnvironmentOf(ctx).get(name)?.value
    },
    async fileExists(path) {
      const expanded = path.startsWith('~/') || path === '~'
        ? resolvePath(homedir(), path.slice(1).replace(/^\//, ''))
        : path
      try {
        await access(expanded)
        return true
      } catch {
        return false
      }
    },
  }
}

/** Freebuff OAuth RPC payload and response schemas. */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'

/** All Freebuff OAuth commands currently use an empty request payload. */
export const freebuffEmptyRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'freebuff.status'>>>

/** Browser-safe account metadata. */
export const freebuffAccountViewSchema = z.object({
  accountId: z.string().min(1),
  displayName: z.string().optional(),
  status: z.union([z.literal('active'), z.literal('reauthenticate')]),
})

/** Login URL and expiry returned for a pending device login. */
export const freebuffLoginViewSchema = z.object({
  loginUrl: z.string().url(),
  expiresAt: z.string().min(1),
})

/** freebuff.status response value. */
export const freebuffStatusValueSchema = z.object({
  accounts: z.array(freebuffAccountViewSchema),
  pending: freebuffLoginViewSchema.optional(),
}) satisfies z.ZodType<Wire<ResponseValue<'freebuff.status'>>>

/** freebuff.beginLogin response value. */
export const freebuffBeginLoginValueSchema = freebuffLoginViewSchema satisfies z.ZodType<Wire<ResponseValue<'freebuff.beginLogin'>>>

/** freebuff.completeLogin response value. */
export const freebuffCompleteLoginValueSchema = z.object({
  account: freebuffAccountViewSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'freebuff.completeLogin'>>>

/** freebuff.logout response value. */
export const freebuffLogoutValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'freebuff.logout'>>>

/** freebuff.openDesktop response value. */
export const freebuffOpenDesktopValueSchema = z.object({
  opened: z.literal(true),
}) satisfies z.ZodType<Wire<ResponseValue<'freebuff.openDesktop'>>>

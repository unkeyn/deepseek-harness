/**
 * Fork-local type-meta bridge for the upstream Typert protocol.
 *
 * The fork's analyzer only registers source projects inside fork/packages.
 * Keeping these small forwarding declarations in a package whose manifest
 * retains the upstream protocol name lets the generator recognize the same
 * Remote contract without copying or modifying the upstream implementation.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  Remote as upstreamRemote,
  TypertRemoteService as UpstreamTypertRemoteService,
} from '@deepseek-ai/dsh-typert-protocol-runtime'
import type {
  RemoteMethodOptions,
  TypertGatewayBindingOptions,
} from '@deepseek-ai/dsh-typert-protocol-runtime'

export * from '@deepseek-ai/dsh-typert-protocol-runtime'
export { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol-runtime'

export class TypertRemoteService<out T = never> extends UpstreamTypertRemoteService<T> {
  protected constructor(ctx: Context, serviceKey: string, options: TypertGatewayBindingOptions = {}) {
    super(ctx, serviceKey, options)
  }
}

export function Remote<This extends object, Args extends unknown[], Result>(
  _method: (this: This, ...args: Args) => Result,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
): void
export function Remote(option: string | RemoteMethodOptions): <This extends object, Args extends unknown[], Result>(
  _method: (this: This, ...args: Args) => Result,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
) => void
export function Remote<This extends object, Args extends unknown[], Result>(
  methodExportOrOptions: string | RemoteMethodOptions | ((this: This, ...args: Args) => Result),
  context?: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
): void | ((
  _method: (this: This, ...args: Args) => Result,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
) => void) {
  if (context === undefined) {
    return (upstreamRemote as (
      option: string | RemoteMethodOptions,
    ) => (
      _method: (this: This, ...args: Args) => Result,
      context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
    ) => void)(methodExportOrOptions as string | RemoteMethodOptions)
  }
  ;(upstreamRemote as (
    _method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ) => void)(methodExportOrOptions as (this: This, ...args: Args) => Result, context)
}

import { defineConfig } from 'tsdown'
import { typertPlugin } from '../packages/typert/generator/lib/types/tsdown-plugin.js'

function buildFace(value: unknown): 'host' | 'client' {
  if (value === undefined || value === 'host') return 'host'
  if (value === 'client') return 'client'
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

/**
 * Build the active overlay roster after TypeScript emits lib/types.
 *
 * The repository still keeps a few pre-current UI implementations as source
 * references for future porting, but the desktop bundle deliberately uses the
 * current upstream UI seams. Listing the active roster explicitly also keeps
 * ignored historical build directories from the porting work
 * out of the build graph.
 */
export default defineConfig(({ env }) => {
  const client = buildFace(env?.DSH_BUILD_FACE) === 'client'
  return {
    workspace: [
      // The fork build owns the runtime closure used by the desktop launcher.
      // Keep the vendored framework packages in this graph so a clean clone
      // cannot accidentally reuse stale lib/ artifacts from another checkout.
      '../vendor/*',
      ...(client ? [] : ['packages/host/authorization-controller']),
      'packages/agent/model-selection',
      'packages/agent/modes',
      'packages/client/ui-authorization',
      'packages/client/ui-agent-modes',
      'packages/client/ui-settings-models',
      'packages/client/ui-settings-plugins',
      'packages/client/ui-key-check',
      'packages/client/ui-oauth-grid',
      'packages/compaction/compaction-basic',
      'packages/compaction/compaction-policy',
      'packages/context/budget-context',
      'packages/credentials/credential-broker',
      'packages/credentials/credential-broker-memory',
      'packages/credentials/credential-broker-pool',
      'packages/credentials/credential-health',
      'packages/credentials/credential-oauth',
      'packages/credentials/credential-pool-store',
      'packages/credentials/key-pool',
      'packages/harvest/engine',
      'packages/harvest/ui-harvest',
      'packages/llm/llm',
      'packages/llm/llm-credential-broker',
      'packages/llm/llm-bearer',
      'packages/llm/llm-bearer-mcp-bridge',
      'packages/llm/llm-deepseek',
      'packages/llm/llm-key-check',
      'packages/llm/llm-pi-ai',
      'packages/llm/llm-retry',
      'packages/llm/model-catalog',
      'packages/web/web',
      'packages/web/web-fetch-http',
      'packages/web/web-search-brave',
      'packages/web/web-search-firecrawl',
      'packages/web/web-search-pool',
    ],
    entry: client ? '' : ['lib/types/{index,invariant,startup}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client ? [] : [typertPlugin({ mode: 'workspace', faces: ['host'] })],
  }
})

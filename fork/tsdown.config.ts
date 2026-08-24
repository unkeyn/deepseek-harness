import { defineConfig } from 'tsdown'

function buildFace(value: unknown): 'host' | 'client' {
  if (value === undefined || value === 'host') return 'host'
  if (value === 'client') return 'client'
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

/** Build all fork package artifacts after their TypeScript projects emit lib/types. */
export default defineConfig(({ env }) => {
  const client = buildFace(env?.DSH_BUILD_FACE) === 'client'
  return {
    workspace: ['packages/*/*'],
    entry: client ? '' : ['lib/types/{index,invariant,startup}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  }
})

import { defineConfig } from 'tsdown'

/** Builds one host loader entry per output file admitted by the package whitelist. */
export default defineConfig([
  ...['index', 'invariant'].map(name => ({
    entry: [`lib/types/${name}.js`],
    outDir: 'lib', format: ['esm'] as const, platform: 'node' as const, target: 'es2024' as const,
    fixedExtension: false, outputOptions: { codeSplitting: false }, dts: false, clean: false,
  })),
])

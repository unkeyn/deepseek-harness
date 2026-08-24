import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/invariant.ts'],
  format: 'esm',
  target: 'es2024',
  dts: false,
})

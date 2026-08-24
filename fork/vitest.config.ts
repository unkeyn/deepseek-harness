import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin } from '../vitest.shared.ts'

const resolveFromConfig = createRequire(import.meta.url)
const testingLibraryReact = resolveFromConfig.resolve('@testing-library/react')
const resolveReactDependency = createRequire(testingLibraryReact)
const rootReact = resolveReactDependency.resolve('react')
const rootReactDom = resolveReactDependency.resolve('react-dom')
const rootReactJsxRuntime = resolveReactDependency.resolve('react/jsx-runtime')
const rootReactJsxDevRuntime = resolveReactDependency.resolve('react/jsx-dev-runtime')
const rootReactDomClient = resolveReactDependency.resolve('react-dom/client')
const rootReactDomTestUtils = resolveReactDependency.resolve('react-dom/test-utils')
const rootSyncExternalStore = resolveReactDependency.resolve('use-sync-external-store')
const rootSyncWithSelector = resolveReactDependency.resolve('use-sync-external-store/shim/with-selector.js')

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [
    tsconfigPaths({ projects: ['./tsconfig.base.json', '../tsconfig.base.json'] }),
    standardDecoratorPlugin(),
  ],
  resolve: {
    conditions: ['development'],
    dedupe: ['react', 'react-dom', 'use-sync-external-store'],
    alias: [
      { find: '@testing-library/react', replacement: testingLibraryReact },
      { find: 'react/jsx-runtime', replacement: rootReactJsxRuntime },
      { find: 'react/jsx-dev-runtime', replacement: rootReactJsxDevRuntime },
      { find: 'react', replacement: rootReact },
      { find: 'react-dom/client', replacement: rootReactDomClient },
      { find: 'react-dom/test-utils', replacement: rootReactDomTestUtils },
      { find: 'react-dom', replacement: rootReactDom },
      { find: 'use-sync-external-store/shim/with-selector.js', replacement: rootSyncWithSelector },
      { find: 'use-sync-external-store', replacement: rootSyncExternalStore },
      // The official agent-loop source imports the official package name. Use
      // the fork source in tests so its instanceof checks share one runtime
      // constructor with the fork adapters.
      {
        find: '@deepseek-ai/dsh-llm/message',
        replacement: fileURLToPath(new URL('./packages/llm/llm/src/message.ts', import.meta.url)),
      },
      {
        find: '@deepseek-ai/dsh-llm/brand',
        replacement: fileURLToPath(new URL('./packages/llm/llm/src/brand.ts', import.meta.url)),
      },
      {
        find: '@deepseek-ai/dsh-llm/types',
        replacement: fileURLToPath(new URL('./packages/llm/llm/src/types.ts', import.meta.url)),
      },
      {
        find: '@deepseek-ai/dsh-llm/invariant',
        replacement: fileURLToPath(new URL('./packages/llm/llm/src/invariant.ts', import.meta.url)),
      },
      // Client-runtime imports the dependency-minimal message entry by
      // subpath; keep that import on the same fork source plane.
      {
        find: '@deepseek-ai/dsh-llm',
        replacement: fileURLToPath(new URL('./packages/llm/llm/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['bundle/tests/**/*.spec.ts', 'packages/**/tests/**/*.spec.ts', 'packages/**/tests/**/*.spec.tsx'],
  },
})

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
      { find: 'use-sync-external-store/shim/with-selector', replacement: rootSyncWithSelector },
      { find: 'use-sync-external-store', replacement: rootSyncExternalStore },
      {
        find: '@deepseek-ai/dsh-typert-protocol-runtime',
        replacement: fileURLToPath(new URL('../packages/typert/protocol/src/index.ts', import.meta.url)),
      },
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
    // Keep the verification command scoped to the active overlay. The fork
    // source tree intentionally retains older, incompatible UI/host packages
    // as porting references; their tests target the pre-upstream architecture
    // and must not make the current desktop verification red.
    include: [
      'bundle/tests/**/*.spec.ts',
      'packages/agent/model-selection/tests/**/*.spec.ts',
      'packages/agent/modes/tests/**/*.spec.ts',
      'packages/host/authorization-controller/tests/**/*.spec.ts',
      'packages/client/ui-agent-modes/tests/**/*.spec.tsx',
      'packages/client/ui-authorization/tests/**/*.spec.ts',
      // Only the current fork add-on tests belong here. The old controller,
      // section, and full-Plugins tests remain as porting references because
      // they exercise the pre-upstream client-runtime architecture.
      'packages/client/ui-settings-plugins/tests/fields.client.spec.tsx',
      'packages/client/ui-settings-plugins/tests/invariant.client.spec.ts',
      'packages/client/ui-settings-plugins/tests/pool-card.client.spec.tsx',
      'packages/client/ui-key-check/tests/**/*.spec.ts',
      'packages/client/ui-key-check/tests/**/*.spec.tsx',
      'packages/client/ui-oauth-grid/tests/**/*.spec.ts',
      'packages/client/ui-oauth-grid/tests/**/*.spec.tsx',
      'packages/client/ui-settings-models/tests/groups.client.spec.tsx',
      'packages/client/ui-settings-models/tests/bearer-cookie-import.client.spec.ts',
      'packages/client/ui-settings-models/tests/bearer-provider-form.client.spec.tsx',
      'packages/client/ui-settings-models/tests/model-category-filters.client.spec.tsx',
      'packages/client/ui-settings-models/tests/models-api.client.spec.ts',
      'packages/compaction/compaction-basic/tests/**/*.spec.ts',
      'packages/compaction/compaction-policy/tests/**/*.spec.ts',
      'packages/context/budget-context/tests/**/*.spec.ts',
      'packages/credentials/credential-broker/tests/**/*.spec.ts',
      'packages/credentials/credential-broker-memory/tests/**/*.spec.ts',
      'packages/credentials/credential-broker-pool/tests/**/*.spec.ts',
      'packages/credentials/credential-health/tests/**/*.spec.ts',
      'packages/credentials/credential-oauth/tests/**/*.spec.ts',
      'packages/credentials/credential-pool-store/tests/**/*.spec.ts',
      'packages/credentials/key-pool/tests/**/*.spec.ts',
      'packages/llm/llm/tests/**/*.spec.ts',
      'packages/llm/llm-bearer/tests/**/*.spec.ts',
      'packages/llm/llm-bearer-mcp-bridge/tests/**/*.spec.ts',
      'packages/llm/llm-credential-broker/tests/**/*.spec.ts',
      'packages/llm/llm-deepseek/tests/**/*.spec.ts',
      'packages/llm/llm-key-check/tests/**/*.spec.ts',
      'packages/llm/llm-pi-ai/tests/**/*.spec.ts',
      'packages/llm/llm-retry/tests/**/*.spec.ts',
      'packages/llm/model-catalog/tests/**/*.spec.ts',
      'packages/web/web/tests/**/*.spec.ts',
      'packages/web/web-fetch-http/tests/**/*.spec.ts',
      'packages/web/web-search-brave/tests/**/*.spec.ts',
      'packages/web/web-search-firecrawl/tests/**/*.spec.ts',
      'packages/web/web-search-pool/tests/**/*.spec.ts',
    ],
  },
})

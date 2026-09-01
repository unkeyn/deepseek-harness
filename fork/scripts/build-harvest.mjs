// Build the owner-local harvest plugin packages when this checkout has them.
//
// `fork/packages/harvest/` stays untracked (see .gitignore), so a published
// clone has no harvest sources: the fork build must complete without them.
// This prestep is a no-op there. When the sources exist, their lib/types must
// exist before tsdown bundles them, and tsdown joins the two packages into
// its workspace graph through the same existence probe (tsdown.config.ts).
// The generated solution files extend the tracked fork base config, so they
// keep picking up roster changes without maintenance here.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const forkRoot = dirname(dirname(fileURLToPath(import.meta.url)))

const engineSource = join(forkRoot, 'packages', 'harvest', 'engine', 'package.json')
const uiSource = join(forkRoot, 'packages', 'harvest', 'ui-harvest', 'package.json')

if (!existsSync(engineSource) || !existsSync(uiSource)) {
  // A checkout without the plugin prints nothing: absence is the normal
  // published state, and the launcher composes standard mode.
  process.exit(0)
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: forkRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`build-harvest: ${command} ${args.join(' ')} exited with ${String(result.status ?? result.signal)}`)
  }
}

const solutionFor = (packages) => [
  '{',
  '  "extends": "./tsconfig.base.json",',
  '  "compilerOptions": { "noEmit": true },',
  '  "files": [],',
  `  "references": [${packages.map((p) => `{ "path": "./${p}" }`).join(', ')}]`,
  '}',
  '',
].join('\n')

// The client solution references the engine, so the client build covers both
// packages; the host solution stays face-pure for the host face type-check.
const solutions = [
  ['tsconfig.harvest.host.json', solutionFor(['packages/harvest/engine'])],
  ['tsconfig.harvest.client.json', solutionFor(['packages/harvest/engine', 'packages/harvest/ui-harvest'])],
]

for (const [file, content] of solutions) {
  const path = join(forkRoot, file)
  const previous = existsSync(path) ? readFileSync(path, 'utf8') : null
  if (previous !== content) writeFileSync(path, content)
  run('pnpm', ['--dir', '..', 'exec', 'tsc', '-b', `fork/${file}`])
}

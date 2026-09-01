# Agent Note: The harvest plugin becomes an optional owner-local mount

Status: implemented

## Problem

The harvest engine and console live under `fork/packages/harvest/`, which `.gitignore` keeps out of the repository, yet every tracked build and launch surface hard-required them: the fork face tsconfig solutions referenced the two packages, tsdown's workspace roster listed them, both bundle manifests declared them as `workspace:^` dependencies, and the bundle patches inserted the `ui-harvest-fork` console row. A fresh clone therefore could not install (`pnpm` cannot resolve workspace packages that do not exist), could not build (`tsc -b` fails on missing referenced projects), and could not boot the desktop composition (the Loader fails loud on an unresolvable row). The desktop launcher additionally created profile junctions into `fork/packages/harvest/` and pinned `default: harvest` unconditionally.

## Decision

The tracked tree now represents the published state and composes standard mode; harvest mounts only through existence probes on a checkout that has the plugin:

- The fork face solutions, `tsdown.config.ts` (existence-probed workspace spread), `vitest.config.ts`, `tsconfig.base.json`, and both bundle manifests and patches carry no harvest references. The console row moved into the launcher-written profile patch as a `- insert:` block, which composes over every bundle layer because the profile patch applies last.
- New tracked `fork/scripts/build-harvest.mjs` prefixed onto the fork `typecheck`/`build:lib` scripts emits the two packages' `lib/types` through generated, gitignored `fork/tsconfig.harvest.*.json` solutions and no-ops when the sources are absent.
- The desktop launcher detects the plugin by the two `package.json` files, conditionally creates the profile junctions, generates the harvest preset, and pins `default: harvest`; without it the patch pins `default: standard` and stale generated presets are removed. It also gained a `-Bootstrap` switch and a thin `.cmd` entry point that install dependencies and build the repository plus the fork workspace on a fresh clone before launching.
- `fork/pnpm-lock.yaml` is regenerated in the published state (plugin hidden), so clones install without rewriting it; an owner checkout with the plugin re-adds its importers on install, which stays a local uncommitted diff.

## Consequences

A fresh clone installs, builds, and launches in standard mode with no manual steps beyond the one-time build the launcher now performs itself. Two constraints follow. First, owner checkouts pay a persistent local diff on `fork/pnpm-lock.yaml` after any install (harvest remains a workspace member, so its importers must be recorded); keep it uncommitted. Second, a `pnpm install` inside the fork workspace while a harness host is running from this checkout recreates `node_modules` for the shared official-tree packages and can break the running host's lazy imports (observed with the sandbox backend's `@deepseek-ai/dsh-win32-process`/`koffi` links); rerun the root `pnpm install` afterwards or build while the host is down.

## Owner-state validation (2026-08-31)

Both states verified on the live checkout. User state: install, `typecheck`, `build:lib`, and the full fork test suite (1236 tests) pass with the plugin hidden; the published-state lockfile additionally gained the previously missing `ui-oauth-grid` importer, and its client spec needed `fireEvent` and a corrected outer-region assertion. Owner state: restoring the sources, installing (309 workspace projects), and `build:lib` pass end to end; the launcher reuses the running desktop host and the profile resolves both harvest junctions.

The owner-state client face exposed a pre-existing conflict: the fork `ui-conversation` lineage (frozen at its integration commit) declares Context augmentations that collide with the current upstream conversation types, so compiling both lineages in one program fails with TS2717. The `ui-harvest` client face now keeps them apart: its tsconfig consumes the fork lineage through its built `lib/types` via a `paths` mapping with `skipLibCheck`, drops the `runtime-compat`/`ui-conversation` project references, and a shorthand ambient `declare module '@deepseek-ai/dsh-client-runtime/client'` in `src/client/vendor-compat.d.ts` keeps the compat barrel (and through it the upstream UI) out of the program; the package's own `ClientContext`/`SessionId` imports go to `@deepseek-ai/cordis` and `@deepseek-ai/dsh-api-remotes/client`. Recompiling the fork UI lineage against current upstream types remains a future re-port, out of scope here.

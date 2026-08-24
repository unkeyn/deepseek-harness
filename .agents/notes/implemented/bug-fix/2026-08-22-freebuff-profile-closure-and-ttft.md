# Agent Note: External Freebuff bundle closure and low-latency headless operation

Status: implemented

English | [中文](2026-08-22-freebuff-profile-closure-and-ttft.zh.md)

## Problem

The Freebuff fork is loaded as an out-of-tree profile bundle, so its package dependencies live below the bundle directory rather than below the installed `dsh` application. The profile fallback linked only the installed application's dependency closure; Loader could find the bundle manifest but could not import the fork plugins named by its patch. The same bundle also inserts web-only services into the headless composition, leaving rows that require `webServer`, `storage`, or `directoryPicker` pending. Independently, the user's selected A6API route persisted `reasoningEffort: max`; Freebuff's DeepSeek agent definitions omit `reasoningOptions`, and the forced maximum reasoning budget made the first provider token appear much later than a normal request.

## Decision

`healProfilesModuleFallback()` accepts package-manifest anchors for loaded out-of-tree bundles and walks each bundle's dependency and peer-dependency closure into the shared profile fallback. `prepareProfile()` supplies every resolved layer manifest after profile loading, and the fork bundle declares the two plugins that its patch imports directly. This keeps package resolution owned by the installed bundle and lets Node resolve each linked package's own dependencies from its real directory.

The headless profile's user patch disables the fork rows that require web-only services: `api-gateway-fork`, `freebuff-rpc`, `credential-pool-store`, and `credential-broker`. The web profile keeps those rows enabled. The user's A6API settings omit an explicit reasoning effort, allowing the selected adapter/provider default instead of forcing `max`; this is an operational setting change, not a change to adapter-owned reasoning semantics. The [profile plugin bundle decision](../architecture/2026-08-05-profile-plugin-bundles.md) continues to own two-anchor bundle resolution, and the [adapter-owned reasoning decision](../architecture/2026-07-24-adapter-owned-reasoning-effort-capabilities.md) continues to own effort validation and defaulting.

## Alternatives considered

**Link only the external bundle package.** Rejected because the Loader imports the plugin names inside the patch, and those packages are installed in the bundle's own workspace. Linking only the bundle leaves its transitive plugin and peer dependencies unresolved.

**Copy every bundle dependency into the application manifest.** Rejected because it makes the official application own fork packages and couples the installed product to every optional out-of-tree bundle.

**Keep web-only fork rows active in headless.** Rejected because their missing host services leave pending entries and obscure whether the model route itself works. The headless composition does not provide the web host capabilities those rows require.

**Force reasoning off in the adapter.** Rejected because reasoning effort is an adapter-owned model capability and the same adapter serves deployments where reasoning is useful. Omitting the accidental user-level `max` selection removes the latency regression without changing provider policy or wire serialization rules.

## Consequences

External bundle plugins resolve during normal profile boot, while the installed application's fallback remains the source for in-box packages. Headless boot no longer waits on web-only fork rows, and the model request reaches the provider. A source launch still has a roughly 20-second cold boot cost; the built CLI reduces that startup cost to roughly 6 seconds. With the explicit `max` setting present, the diagnostic A6API request carried `reasoning: { effort: "max", summary: "auto" }`; after removing it, the same route omitted `reasoning` and delivered its first text event roughly 2.3 seconds after the HTTP request began. The direct `api.deepseek.com` credential available on the machine returned HTTP 401, so that credential failure is separate from the measured A6API TTFT issue.

The upstream Freebuff DeepSeek roots pass only the model and Freebuff branding to the shared base agent and do not set `reasoningOptions`; its streaming helper forwards reasoning only when the template declares it. The harness therefore leaves reasoning selection to the configured adapter/provider unless the user explicitly chooses an effort.

## Testing

`pnpm exec vitest run packages/boot/app-boot/tests/profile.spec.ts` passes all 15 tests, including the external-bundle dependency-closure case. `pnpm exec tsc -b apps/cli/tsconfig.json --pretty false` passes. The built headless CLI returned `harness-built-ok`, and a subsequent source launch returned `harness-no-max` after the `max` setting was removed.

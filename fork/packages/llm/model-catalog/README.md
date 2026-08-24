# @deepseek-ai/dsh-fork-model-catalog

English | [中文](README.zh.md)

Host Cordis plugin that provides `ctx.modelCatalog`. It reads the generated model database published by `@oh-my-pi/pi-catalog` and projects model identity, input modalities, reasoning efforts, and capacities without importing that package's Bun-only runtime modules.

At startup the plugin fetches a fresh catalog document once — by default from the upstream repository's generated file — validates it, and replaces the bundled snapshot before consumers resolve. A failed or invalid refresh logs a warning and keeps serving the bundled snapshot, so an unreachable source degrades capability quality rather than availability. Configure with `refresh: false` (fully offline hosts), `refreshUrl`, and `refreshTimeoutMs` (whole-request deadline).

The base bundle mounts this single catalog plugin before `llm-pi-ai`. Custom provider routes can therefore list only a model id; `llm-pi-ai` preserves the route's own endpoint and protocol while inheriting model capabilities from the catalog. Provider-specific headers, authentication, compatibility switches, and wire routing are never copied across routes.

## Model Experience

Composer reasoning choices and image admission use the projected capabilities through the provider-neutral LLM model directory. The catalog does not add prompt text or token content.

#### KV Cache effect

None. The plugin provides model metadata only; the one startup refresh swaps the in-process lookup table and does not modify requests.

## Known Limitations and Deferred Work

The refresh runs one attempt per process start; models published mid-run appear at the next start. The bundled snapshot remains the fallback for hosts with `refresh: false` or no network access until the dependency is upgraded.

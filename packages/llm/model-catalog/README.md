# @deepseek-ai/dsh-model-catalog

English | [中文](README.zh.md)

Host Cordis plugin that provides `ctx.modelCatalog`. It reads the generated model database published by `@oh-my-pi/pi-catalog` and projects model identity, input modalities, reasoning efforts, and capacities without importing that package's Bun-only runtime modules.

The base bundle mounts this single catalog plugin before `llm-pi-ai`. Custom provider routes can therefore list only a model id; `llm-pi-ai` preserves the route's own endpoint and protocol while inheriting model capabilities from the catalog. Provider-specific headers, authentication, compatibility switches, and wire routing are never copied across routes.

## Model Experience

Composer reasoning choices and image admission use the projected capabilities through the provider-neutral LLM model directory. The catalog does not add prompt text or token content.

#### KV Cache effect

None. The plugin provides immutable model metadata and does not modify requests.

## Known Limitations and Deferred Work

The plugin uses the dependency's bundled generated snapshot. Dynamic endpoint discovery can identify available model ids, but it does not update the installed capability database until the dependency is upgraded.

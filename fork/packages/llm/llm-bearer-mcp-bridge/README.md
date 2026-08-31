# @deepseek-ai/dsh-fork-llm-bearer-mcp-bridge

An optional fork extension that mounts a Bearer provider's configured Streamable HTTP MCP endpoint as native DeepSeek Harness tools. The bridge is provider-agnostic: each Bearer route opts in independently and can use its normal Bearer credential or a separate credential reference.

## Config

Set `mcpBridge.enabled: true` and provide the exact MCP endpoint under the Bearer provider profile. The bridge reloads the connection when the provider settings or selected credential changes. Firebase access tokens can be exchanged automatically when the MCP server publishes OAuth metadata; providers that already issue MCP tokens use the token directly.

## Model Experience

Discovered MCP tools are registered as `mcp__<provider>__<tool>` and enter the normal Harness tool registry, approval flow, tool loop, and result handling. Multiple Bearer providers can be enabled at the same time because each connection receives a stable provider-qualified namespace.

#### KV Cache effect

The bridge adds the discovered MCP tool schemas to model requests in the same way as the built-in MCP client. Tool results are returned through the ordinary tool-result path and are not persisted as a second cache or settings document.

## Known Limitations and Deferred Work

- The endpoint must be a Streamable HTTP MCP server; the bridge does not guess provider-specific routes or manufacture an MCP server for an ordinary chat API.
- The remote server controls which operations exist. TwinMind's official MCP endpoint is read-only, so it cannot create, edit, or delete local files; use a local filesystem MCP server endpoint for those operations.
- Models whose chat API does not accept arbitrary tool schemas (including the inspected TwinMind `/api/v3/chat` route) will not autonomously call these registered tools. The bridge still makes them available to tool-capable model routes.

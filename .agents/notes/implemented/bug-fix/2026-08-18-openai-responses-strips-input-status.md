# Agent Note: OpenAI Responses input omits replay status

Status: implemented

English | [中文](2026-08-18-openai-responses-strips-input-status.zh.md)

## Problem

`pi-ai` serializes replayed assistant output items with `status: completed`. OpenAI accepts that optional field, but some OpenAI-compatible gateways reject it in the Responses input union and fail a multi-turn request at `input[n].status`.

## Decision

`dsh-llm-pi-ai` supplies an `onPayload` rewrite for `openai-responses` requests. It removes only top-level `status` fields from items in the outgoing `input` array, leaving the durable Harness message and all other protocols unchanged. The rewrite is applied at the provider payload hook so the installed `pi-ai` package is not modified.

## Alternatives considered

**Switch the route back to chat completions.** Rejected: the gateway's Responses stream is the working protocol for the configured model, while its completions stream omits the terminal reason.

**Patch `pi-ai` in `node_modules`.** Rejected: generated dependencies are overwritten by installs and the compatibility rule belongs to the Harness adapter that owns the route.

**Strip every unknown field from Responses input.** Rejected: fields such as tool-call ids and replay metadata are required for multi-turn tool pairing; only the gateway-rejected optional `status` is removed.

## Consequences

Strict OpenAI-compatible gateways can accept replayed Responses history without weakening durable replay or changing the public request vocabulary. Native OpenAI Responses requests lose no required input information because `status` is output metadata; future gateway-specific incompatibilities still need an explicit compatibility rule and regression test.

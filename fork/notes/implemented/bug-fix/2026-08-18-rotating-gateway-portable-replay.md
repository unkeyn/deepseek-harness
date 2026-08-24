# Agent Note: Portable replay for rotating gateways

Status: implemented

English | [中文](2026-08-18-rotating-gateway-portable-replay.zh.md)

## Problem

A gateway can expose one stable Harness route while rotating each request among independent upstream suppliers. Native pi-ai replay metadata — response ids, reasoning signatures, and provider item metadata — belongs to the supplier that produced it. Sending that metadata to a different supplier can make the gateway reject the request or close an OpenAI Responses stream before its terminal event, leaving the agent to retry the same invalid history.

## Decision

`dsh-llm-pi-ai` gives each provider profile a `replayMode` setting. `native` remains the default and restores validated pi-ai replay metadata. `portable` skips replay metadata and reconstructs assistant history from durable reasoning text, text, and tool calls; durable tool-call ids remain so later tool results still pair with their calls. The `a6api` route uses `portable` because its upstream supplier can rotate without changing the exposed route.

## Alternatives considered

**Disable native replay for every route.** Rejected: direct providers and gateways with supplier affinity can reuse valid native metadata and should keep their existing cache and continuation behavior.

**Retry the same native request until the gateway rotates to a compatible supplier.** Rejected: the next supplier cannot be assumed to understand the previous supplier's ids or encrypted signatures, and retries repeat an invalid request while obscuring the cause.

**Switch A6API back to Chat Completions.** Rejected: the configured Responses stream is the protocol that produced terminal events for this gateway; changing protocols would reintroduce the earlier missing-finish failure.

**Strip only one known Responses field.** Rejected: removing `status` addresses one gateway validation defect, but supplier-specific response ids and signatures can still cross the rotation.

## Consequences

Portable routes give up provider-native replay and any provider-side state reuse that depends on it, but their assistant history remains valid when the gateway changes upstream suppliers. The setting is route-local, durable content remains authoritative, and native routes are unchanged. The adapter still strips Responses `status` fields through the separate compatibility rule owned by [OpenAI Responses input omits replay status](2026-08-18-openai-responses-strips-input-status.md); that note remains active because portable replay does not replace the fix for native routes.

## Verification

The config schema accepts `native` and `portable` and rejects other values. Conversion tests prove portable history retains durable text and tool calls while omitting response ids and block signatures. The existing adapter, context, conversion, and config tests pass together.

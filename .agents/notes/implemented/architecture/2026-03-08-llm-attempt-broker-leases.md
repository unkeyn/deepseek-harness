# Agent Note: LLM attempts acquire broker leases

English | [中文](2026-03-08-llm-attempt-broker-leases.zh.md)

Status: implemented

## Problem

A provider adapter must select one credential for each network attempt without changing global configuration or duplicating retry policy. Lease completion also has to cover normal finish, provider failure, cancellation, missing credentials, and truncated streams.

## Decision

`@deepseek-ai/dsh-llm-credential-broker` provides `BrokeredLlmAdapter`. It delegates provider metadata and catalog methods, acquires a lease for each `stream()` attempt, resolves the lease reference through `ctx.credentials`, and passes the resolved value only to a provider-owned stream callback. An optional failover policy accepts only configured failure codes, carries already-used credential ids in later broker requests, completes a failed lease before alternative acquisition, and stops at a positive finite `maxAttempts` count. The decorator completes each lease exactly once from terminal finish, abort, exception, missing reference, or missing finish chunk. Existing `ctx.llm` registration and provider-route retry remain separate concerns.

## Alternatives considered

**Global credential replacement:** Changing an environment variable or one shared adapter option would race parallel sessions and make in-flight requests observe unrelated state.

**Retry inside the decorator:** A hidden retry budget would conflict with the existing LLM recovery lifecycle and could duplicate provider attempts.

**Provider-neutral HTTP client:** Wire protocols, OAuth behavior, and error evidence belong to the provider adapter; the broker consumer only owns lease and reference resolution.

## Consequences

Provider adapters supply a callback that honors `GenerateOptions.signal` and translate provider evidence into health dispositions. Failover is opt-in per adapter and remains distinct from provider-route retry; each failover decision has an explicit finite attempt limit.

# Agent Note: Credential broker owns request leases

English | [中文](2026-03-08-credential-broker-request-leases.zh.md)

Status: implemented

## Problem

Credential references are per-operation inputs to provider adapters, while pool selection, concurrency limits, health state, and lease completion need a separate owner. Extending `ctx.credentials` with selection policy would mix secret storage with request lifecycle and would encourage global credential replacement.

## Decision

`@deepseek-ai/dsh-credential-broker` publishes the provider-neutral `ctx.credentialBroker` Service Definition. It selects a request-scoped `CredentialLease` containing only branded identifiers and a credential reference, then accepts one terminal `LeaseCompletion` for the exact lease id. Adapters own provider requests and call `complete()` exactly once. API-key and OAuth are represented as authentication kinds, while login, refresh, revocation, and failure classification remain provider-owned.

## Alternatives considered

**Extending `ctx.credentials`:** This would couple value resolution to pool policy and make the existing value-free reference seam responsible for concurrency and health state. It loses the ability to replace pool providers independently.

**Adapter-local pools:** This would duplicate selection and lease rules across LLM adapters and make parallel-session behavior provider-specific. A broker keeps one lifecycle contract while adapters retain wire ownership.

**Universal OAuth service:** OAuth providers differ in login, refresh, callback, and revocation semantics. A universal parser would hide provider-specific failures and cannot satisfy the roadmap acceptance criteria.

## Consequences

The first package is a contract-only slice with a memory test double; it does not persist pool metadata or send provider requests. Future pool, route, health, proxy, and OAuth packages must consume this service without exposing secret values or adding a second model catalog.

# Agent Note: Remote OAuth projections remain redacted and read-only

[English](2026-03-08-remote-oauth-projection.md) | 中文

Status: implemented

## Problem

远程 OAuth consumer 需要当前 broker metadata 来选择 provider account，但不能接收 token value 或获得修改 broker credential 的权限。延迟到达的 snapshot 也不能覆盖更新的 account-pool state。

## Decision

`RemoteOAuthCredentialStore` 消费带 generation 的 `RemoteOAuthCredentialSnapshotSource`，只有严格更新的 generation 才能替换 detached projection。Projection 只包含 credential reference、provider identity、authentication kind 和可选的 OAuth account identity，从不包含 token value。Provider account pool 仅过滤所选 provider 的 OAuth row；API-key row 始终保留，因为 pool 描述的是 OAuth identity。`resolve()` 返回 `undefined`，`set()` 与 `unset()` 以 `OAUTH_REMOTE_STORE_READ_ONLY` 拒绝。

## Alternatives considered

**让 remote consumer 使用可写 credential store：** 拒绝，因为 remote metadata 不应获得 broker mutation 或 secret storage 的所有权。

**让 OAuth account pool 过滤所有 credential kind：** 拒绝，因为 API-key credential 不是 OAuth identity，不应从 mixed provider projection 中消失。

**接受相同或更旧的 generation：** 拒绝，因为延迟 broker snapshot 可能回滚当前 account visibility。

## Consequences

Remote projection 适用于 detached diagnostics 和 account selection，但不能执行 provider request 或提供 token value。Broker-side credential provider 仍是 token resolution 和 mutation 的唯一所有者。Source snapshot 在替换和读取时都会复制，因此 caller mutation 不会改变已发布的 projection state。

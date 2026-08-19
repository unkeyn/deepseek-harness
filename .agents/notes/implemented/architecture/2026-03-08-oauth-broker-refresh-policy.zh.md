# Agent Note: OAuth broker refresh policy owns generation-safe sweeps

[English](2026-03-08-oauth-broker-refresh-policy.md) | 中文

Status: implemented

## Problem

OAuth 消费者需要由同一个刷新所有者处理前台请求和过期扫描。确定性的刷新失败必须请求重新认证，但旧刷新不能禁用已被新登录替换的账户。提供方账户池也需要过滤，而不能暴露 token 或引入未记录的提供方 endpoint。

## Decision

`OAuthLifecycle` 为每个账户保留一个进行中的刷新 Promise，并通过 `refreshDue()` 提供带 skew 的扫描。`OAuthRefreshScheduler` 管理 interval；调用方应将它绑定到外层 Cordis fiber 的 disposer。每个脱敏账户 snapshot 都带有单调递增的 generation。只有刷新开始时观察到的 generation 仍是当前 generation 时，刷新失败才会把账户置为 `reauthenticate`；新登录优先。确定性失败包括 invalid grant、已撤销或未授权 credential，以及裸 401 响应；临时失败仍可重试。消费者拥有账户池策略时，`filterOAuthAccounts()` 使用提供方对应的 identity 集合过滤账户。持久化 pool broker 也要求 pool 的 provider 与请求 provider 一致后才发放其元数据。

## Alternatives considered

**让每个消费者独立刷新：** 拒绝，因为并发模型请求和定时工作会重复调用提供方，并可能发布冲突的账户状态。

**只按 account id 禁用而不检查 generation：** 拒绝，因为慢速的旧登录刷新可能覆盖新登录的 active 状态。

**在 OAuth package 中加入提供方 HTTP endpoint：** 拒绝，因为 callback、token exchange、refresh 和 revocation 的 wire 语义属于注入的提供方 transport，必须由提供方文档定义。

## Consequences

前台请求和定时扫描共享刷新所有权，scheduler 的释放可以停止后续 timer 工作。Snapshot 暴露 generation 和状态，但不暴露 access 或 refresh token。旧 generation 的确定性失败不能禁用替换后的账户。只有调用方拥有提供方 identity 策略时才能进行账户池过滤；没有策略时保持不限制。刷新计划的默认值是代码级协议默认值，也可由 scheduler 选项覆盖。

## Testing

Package 测试覆盖 skew 触发刷新、带 generation 的脱敏 snapshot、提供方账户池过滤、single-flight 刷新、确定性重新认证和旧失败保护。Pool broker 的候选选择路径强制 provider 匹配。

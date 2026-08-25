# Agent Note：key-pool 轮换组合

[English](2026-08-24-key-pool-rotation-composition.md) | 中文

Status: implemented

## 问题

Fork 中 credential-broker 契约、pool store、health 分类器和 brokered LLM adapter 装饰器都已齐备，但没有任何组合把它们挂载起来，provider 路由仍然每个请求只解析一个固定的凭据引用。Web-search 密钥虽然有带冷却的池，但选择逻辑会一直钉住最高优先级的密钥直到它失败，导致并行会话集中到同一把凭据上。

## 决策

`@deepseek-ai/dsh-fork-key-pool` 把既有组件组合成可用的垂直切片。插件在一次 `apply()` 中注册三个服务：settings 持久化的 `credentialPoolStore`（与存储后端版本相同的接口和 CAS 语义，通过 `key-pool` settings 段持久化，因此不依赖 storage 后端）、`credentialHealth` 分类器（429 按 Retry-After 或配置的回退值冷却；被提供方拒绝的密钥改为隔离而不是删除，因为成员资格由用户配置所有），以及池化的 `credentialBroker`。`PoolCredentialBroker` 对同优先级的凭据按 acquire 轮换，而不是排序后总取第一个——这正是并行会话在池内分散的机制；显式优先级仍然决定 failover 阶梯的顺序。acquire 只在 lease 容量耗尽时等待（在释放与成员重发布时重查）；冷却窗口会以可重试的 `CREDENTIAL_COOLDOWN` 拒绝并注明最早到期时间，其余空选择都以 `NO_ELIGIBLE_CREDENTIAL` 拒绝，因此耗尽全部密钥的 failover 决策会立即浮出提供方错误，冷却等待由外层重试策略以其可见的节奏承担，而不是在 broker 内静默挂住请求。由于 failover 循环在上一个 lease 的 health 变更落盘之前就会获取下一个 lease，`completeWithHealth` 会对被无关凭据变更弄旧的 CAS 令牌重试一次，保证双密钥同时失败时冷却依然持久化。

`llm-deepseek` 和 `llm-pi-ai` 始终经由 `BrokeredLlmAdapter` 路由，使用动态 failover 解析器（每个 stream 调用一次 `ctx.keyPool.failover(provider)`；pi-ai 实例从请求本身读取路由，因此一个装饰器覆盖所有 profile）和惰性 health 解析器。当解析器返回 `undefined`、或 broker/credentials 服务尚未加载时，装饰器直接透传 delegate——Loader 条目是并行应用的（Include 组内为 `Promise.allSettled`），任何构造期的服务硬依赖都会变成加载顺序竞态。静态策略仍在构造期要求服务齐备并快速失败。两个适配器都通过新的 `streamWithKey` 复用按请求解析密钥的能力，请求形状校验仍然先于凭据解析。出于同样的分散原因，`web-search-pool` 的尝试顺序现在在最高优先级层内按搜索轮换。

池的 health 分类器读取 harness 的提供方中性失败码，而不是 HTTP 状态：部分适配器家族会把状态压平进错误文本，所以状态码不是跨路由共享的信号。`RATE_LIMIT`/`QUOTA` 冷却密钥（适配器提取到 Retry-After 时优先，否则用配置回退值）；`AUTH` 隔离。

Models 页在原位编辑池：API providers 页的每个提供方编辑器在主密钥字段下方渲染附加密钥——每个附加密钥一行只写输入框并带删除按钮，外加一个“添加密钥”按钮，自动派生下一个空闲的 `<PRIMARY>_N` 引用。Apply 通过 `credentials.set` 保存新值、unset 被移除的引用，并把池成员资格作为对刚描述的 `key-pool` 段的一次 set 写入（主密钥是池的第一项；没有附加密钥的提供方不保留池）。未挂载本插件的部署没有该命名空间，此区域保持隐藏。

## 已考虑的替代方案

**存储后端版 pool store：**要求每个组合先挂载 `storage` + `storage-json` 池才能工作；settings 文档本身已持久化，插件沿用 `web-search-pool` 的串行链模式把 health 写回其中。

**在 `resolveApiKey` 内轮换：**能分散密钥，但无法在请求中途 failover，也无法记录 health；lease 边界是完成态记账精确的保证。

**401 时删除被拒凭据：**一次瞬态网关 401 就会删掉用户管理的密钥；隔离把成员资格保留在配置所有权下。

**基于状态的 health 分类：**pi-ai 会把 HTTP 状态压平进错误文本（上游 XXX），部分路由拿不到状态；提供方中性失败码是所有适配器都会给出的唯一信号。

**独立的密钥池设置面板：**多密钥编辑应该放在主密钥所在的位置——提供方编辑器里——一个提供方的密钥在同一张卡片上管理，而不是第二个分段。

## 后果

池成员变化无需重启即可影响下一个请求；两个适配器都在 `keyPool` 变化时通过 `registration.replace` 重读捕获的重试下限。`key_pool_status` 工具向 agent 暴露脱敏后的 health。OAuth 账号池与代理绑定仍归拥有通用 store 的 roadmap 任务。

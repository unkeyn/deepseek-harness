# Agent Note: Web search credential pools

Status: implemented

[English](2026-08-19-web-search-credential-pool.md) | 中文

## Problem

已交付的 Web 搜索路由一次只使用一个提供方凭据。需要自定义搜索 API、多把密钥或提供方回退的部署没有持久化的设置模型，也无法从 Web UI 编辑，同时避免把密钥值放入设置或面向模型的诊断。

## Decision

`@deepseek-ai/dsh-web-search-pool` 拥有 `web-search-pool` 设置命名空间、`custom-pool` 提供方和两个面向模型的管理工具。设置文档保存提供方路由、优先级、有界尝试次数、密钥引用、并发限制及脱敏健康元数据。密钥字面值只通过 `ctx.credentials` 传递；浏览器只接收已配置和来源元数据，绝不接收密钥值。

每次搜索都会为该请求生成可用提供方和密钥的候选集，先按提供方优先级、再按密钥优先级排序；每把密钥最多保留 `maxConcurrent` 个并发请求，并且最多尝试 `maxAttempts` 个不同的提供方／密钥组合。失败会释放保留并记录冷却时间；401/403 还会隔离密钥。取消会停止操作，不会轮换密钥或记录普通失败健康状态。成功会清除临时健康元数据。健康写入串行化，健康持久化失败不会改变搜索结果。

适配器只接受绝对 HTTPS 地址，凭据请求拒绝重定向，将配置的 JSON 结果路径映射为共享 Web 来源类型，并产生稳定且安全的诊断。`web_search_pool_status` 只公开标识符、可用性、时间、限制和脱敏错误。`web_search_pool_rotate` 按提供方／密钥标识符改变启用状态或冷却时间，不接受密钥值。WebRuntime 在 pool 外部负责有序提供方回退，因此耗尽或不可用的自定义 pool 可以回退到下一个配置的提供方。

base 组合在官方 DeepSeek 搜索提供方之前挂载 pool。pool 包及现有自定义 Web 提供方都是 CLI 安装锚点的直接依赖，因为 profile module fallback 通过该 manifest 的依赖图解析 Loader 行。

## Alternatives considered

**把 API 密钥字面值存入设置文档。** 不采纳：设置属于可读取的配置状态，浏览器和模型界面不能接收密钥值；密钥引用保留现有只写凭据服务的边界。

**使用全局轮换或进程级 round-robin 状态。** 不采纳：单次请求必须拥有有界且确定的候选集，并发请求不能共享选择状态；按请求排序与每把密钥的保留可以提供可预测的故障转移。

**让 pool 实现所有提供方回退。** 不采纳：提供方顺序属于 `ctx.web`；pool 只负责其内部的密钥轮换，并保持与 Web seam 有序路由的可组合性。

**跟随 HTTP 重定向。** 不采纳：请求携带凭据；`redirect: 'error'` 防止凭据自动转发到其他 origin。

## Consequences

用户可以从 Plugins 设置卡添加自定义提供方和只写密钥，修改路由、优先级、限制、映射和启用状态，亦可通过模型工具查看安全状态。通用适配器每个提供方支持一个 JSON 结果数组和一个查询字段；提供方专用分页、签名请求和生成式答案仍不属于其范围。real-composition smoke 会挂载真实 Loader 树并断言 pool 工具和设置命名空间；pool 测试固定轮换、有界故障转移、拒绝重定向、安全诊断和 fiber disposal。

# Agent Note: catalog 路由的端点由其已安装同级模型推导

Status: implemented

[English](2026-08-25-route-endpoint-from-catalog-siblings.md) | 中文

## Problem

若干 pi-ai catalog 提供方不声明提供方级端点——地址写在每个模型上（`opencode`、`opencode-go`）。这类路由的模型列举会把端点的实时列表与已安装 catalog 合并，因此配置界面会给出已安装 catalog 尚未描述的 id。采纳这样的 id 会让路由在写入时被拒：端点链（路由 `baseURL` → 条目 → 提供方条目）恰恰对界面刚给出的这个 id 无答案，唯一的出路是把 catalog 已经记在每个同级模型上的端点再手打一遍。旁边还留着第二个洞：`baseUrl` 为空字符串的已安装条目（Azure 家族按部署实例给地址的写法）会以「有值」赢得整条链，于是路由存得下来，而每个请求都发往空主机。

## Decision

`resolveRouteModels` 在没有任何一层点名端点时，为 catalog 路由推导端点。导出的 `routeCatalogBaseUrl` 在提供方条目声明了自己的 `baseUrl` 时直接采用它；未声明的提供方则以其已安装模型所携带的最短非空端点作答，并优先取以版本段结尾的写法，因为那些记录的是已挂载的 API 而非发布前缀。OpenAI SDK 按字面把 `/chat/completions` 追加到请求 base 之后，因此对两种 OpenAI 形状的协议，当所有记录的写法都不带版本段时，由同级模型推导出的 base 会挂载到 `/v1`——这正是列表探测回退候选所遵循的约定。模型发现使用同一推导：该助手函数只存在于 catalog 模块一处，`discoverModels` 从那里导入，因此用户采纳列表所来自的端点与解析所服务的端点不可能分岔。提供方声明的 `baseUrl` 与显式的路由配置属于上游陈述，按字面采用。

已安装条目或引用条目上为空的 `baseUrl` 表示「无地址」，不再赢得这条链；模型与提供方条目都未声明端点的路由必须配置 `baseURL`，并在存储它的那次写入处失败。这是对[已声明提供方 catalog 笔记](../architecture/2026-08-03-pi-ai-declared-provider-catalog.md)的细化而非取代——catalog 未提供的路由仍需点名 `api`、`baseURL` 与非空的 `models` 列表；[草稿端点询问](../architecture/2026-08-04-draft-provider-endpoint-interrogation.md)也保持原样。

## Alternatives considered

**在采纳时把推导出的端点持久化进 profile。** 否决：`settings.yaml` 记录的是部署的选择，而该推导是 catalog 事实；存下的副本会随 catalog 升级而过时，并重述已安装条目已经说明的内容。

**让解析继续拒绝，实时合并仅作展示。** 否决：界面会继续给出路由无法服务的采纳项，而拒绝信息点名的却是一个 catalog 已能回答的字段。

**从模型 id 推断端点。** 否决：id 不携带地址事实；路由上的同级模型才携带。

## Consequences

- 在模型携带各自端点的每个提供方上，从端点实时列表采纳的 id 立即可服务，无需重述 `baseURL`，且其请求抵达带版本号的 API 挂载点，而不是发布前缀的 404 页面。
- 模型全部未声明端点的 catalog 路由（Azure 家族）在未配置路由 `baseURL` 时，会在存储它们的写入处被拒，而不是存下一个请求发往空主机的路由；受影响的测试用例已改为配置端点。
- 端点推导只存在一份；发现的探测目标与路由解析读取同一个助手函数。

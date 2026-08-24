# Agent Note：模型 catalog 启动刷新

Status: implemented

[English](2026-08-23-model-catalog-startup-refresh.md) | 中文

## 问题

自动模型能力 catalog 只提供固定版本 `@oh-my-pi/pi-catalog` 依赖内置的快照。上游新发布的模型在升级依赖之前不可见，因此引用新 id 的自定义提供方路由即使生成数据库已经描述了这些模型，也解析不出推理档位、图片准入或容量。

## 决策

`@deepseek-ai/dsh-fork-model-catalog` 在 `[Service.init]` 中、消费者挂载之前执行每次进程启动一次的刷新：获取 catalog 文档，校验，然后替换基于内置快照构建的进程内查找表。默认源是上游仓库的生成文件；`refreshUrl`、`refreshTimeoutMs`（通过 abort 信号施加的整个请求截止时间）与 `refresh: false` 是可从 cordis.yml 修改的已验证配置字段。

校验拒绝整个无法逐条声明模型 id 的文档，而不是合并部分文档——部分合并看起来像 catalog 丢失了模型。回复大小由声明 content-length 检查加累计读取上限共同约束。任何失败（网络、非 2xx、无效文档、超大回复）都记录警告并继续使用内置快照，因此刷新质量从不阻塞激活或可用性。Cordis 在应用下一个插件之前等待 `[Service.init]` 完成，所以 `llm-pi-ai` 在替换完成后才物化路由。

## 已考虑的替代方案

- **周期性后台刷新** —— 否决，因为这里很少有长期运行的主机进程，而定时器为边际收益增加生命周期与清理复杂度。
- **首次消费访问时刷新** —— 否决，因为惰性时机让能力解析在不同时刻物化的路由之间存在竞态。
- **将获取的 catalog 持久化到磁盘** —— 否决，因为内置快照已是持久回退，第二份磁盘副本会重新制造不清晰的更新归属。

## 后果

上游新发布的模型在下次进程启动时可见，无需升级依赖。运行中途发布的模型在下次启动出现。不允许访问网络的主机设置 `refresh: false`，行为与现在完全一致。

查找表替换是 catalog 状态唯一的变更；请求仍然绝不被修改，LLM 流量的 KV-cache 特征不变。

## 验证

- `packages/llm/model-catalog/tests/catalog.spec.ts` 证明先于消费者的替换顺序、不可达/拒绝/无效/超大回复下的回退、自定义 URL 与截止时间接线，以及 `refresh: false` 下完全跳过网络。
- fork 上 `pnpm run typecheck && pnpm run build:lib:host && pnpm run test` 通过。

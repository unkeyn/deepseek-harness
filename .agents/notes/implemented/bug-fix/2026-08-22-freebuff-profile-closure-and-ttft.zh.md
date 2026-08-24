# Agent Note: 外部 Freebuff bundle 闭包与低延迟 headless 运行

Status: implemented

[English](2026-08-22-freebuff-profile-closure-and-ttft.md) | 中文

## Problem

Freebuff fork 作为树外 profile bundle 加载，因此它的包依赖位于 bundle 目录下，而不是已安装的 `dsh` 应用目录下。Profile fallback 只链接了已安装应用的依赖闭包；Loader 能找到 bundle manifest，却无法导入 patch 中命名的 fork 插件。同一个 bundle 还会把仅适用于 web 的服务插入 headless 组合，导致依赖 `webServer`、`storage` 或 `directoryPicker` 的行保持 pending。另一方面，用户选择的 A6API 路由持久化了 `reasoningEffort: max`；Freebuff 的 DeepSeek agent 定义省略 `reasoningOptions`，而强制最大推理预算会让首个 provider token 比普通请求晚很多。

## Decision

`healProfilesModuleFallback()` 接受已加载树外 bundle 的 package manifest anchor，并把每个 bundle 的 dependency 与 peer-dependency 闭包加入共享 profile fallback。`prepareProfile()` 在 profile 加载后提供每个已解析 layer 的 manifest，fork bundle 也声明 patch 直接导入的两个插件。这样包解析仍由已安装的 bundle 所有，并且 Node 会从每个链接包的真实目录解析它自己的依赖。

Headless profile 的用户 patch 会禁用需要 web-only 服务的 fork 行：`api-gateway-fork`、`freebuff-rpc`、`credential-pool-store` 和 `credential-broker`。Web profile 保持这些行启用。用户的 A6API 设置省略显式推理强度，由选中的 adapter/provider 使用自身默认值，而不是强制 `max`；这只是运行设置调整，不改变 adapter 所有的推理语义。[Profile plugin bundle 决策](../architecture/2026-08-05-profile-plugin-bundles.md)继续拥有双 anchor bundle 解析，[adapter 所有的推理决策](../architecture/2026-07-24-adapter-owned-reasoning-effort-capabilities.md)继续拥有强度校验与默认值。

## Alternatives considered

**只链接外部 bundle 包。** 否决，因为 Loader 还要导入 patch 内的插件名，而这些包安装在 bundle 自己的 workspace 中。只链接 bundle 会留下其传递依赖和 peer 依赖无法解析的问题。

**把每个 bundle 依赖复制到应用 manifest。** 否决，因为这样会让官方应用拥有 fork 包，并把已安装产品绑定到每个可选的树外 bundle。

**在 headless 中保留 web-only fork 行。** 否决，因为缺少 host service 会留下 pending 行，并掩盖模型路由本身是否工作。Headless 组合不提供这些行要求的 web host capability。

**在 adapter 中强制关闭推理。** 否决，因为推理强度属于 adapter 所有的模型能力，而同一个 adapter 也服务于适合推理的部署。删除意外的用户级 `max` 选择即可消除延迟回归，不改变 provider 策略或 wire 序列化规则。

## Consequences

树外 bundle 插件会在正常 profile boot 期间解析，已安装应用的 fallback 仍是 in-box 包的来源。Headless boot 不再等待 web-only fork 行，模型请求可以到达 provider。Source launch 仍有约 20 秒冷启动成本；built CLI 将启动成本降至约 6 秒。显式 `max` 设置存在时，A6API 诊断请求带有 `reasoning: { effort: "max", summary: "auto" }`；删除它后，同一路由省略 `reasoning`，并在 HTTP 请求开始后约 2.3 秒收到首个文本事件。机器上的直连 `api.deepseek.com` credential 返回 HTTP 401，因此该 credential 失败与测得的 A6API TTFT 问题无关。

上游 Freebuff DeepSeek roots 只把 model 和 Freebuff branding 传给共享 base agent，不设置 `reasoningOptions`；其 streaming helper 只在 template 声明时转发 reasoning。因此，Harness 在用户没有明确选择强度时把推理选择留给已配置的 adapter/provider。

## Testing

`pnpm exec vitest run packages/boot/app-boot/tests/profile.spec.ts` 的 15 个测试全部通过，其中包含外部 bundle 依赖闭包用例。`pnpm exec tsc -b apps/cli/tsconfig.json --pretty false` 通过。Built headless CLI 返回了 `harness-built-ok`，删除 `max` 设置后再次 source launch 返回了 `harness-no-max`。

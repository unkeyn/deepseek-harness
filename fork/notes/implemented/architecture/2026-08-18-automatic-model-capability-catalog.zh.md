# Agent Note: 单个自动模型能力 catalog 插件

Status: implemented

[English](2026-08-18-automatic-model-capability-catalog.md) | 中文

## 问题

自定义 `llm-pi-ai` 路由通常只能从 OpenAI 兼容的 `/models` 端点获得模型 id。该端点不报告推理档位、图片输入或容量。已安装的 pi-ai catalog 按自身提供方 id 建索引，因此自定义网关即使服务已知模型也无法继承能力。Settings 页面曾短暂公开手工推理与输入控件，要求用户重述模型事实，并允许配置与 catalog 漂移。

## 决策

base bundle 在 `llm-pi-ai` 之前挂载一个 Host 插件 `@deepseek-ai/dsh-model-catalog`。该插件读取 MIT 依赖 `@oh-my-pi/pi-catalog` 发布的生成 `models.json`，并提供一个不可变的 `ctx.modelCatalog` 服务。它直接导入生成数据，因为该依赖的运行时模块要求 Bun，而 Harness 运行在 Node 上。

`llm-pi-ai` 在具化路由模型时通过 `ctx.get('modelCatalog')` 可选读取服务。已配置模型条目仍逐字段优先；其已安装 pi-ai 提供方 catalog 次之；外部标识 catalog 补全缺失的推理、输入与容量元数据；路由默认值仍是最终回退。路由保留自身配置的提供方 id、端点、API 协议、认证、标头与兼容性开关。跨提供方 reference lookup 绝不复制提供方特有的 wire routing。

精确模型 id 及其最后一个斜杠分段都是查询键。多个 catalog 提供方发布同一 id 时，插件选择能力元数据最完整的条目：图片模态、推理、显式档位，随后是上下文容量。选择是确定性的，不依赖配置顺序。

Models Settings UI 只编辑模型标识与可选容量，不负责声明推理或输入能力。Composer 推理选项、图片准入和请求校验共同消费同一份已解析 LLM 模型元数据。

## 曾考虑的替代方案

- **保留手工能力选择器**：拒绝，因为模型事实不是部署偏好，并且每次 catalog 更新都需要维护。
- **在 `llm-pi-ai` 中添加模型或提供方特例**：拒绝，因为别名和新模型会持续扩大硬编码白名单。
- **导入完整 catalog 运行时**：拒绝，因为其环境模块会在 Node 模块初始化时读取 Bun 全局变量。
- **把生成 JSON 复制进 Harness**：拒绝，因为这会产生第二份快照并模糊更新所有权。
- **复制跨提供方兼容性和 routing 元数据**：拒绝，因为网关 wire 行为属于已配置路由，而不是上游模型标识。

## 后果

自定义路由可以只列出 `{ id: 'gpt-5.6-sol' }`，并自动公开图片输入与 catalog 中的推理档位。显式 `input` 和 `reasoningEfforts` profile 字段仍可用于更正与 reference catalog 不同的端点，但产品 UI 不要求用户填写它们。

能力快照随 `@oh-my-pi/pi-catalog` 升级而更新。端点 discovery 只确定可用性；它无法发现已安装快照中没有的能力。

## 验证

- `packages/llm/llm-pi-ai/tests/catalog.spec.ts` 验证自定义 `gpt-5.6-sol` 路由自动投影图片与推理能力。
- `packages/client/ui-settings-models/tests/provider-form.client.spec.tsx` 验证提供方表单不写入手工能力字段。
- `apps/web/tests/declared-reasoning.e2e.ts` 验证组装后的 Composer 能力行为。
- `pnpm run build:lib:host` 验证该插件、服务声明与 consumer 在 Node 下共同构建。

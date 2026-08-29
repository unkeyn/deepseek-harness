# Agent Note: 网关默认线协议与 catalog 能力增强的模型发现

Status: implemented

[English](2026-08-22-pi-ai-gateway-default-api-and-discovery-capabilities.md) | 中文

## 问题

两个参考 catalog 都不认识的模型 id——提供方最新发布、从端点自身列表采纳的模型——在未声明路由级协议时，`llm-pi-ai` 路由解析会以 "needs an api" 失败。设置表单把它显示为模型行下方的红色拒绝，因此已抓取但未收录的模型即使端点真实可用也无法选择。另外，端点询问此前只返回 id 和容量：没有任何信息告诉采纳方该候选是否支持图像或推理。

## 决策

模型解析在所属解析步骤中按文档化的回退链解析线协议：路由 `api` → 该 id 的已安装 catalog 或身份 catalog 答案 → 该路由所有已发布模型一致同意的协议 → 前一个 catalog 可描述的同级模型 → OpenAI 兼容网关默认值（`openai-completions`）。手工声明路由的存在意义就是服务一个 OpenAI 兼容网关，而端点询问本来就把这类端点当作 Chat Completions 探测，因此最后的回退只是重述 seam 已有的假设，而非新造一个。provider 构造每条路由只绑定一个实现，所以模型解析出不一致协议的路由仍必须显式点名 `api`。

端点询问为每个候选补充参考 catalog 的事实——输入模态与思考级别（先查已安装 pi-ai catalog，再查共享身份 catalog）、列表未披露时的容量，以及回答“是否有 catalog 描述过它”的 `catalogMatched` 标记。Models 页面将其渲染为紧凑徽标；采纳会把图像能力写入该行，推理保持由解析层负责，因为其线上拼写属于适配器词汇。能力字段是 fork 自有类型上的可选附加 JSON 字段（`LlmDiscoveredModel`、apiproxy 的 `DiscoveredModelView` 及其 zod schema）；官方契约未被触碰。


## 已考虑的替代方案

- **超出网关默认值的静默逐模型协议猜测**——否决：更宽的任何猜测都会掩盖真实的配置错误；不一致仍然响亮失败。
- **把推理档位写入采纳行**——否决：线上拼写属于适配器词汇；对已知 id，身份 catalog 在解析时自会作答。
- **采纳时固定路由 `api`**——否决：路由级覆盖会遮蔽每个 catalog 模型自身的协议，破坏混合 catalog 路由。
- **OAuth/搜索面板留在 Plugins**——按产品方向否决：模型密钥与搜索密钥是同一类任务，应共享 Models 页面。

## 后果

真实存在但未收录的模型在端点列出它的那一刻即可选择，无需手改协议。严格性契约只收窄了一个有文档的默认值；直接编写 `settings.yaml` 的用户仍可通过路由 `api` 完全掌控。Plugins 页面失去 OAuth 标签和搜索提供方卡片；两者都位于 Models 分段之后。三个 node-lane 规格文件原先通过裸包名自引用客户端入口，在 jsdom 之外会因构建产物的加载器包装在导入期崩溃，现改为相对源码导入。

## 验证

`pnpm run typecheck` 通过；`pnpm --dir .. exec vitest run --config fork/vitest.config.ts` 通过 135 个文件 / 2273 个测试，包括网关默认回退、显式路由优先、发现能力增强、面板注册与卡片迁移的新用例。`pnpm run build:lib` 完成 host 与 client 两面打包；组装后的 web 应用可启动并派发一轮对话（`request/header` 在 step 开始后 2 ms），且所服务的客户端 bundle 包含新的面板接线。

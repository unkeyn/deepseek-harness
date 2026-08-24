# Agent Note: 网关默认线协议与参考目录增强的模型发现

Status: implemented

[English](2026-08-23-gateway-default-api-and-discovery-capabilities.md) | 中文

## 问题

两个参考目录都不认识的模型 id——提供方最新发布、从端点自身列表采纳的模型——在路由未点名协议时会因 "needs an api" 而 `llm-pi-ai` 路由解析失败。设置界面把这条拒绝以红色显示在模型行下方，因此端点明明在服务、列表里却选不了这个模型。另外，端点询问此前只返回 id 与容量：没有任何信息告诉采纳界面某个候选是否接受图像、是否具备推理能力。

## 决策

模型解析在归属的解析步骤里按一条成文的回退链确定线协议：路由 `api` → 该 id 的已安装 catalog 或身份 catalog 答案 → 该路由所有已发布模型一致同意的协议 → 前一个 catalog 可描述的同级模型 → OpenAI 兼容网关默认值（`openai-completions`）。手工声明的路由本就是为服务一个 OpenAI 兼容网关而存在的，而端点询问也早已把这些端点当作 Chat Completions 探测，因此最后的回退只是重述这条接缝已有的假设，并非新发明。provider 构造为每条路由只绑定一个实现，所以解析出不一致协议的路由仍必须显式点名 `api`。

协议事实来自回退而非已安装条目的 id，会保守地固定一个 compat 开关：`supportsDeveloperRole: false`。pi-ai 依据 baseURL 的探测会把认不出的私有 URL 当作 OpenAI 本尊，从而把推理模型的系统提示以 `developer` 角色发送——大多数网关直接拒绝该角色。已安装条目、路由配置与模型配置都优先于这个固定值。

端点询问为每个候选补充参考目录事实——接受的输入模态与思考级别（先查已安装 pi-ai catalog，再查共享身份 catalog）、列表未披露时的容量，以及回答「是否有 catalog 描述过它」的 `catalogMatched` 标记。LLM 运行时去重环节转发这些字段而不是逐字段重建行，使它们能到达 wire view。Models 页把它们渲染成紧凑徽标；采纳时把图像能力写入行，推理则保持由解析层负责，因为其线上拼写属于适配器词汇。这些能力字段是 `LlmDiscoveredModel`、apiproxy `DiscoveredModelView` 及其 zod schema 上的可选 JSON 附加字段。

## 已考虑的替代方案

- **超出网关默认值的静默逐模型协议猜测**——否决：更宽的猜测会掩盖真实的配置错误。不一致仍然响亮失败。
- **把推理档位写入被采纳的行**——否决：线上拼写归适配器所有；对已知 id，身份 catalog 本就会在解析时作答。
- **采纳时固定路由 `api`**——否决：路由级覆盖会遮蔽每个 catalog 模型自己的协议，破坏混合 catalog 路由。
- **让运行时去重环节无类型地透传未知字段**——否决：发现行可携带的每个字段都在一处枚举，丢字段应是一次显眼编辑而非无声丢失。

## 后果

端点一列出未收录但真实存在的模型即可选用，无需手改协议。严格性契约只收窄了一条成文默认值；直接编写 `settings.yaml` 的作者仍可通过路由 `api` 显式控制。

`packages/llm/llm-pi-ai/tests/catalog.spec.ts` 验证网关默认回退、显式路由优先、developer-role 固定值及模型配置优先于固定值。`packages/llm/llm-pi-ai/tests/discovery.spec.ts` 验证来自两个目录的能力增强、已披露容量优先以及未匹配标记。`packages/client/ui-settings-models/tests/provider-form.client.spec.tsx` 验证徽标渲染与图像能力的采纳。

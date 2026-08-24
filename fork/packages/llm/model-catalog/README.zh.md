# @deepseek-ai/dsh-fork-model-catalog

[English](README.md) | 中文

Host Cordis 插件，提供 `ctx.modelCatalog`。它读取 `@oh-my-pi/pi-catalog` 发布的生成模型数据库，投影模型标识、输入模态、推理档位与容量，同时避免导入该包依赖 Bun 的运行时模块。

启动时插件会一次性获取最新的 catalog 文档（默认来自上游仓库的生成文件），校验后在消费者解析之前替换内置快照。刷新失败或文档无效时记录警告并继续使用内置快照，因此源不可达只会降低能力元数据的质量，不影响可用性。可通过 `refresh: false`（完全离线的主机）、`refreshUrl` 与 `refreshTimeoutMs`（整个请求的截止时间）配置。

base bundle 在 `llm-pi-ai` 之前挂载这一个 catalog 插件。因此自定义提供方路由可以只列出模型 id；`llm-pi-ai` 保留路由自己的端点与协议，同时从 catalog 继承模型能力。提供方特有的标头、认证、兼容性开关与 wire routing 不会跨路由复制。

## 模型体验

Composer 的推理选项与图片准入通过提供方无关的 LLM 模型目录使用投影出的能力。catalog 不添加 prompt 文本或 token 内容。

#### KV Cache 影响

无。该插件只提供模型元数据；启动时的一次刷新仅替换进程内的查找表，不修改请求。

## 已知限制与暂缓事项

每次进程启动只尝试一次刷新；运行中途发布的模型在下次启动时出现。在 `refresh: false` 或无网络的主机上，内置快照仍是回退，直到升级依赖。

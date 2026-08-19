# @deepseek-ai/dsh-model-catalog

[English](README.md) | 中文

Host Cordis 插件，提供 `ctx.modelCatalog`。它读取 `@oh-my-pi/pi-catalog` 发布的生成模型数据库，投影模型标识、输入模态、推理档位与容量，同时避免导入该包依赖 Bun 的运行时模块。

base bundle 在 `llm-pi-ai` 之前挂载这一个 catalog 插件。因此自定义提供方路由可以只列出模型 id；`llm-pi-ai` 保留路由自己的端点与协议，同时从 catalog 继承模型能力。提供方特有的标头、认证、兼容性开关与 wire routing 不会跨路由复制。

## 模型体验

Composer 的推理选项与图片准入通过提供方无关的 LLM 模型目录使用投影出的能力。catalog 不添加 prompt 文本或 token 内容。

#### KV Cache 影响

无。该插件只提供不可变模型元数据，不修改请求。

## 已知限制与暂缓事项

插件使用依赖包内置的生成快照。动态端点发现可以识别可用模型 id，但在升级依赖之前不会更新已安装的能力数据库。

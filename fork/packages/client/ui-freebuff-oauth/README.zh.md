# @deepseek-ai/dsh-fork-client-ui-freebuff-oauth

[English](README.md) | 中文

Freebuff OAuth 插件的浏览器端。它向共享 Plugins 设置分节贡献 `OAuth` 标签，并将浏览器侧状态限制为连接状态、账户元数据和临时 device-login URL。

## 组合

请在 `@deepseek-ai/dsh-fork-host-apiproxy` 和共享 client settings 插件之后挂载此包。此包注册 id 为 `oauth` 的 `settings.plugins.tab` 贡献，不替换共享 Plugins 分节；`settings.oauth` locale namespace 提供英文和简体中文文案。

Host 必须组合 `ctx.freebuffOAuth` 和 `freebuff.*` API 方法。缺少这些服务的部署会根据 RPC 错误显示可操作的不可用状态，不会尝试在浏览器中执行 OAuth。

## OAuth 行为

标签页通过 `freebuff.beginLogin` 开始登录，在独立浏览器标签页打开返回的 Freebuff URL，并等待 `freebuff.completeLogin`。刷新和断开连接使用对应的 Host 方法。bearer token、fingerprint、credential reference 和 provider diagnostics 永远不会进入浏览器响应或标签页状态。

完成请求有意允许在 device approval 期间超过普通的一元传输超时。关闭页面或 API 连接丢失仍会在 Host 侧取消请求。

标签页还提供 `Open Harness Desktop`。浏览器不会发送文件系统路径；Host 从 credential plugin 配置中解析 `desktopShortcutPath`，并通过现有的 native path opener 打开它。Windows 默认路径为 `C:\Users\<user>\OneDrive\Desktop\DeepSeek Harness Desktop.lnk`；其他平台使用 `<home>/Desktop/DeepSeek Harness Desktop.lnk`。设置绝对路径形式的 `desktopShortcutPath` 可以覆盖默认值。

## 模型体验

无直接影响。此包只渲染 OAuth 控件；Freebuff LLM provider 负责模型发现、admission、请求元数据和模型响应。

#### KV Cache 影响

无；此包既不组装也不发送 provider 请求。

## 已知限制与暂缓事项

- 标签页显示 Host 从已存储 Freebuff credentials 中选择的一个脱敏账户；多账户选择不属于此 UI 约定。
- Freebuff device login 没有 refresh-token exchange。Host 报告 `reauthenticate` 时，用户必须重新登录。
- 标签页仅存在于 Web client composition。Headless 和 ACP 用户使用 Host OAuth provider 或 `/freebuff-login` 命令。

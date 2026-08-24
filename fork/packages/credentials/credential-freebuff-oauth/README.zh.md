# Freebuff OAuth

[English](README.md) | 中文

`@deepseek-ai/dsh-fork-credential-freebuff-oauth` 通过 `ctx.freebuffOAuth` service 提供 Freebuff device-code 登录。它请求 `/api/auth/cli/code`、轮询 `/api/auth/cli/status`，并只通过 `ctx.credentials` 保存返回的 bearer token。

此 service 不会伪造 refresh-token flow。Freebuff device login 返回 access token 而不返回 refresh token，因此提供方返回 `401` 后，过期或被拒绝的 credential 会被删除，用户必须再次调用 `ctx.freebuffOAuth.login()` 完成登录。内置 `/freebuff-login` command 向交互用户提供相同流程。Token value 永远不会出现在账户 snapshot 或配置诊断中。

Provider 默认使用 `https://freebuff.com`。只有在信任的 Freebuff-compatible deployment 中才应覆盖 `baseURL`。需要持久化登录状态时，必须先组合 credentials provider，再组合此 plugin。

Device-code 请求使用 Freebuff 的 CLI fingerprint 算法：由本机数据生成、按进程缓存的 `enhanced-` SHA-256 标识；增强采集失败时使用官方的 `codebuff-cli-` 随机回退。Host 将该标识发送到 `/api/auth/cli/code`，轮询时复用它以及服务器返回的 `fingerprintHash` 和原始 `expiresAt` 值。插件不会轮换或伪造 fingerprint，也不保证 Freebuff 一定接受账号或会话。

此 service 还负责 OAuth 设置标签页使用的 Host 侧 `Open Harness Desktop` action。它从配置解析绝对形式的 `desktopShortcutPath`，不会接受浏览器传入的路径。省略此选项时，Windows 使用 `C:\Users\<user>\OneDrive\Desktop\DeepSeek Harness Desktop.lnk`，其他平台使用 `<home>/Desktop/DeepSeek Harness Desktop.lnk`。

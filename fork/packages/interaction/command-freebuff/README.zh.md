# Freebuff Login Command

[English](README.md) | 中文

`@deepseek-ai/dsh-fork-command-freebuff` 注册 `/freebuff-login`。第一次调用返回 Freebuff device URL；用户在浏览器中确认后，`/freebuff-login wait` 完成轮询，并通过 credentials service 持久化 bearer token。

Command 不记录输入参数，token 也不会出现在 command result 或账户 snapshot 中。

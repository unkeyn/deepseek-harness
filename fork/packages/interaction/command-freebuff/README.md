# Freebuff Login Command

English | [中文](README.zh.md)

`@deepseek-ai/dsh-fork-command-freebuff` registers `/freebuff-login`. The first invocation returns the Freebuff device URL; after approving it in a browser, `/freebuff-login wait` completes polling and persists the bearer token through the credentials service.

The command records no input arguments, and the token is never included in the command result or account snapshot.

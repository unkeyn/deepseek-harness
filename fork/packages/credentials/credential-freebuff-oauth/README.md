# Freebuff OAuth

English | [中文](README.zh.md)

`@deepseek-ai/dsh-fork-credential-freebuff-oauth` provides the Freebuff device-code login as the `ctx.freebuffOAuth` service. It requests `/api/auth/cli/code`, polls `/api/auth/cli/status`, and stores only the returned bearer token through `ctx.credentials`.

The service does not invent a refresh-token flow. Freebuff's device login returns an access token without a refresh token, so a provider-side `401` removes an expired or rejected credential and the user must complete `ctx.freebuffOAuth.login()` again. The bundled `/freebuff-login` command exposes the same flow to interactive users. Token values never appear in account snapshots or configuration diagnostics.

The provider defaults to `https://freebuff.com`. Override `baseURL` only for a trusted Freebuff-compatible deployment. A credentials provider must be composed before this plugin when login persistence is required.

The device-code request uses Freebuff's CLI fingerprint algorithm: a process-cached `enhanced-` SHA-256 identifier derived from local machine data, with the official `codebuff-cli-` random fallback when enhanced collection fails. The Host sends that identifier to `/api/auth/cli/code` and reuses it with the server-provided `fingerprintHash` and exact `expiresAt` value during polling. The plugin does not rotate or spoof fingerprints and does not guarantee that Freebuff will accept an account or session.

The service also owns the Host-side `Open Harness Desktop` action used by the OAuth settings tab. It resolves an absolute `desktopShortcutPath` from configuration and never accepts that path from the browser. When the option is omitted, Windows uses `C:\Users\<user>\OneDrive\Desktop\DeepSeek Harness Desktop.lnk`; other platforms use `<home>/Desktop/DeepSeek Harness Desktop.lnk`.

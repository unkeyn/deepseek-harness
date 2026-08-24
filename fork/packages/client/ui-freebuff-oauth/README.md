# @deepseek-ai/dsh-fork-client-ui-freebuff-oauth

English | [中文](README.zh.md)

The browser half of the Freebuff OAuth plugin. It contributes an `OAuth` tab to the shared Plugins settings section and keeps the browser projection limited to connection status, account metadata, and the temporary device-login URL.

## Composition

Mount this package after `@deepseek-ai/dsh-fork-host-apiproxy` and the shared client settings plugins. The package registers the `settings.plugins.tab` contribution with id `oauth`; it does not replace the shared Plugins section. Its `settings.oauth` locale namespace supplies English and Simplified Chinese copy.

The Host must compose `ctx.freebuffOAuth` and the `freebuff.*` API methods. A deployment without those services renders an actionable unavailable state from the RPC error instead of attempting OAuth in the browser.

## OAuth behavior

The tab starts login through `freebuff.beginLogin`, opens the returned Freebuff URL in a separate browser tab, and waits through `freebuff.completeLogin`. Refresh and disconnect use the corresponding Host methods. The bearer token, fingerprint, credential reference, and provider diagnostics never enter the browser response or the tab state.

The completion request is intentionally allowed to wait for device approval beyond the ordinary unary transport timeout. Closing the page or losing the API connection still cancels the request on the Host.

The tab also exposes `Open Harness Desktop`. The browser sends no filesystem path; the Host resolves `desktopShortcutPath` from the credential plugin configuration and opens it through the existing native path opener. On Windows the default is `C:\Users\<user>\OneDrive\Desktop\DeepSeek Harness Desktop.lnk`; other platforms use `<home>/Desktop/DeepSeek Harness Desktop.lnk`. Set an absolute `desktopShortcutPath` to override the default.

## Model Experience

None directly. This package renders OAuth controls; the Freebuff LLM provider owns model discovery, admission, request metadata, and model responses.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- The tab shows one redacted account, selected by the Host from its stored Freebuff credentials. Multi-account selection is not part of this UI contract.
- Freebuff device login has no refresh-token exchange. When the Host reports `reauthenticate`, the user must start a new login.
- The tab is available only in the Web client composition. Headless and ACP users use the Host OAuth provider or `/freebuff-login` command.

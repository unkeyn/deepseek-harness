# dsh-credential-oauth

Provider-specific OAuth account lifecycle built on the credential-reference capability. The provider adapter validates callback results, refreshes provider-native tokens, and optionally revokes them; this package never defines a universal OAuth wire format.

`RemoteOAuthCredentialStore` is a read-only projection over a generation-tagged broker snapshot source. It publishes detached credential references and OAuth identities only; `resolve()` returns no token value, while `set()` and `unset()` reject with `OAUTH_REMOTE_STORE_READ_ONLY`. Only newer generations replace the projection. Provider account pools filter OAuth identities for the selected provider, and API-key rows are retained regardless of that OAuth policy.
The remote store accepts the broker-native snapshot source as well as an adapted remote source. It applies newer snapshot, entry, and removal events immediately, ignores stale generations, and exposes `dispose()` to release the broker subscription. The projection remains detached and read-only.

 models Claude Code's documented browser callback and setup-token login modes through injected `ClaudeCodeOAuthTransport` functions. The transport owns callback exchange, setup-token validation, refresh, revocation, authorization, and requests; this package contains no undocumented Claude endpoint URLs. Missing transport operations reject with `OAuthUnsupportedOperationError`. Setup-token accounts may omit a refresh reference and are reauthenticated when their access token is no longer usable.

Logout always removes local references before attempting provider revocation. Providers without a revocation operation report an explicit unsupported-operation failure after local cleanup. A revocation failure is reported separately from completed local cleanup.

## Model Experience

### OAuth account lifecycle

#### What the model sees

Nothing. OAuth account metadata and credential references remain below model requests.

#### Token effect

The package adds no prompt or completion tokens.

#### KV Cache effect

The package does not change request content or cache identity.

## Known Limitations and Deferred Work

- Persistence and account-pool selection remain consumers of the redacted snapshot and existing credential broker/pool store.
- Callback state, PKCE, browser listener, setup-token acquisition, and provider-specific callback transport belong in the injected transport or initiating UI.
- Claude Code refresh and revocation remain available only when the injected transport provides them.
- The fake provider is deterministic test infrastructure, not a production OAuth implementation.

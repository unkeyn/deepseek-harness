# PROXY-001: Account-bound proxy routing

Status: planned

Owner: unassigned

Contributors: —

Milestone: M5

Dependencies: ROUTE-001

Agent Note: required before implementation

Completion record: —

## Цель

Добавить proxy routing, связанный с provider/account lease и пользовательской конфигурацией routes.

## Scope

- Proxy references вместо inline passwords.
- Provider, account и route bindings.
- Stable proxy на время lease.
- Direct fallback только по явной политике.
- HTTP/HTTPS support; SOCKS рассматривается отдельным implementation.
- Proxy health отдельно от credential health.

## Не входит

- Proxy для несвязанных MCP, web tools и plugin downloads в этой задаче.

## Acceptance criteria

- Два параллельных provider requests могут использовать разные proxies без взаимного влияния.
- Proxy failure не quarantine credential, пока прямой provider auth не проверен отдельно.
- Cancellation прекращает proxy request и освобождает lease.

## Verification

- Local proxy integration tests для success, auth failure, timeout и redirect.
- Cross-provider isolation test.
- Provider/account binding tests.

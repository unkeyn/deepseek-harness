# PROXY-001: Account-bound proxy routing

Status: planned

Owner: unassigned

Contributors: —

Milestone: M5

Dependencies: ROUTE-001

Agent Note: required before implementation

Completion record: —

## Цель

Добавить proxy routing, связанный с provider/account lease и ограниченный разрешёнными upstream domains.

## Scope

- Proxy references вместо inline passwords.
- Provider, account и domain policy.
- Stable proxy на время lease.
- Direct fallback только по явной политике.
- HTTP/HTTPS support; SOCKS рассматривается отдельным implementation.
- Proxy health отдельно от credential health.

## Не входит

- Глобальный dispatcher для всего Harness по умолчанию.
- Перенаправление MCP, web tools, plugin downloads или OAuth domains без allowlist.
- Автоматическая смена географии ради обхода provider policy.

## Acceptance criteria

- Два параллельных provider requests могут использовать разные proxies без взаимного влияния.
- Proxy auth не появляется в URL diagnostics, UI или logs.
- Proxy failure не quarantine credential, пока прямой provider auth не проверен отдельно.
- Domain allowlist запрещает отправку credential на неожиданный host после redirect.
- Cancellation прекращает proxy request и освобождает lease.

## Verification

- Local proxy integration tests для success, auth failure, timeout и redirect.
- Cross-provider isolation test.
- DNS/host allowlist and credential-leak regression tests.

## Security and privacy

Proxy является отдельным trust boundary и получает только traffic тех endpoints, которые пользователь явно связал с ним.

/**
 * API-key check surface, node half. The empty apply exists so the plugin
 * appears in the host cordis.yml / Loader; the browser half owns the panel and
 * its Connection channel through exports["./client"], discovered from the
 * package.json dsh.client declaration. Every key this surface shows is one the
 * user pasted, so this package registers no namespace of its own and stores
 * nothing on the host.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}

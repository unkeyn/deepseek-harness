# DeepSeek Harness Fork Plugins

This directory contains the fork-only packages and composition overlay. The
official repository tree outside `fork/` is kept byte-for-byte identical to
`upstream/master`; the fork is selected by adding the patch bundle to an
official profile.

The packages keep the same capability seams as the official project, but use
the `@deepseek-ai/dsh-fork-*` scope. The bundle patch disables each forked
official row and inserts its replacement as a separate Loader row with a `-fork`
id. This keeps both implementations addressable while only one is active. The
durable credential pool is mounted beside the official `ctx.credentials`
reference service, so pool metadata can be enabled without replacing secret
storage.

## Layout

- `packages/` contains fork implementations and fork-only providers.
- `bundle/` contains the Cordis patch layer that disables official rows,
  inserts fork replacements, and mounts fork-only providers.
- `notes/` and `roadmap/` contain fork design records and work tracking.

Every replacement is still an ordinary Loader row. A profile can replace one
fork row again by patching its fork id, for example `credential-broker` can
point to `@deepseek-ai/dsh-fork-credential-broker-memory` with its own `entries`
configuration. To restore an official implementation, disable the fork row
and explicitly re-enable the official id in the same later patch layer:

```yaml
- id: llm-fork
  disabled: true
- id: llm
  disabled: false
```

The patch uses `name` only as an expected-name guard; changing it does not
rename an existing Loader row.

The fork workspace includes the official workspace packages as read-only
development dependencies through `../packages/*/*`; it does not modify the
official workspace manifest or lockfile.

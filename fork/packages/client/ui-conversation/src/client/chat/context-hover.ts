/** Shared transient hover flag: while the composer's context ring is hovered,
 * the stats line swaps its billing group for the heuristic composition. One
 * module store because the ring (composer bar) and the strip (composer dock)
 * are sibling slots with no owner in common. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Whether the composer's context ring is currently hovered. */
export const contextMeterHover: SnapshotStore<boolean> = createSnapshotStore(false)

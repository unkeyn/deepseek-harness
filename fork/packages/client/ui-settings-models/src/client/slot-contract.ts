/**
 * Owner share of a Models page panel (`settings.models.panel`). The slot-key
 * declaration itself lives in `client/index.ts`, whose emitted declarations
 * every panel registrant already consumes.
 */

/** Owner share of a Models page panel (the section supplies nothing). */
export interface SettingsModelsPanelOwnerProps {
  /** Marker field: panel owner props are intentionally empty. */
  children?: never
}

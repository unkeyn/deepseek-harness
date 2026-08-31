/**
 * Owner shares of the Models page's child slots (`settings.models.panel`,
 * `settings.models.footer`). The slot-key declarations themselves live in
 * `client/index.ts`, whose emitted declarations every registrant already
 * consumes.
 */

/** Owner share of a Models page panel (the section supplies nothing). */
export interface SettingsModelsPanelOwnerProps {
  /** Marker field: panel owner props are intentionally empty. */
  children?: never
}

/**
 * Owner share of one Models page footer entry — the ordered area below the
 * segment switcher, where a page-wide action that is not a provider row
 * belongs (the section supplies nothing).
 */
export interface ModelsFooterOwnerProps {
  /** Marker field: footer owner props are intentionally empty. */
  children?: never
}

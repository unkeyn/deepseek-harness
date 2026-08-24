/**
 * The `settings.models.panel` slot type — one feature panel beside the
 * provider list on the Models page, keyed by nothing: a list contribution
 * carries its own id, order, and label thunk, and the section stacks them
 * behind the built-in API segment.
 *
 * TYPE HOME RATIONALE: the section declares this slot at runtime, and a
 * plugin registering a panel here already depends on this package for the
 * slot's declaration. The type therefore lives with its declarer, exactly
 * like `settings.plugin.item` does.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface SlotMap {
        /** One feature panel beside the provider list on the Models page (see module JSDoc). */
        'settings.models.panel': {
            kind: 'list';
            scope: 'root';
            owner: SettingsModelsPanelOwnerProps;
        };
    }
}
/** Owner share of a Models page panel (the section supplies nothing). */
export interface SettingsModelsPanelOwnerProps {
    /** Marker field: panel owner props are intentionally empty. */
    children?: never;
}
//# sourceMappingURL=slot-contract.d.ts.map
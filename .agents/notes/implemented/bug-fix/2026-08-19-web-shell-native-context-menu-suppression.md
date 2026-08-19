# Agent Note: Web shell suppresses the native context menu

Status: implemented

English | [中文](2026-08-19-web-shell-native-context-menu-suppression.zh.md)

## Problem

The browser context menu overlays Harness controls and exposes browser-owned actions that do not operate on Harness state. A right-click inside the application can also interrupt an in-product pointer interaction with a second menu owned by the browser.

## Decision

`AppFrame`, the root application frame, prevents the default `contextmenu` action for events inside the Harness UI. The event continues through React propagation, so a component may still implement an explicit product context menu while the browser menu remains suppressed.

Text selection remains available. Controls whose click can be emitted at the end of a drag-selection ignore that click while the document selection is non-collapsed; the model selector applies this rule and marks its trigger as non-selectable.

## Alternatives considered

**Suppress the menu on `document`.** A document-global listener would also own content outside the mounted application and require explicit lifecycle cleanup. The root frame gives the policy the same lifetime and extent as the product UI.

**Disable right-click only on individual components.** Browser chrome would remain inconsistent across the transcript, composer, sidebar, and overlays, and every new component would need to remember the policy.

**Clear text selection before opening controls.** This makes a completed selection destructive and still interprets the selection gesture as a command. Ignoring the resulting click preserves the user's selection and requires a deliberate subsequent activation.

## Consequences

Right-click inside Harness no longer opens browser chrome. Native copy and search actions from that menu are unavailable there; keyboard copy and Harness-owned actions remain available. Product-owned context menus can opt in without competing with the browser menu. Component tests pin both root cancellation and selection-safe model-trigger behavior.

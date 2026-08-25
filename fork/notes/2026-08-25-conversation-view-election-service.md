# Agent Note: Conversation view election as a service verb

Status: implemented

## Problem

The active conversation view (chat / trajectory / harvest console) lives in the per-session chat store, which is deliberately internal to ui-conversation: the slot core records only `key`/`id`/`order`/`label`/`priority` from registration options, and the store handle never leaves the package. A gating plugin that contributes its own view tab — ui-harvest, whose tab exists only while a harvest-preset session is current — could register the tab but never land on it: every harvest session opened on Chat, so the mode looked unchanged until the operator clicked the tab manually.

## Decision

`IConversation` grows two scope-free verbs backed by the shared chat-store handle the apply already owns: `viewOf(sessionId)` reads the session's elected view (null while unchosen) through a throwaway rehydrated store instance, and `openView(sessionId, viewId)` writes through the live bound actions the session-body inject now captures in the controller, holding the election as a pending intent when the chrome has not mounted yet (the gate reacts to session-list changes and can fire before the render). ui-harvest calls `openView` once per session engagement, only when `viewOf` is null, so an explicit tab choice — including Chat — persists and wins. No slot-core, official-tree, or view-registration changes; the election policy stays in the gating plugin.

## Consequences

Harvest sessions open on the console; non-harvest sessions and manually chosen views behave exactly as before. Any future gated view tab reuses the same two verbs instead of new store plumbing. Stale captured actions for a disposed session scope are overwritten on re-attach and only reachable through a session the gate believes current, so the window for a detached write is a session deleted in the same tick as its election.

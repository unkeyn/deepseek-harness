/**
 * Compatibility barrel for the former `dsh-client-runtime/client` module.
 * Runtime ownership remains with the current upstream domain plugins.
 */
import type { Context } from '@deepseek-ai/cordis'

export type ClientContext = Context

export {
  createSnapshotStore,
  defineStore,
  shallowEqual,
} from '@deepseek-ai/dsh-client-store'
export type {
  EngineStoreHandle,
  ObservableSnapshot,
  SnapshotStore,
} from '@deepseek-ai/dsh-client-store'

export { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'

export { createScope } from '@deepseek-ai/dsh-api-session-controller/client'
export type {
  ISession,
  ISessions,
  SessionBinding,
  SessionFace,
  SessionListState,
  SessionSummary,
  UseProjection,
} from '@deepseek-ai/dsh-api-session-controller/client'
export type { SessionId } from '@deepseek-ai/dsh-session/types'

export type {
  WorkspaceId,
  WorkspaceView,
  WorkspaceSnapshot as WorkspaceListState,
} from '@deepseek-ai/dsh-api-workspace-controller/client'

export {
  ConversationNodeAssembler,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
export type {
  AssistantBlock,
  AssistantMessageNode,
  CommandNode,
  CompactionSummaryNode,
  ContextMessageNode,
  ConversationLocation,
  ConversationLocationDataStore,
  ConversationMatch,
  ConversationNode,
  ConversationNodeContext,
  ConversationNodeDefinition,
  ConversationPreviousContext,
  ConversationSnapshot,
  ConversationTimelineSnapshot,
  ConversationTurnDataMap,
  ConversationViewBuilder,
  ConversationViewDefinition,
  KnownContextForm,
  ModelRetryNode,
  PartialAssistant,
  RunningToolCall,
  SteeringMessageNode,
  TodoItem,
  ToolCallBlock,
  ToolResultNode,
  TurnErrorNode,
  TurnLocation,
  TurnMaxTokensNode,
  UnknownSurfaceNode,
  UserMessageNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'

export { EMPTY_CHAT_SNAPSHOT } from '@deepseek-ai/dsh-client-ui-chat/client'
export type {
  ChatConversationViewNode,
  ChatLocationNodeIndex,
  ChatNodeStore,
  ChatSnapshot,
  LegacyConversationSlice,
} from '@deepseek-ai/dsh-client-ui-chat/client'

export type {
  SettingsScope,
  SettingsScopeSnapshot,
} from '@deepseek-ai/dsh-client-ui-settings/client'

export {
  isAppendSurfaceEvent,
  isReplacementSurfaceEvent,
} from '@deepseek-ai/dsh-session/surface'
export {
  resolveWorkspacePath,
  workspaceTitleOf,
} from '@deepseek-ai/dsh-util-workspace-path'

/** Old concrete-runtime name retained as an outward service type only. */
export type SessionRuntime = import('@deepseek-ai/dsh-api-session-controller/client').ISessions

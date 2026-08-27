<<<<<<< HEAD:packages/client/ui-conversation/src/client/chat/AssistantNodeView.tsx
import { memo, useMemo } from 'react'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
=======
import { memo, useCallback, useMemo } from 'react'
>>>>>>> upstream/master:packages/client/ui-chat/src/client/chat/AssistantNodeView.tsx
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'

type AssistantStepProps = ChatNodeViewProps<'assistant-step'> & PropsRenderSlots<'conversation.chat.reasoning'>

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({
<<<<<<< HEAD:packages/client/ui-conversation/src/client/chat/AssistantNodeView.tsx
  node, useTurnData, openFile, renderMessageImages, fileMentions, renderSlot, t,
}: AssistantStepProps) {
=======
  node, useTurnData, turnProcess, openFile, renderMessageImages, fileMentions, t,
}: ChatNodeViewProps<'assistant-step'>) {
>>>>>>> upstream/master:packages/client/ui-chat/src/client/chat/AssistantNodeView.tsx
  const data = node.data
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const tail = useTurnData('turn-tail')
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, openFile }
  }, [data.finalNode, openFile, tail, turn])
  const mentions = useMemo(
    () => owner === undefined ? undefined : fileMentions(owner),
    [fileMentions, owner],
  )
  const reasoningHidden = turnProcess !== undefined
    && turnProcess.foldable
    && turnProcess.spec.answerStep === data.step
    && turnProcess.spec.inlineReasoning
    && !turnProcess.open
  const revealProcess = useCallback(() => { turnProcess?.setOpen(true) }, [turnProcess])
  return (
    <AssistantMarkdown
      blocks={data.blocks}
      streaming={data.status === 'running'}
      interrupted={data.status === 'interrupted'}
      renderMessageImages={renderMessageImages}
<<<<<<< HEAD:packages/client/ui-conversation/src/client/chat/AssistantNodeView.tsx
      renderReasoning={renderSlot}
=======
      reasoningHidden={reasoningHidden}
      revealProcess={revealProcess}
>>>>>>> upstream/master:packages/client/ui-chat/src/client/chat/AssistantNodeView.tsx
      mentions={mentions}
      t={t}
    />
  )
})

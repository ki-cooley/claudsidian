import { useMemo } from 'react'

import type { ActivityEvent, ChatMessage, ContentBlock } from '../../types/chat'

import ActivityAccordion from './ActivityAccordion'
import AssistantMessageContent from './AssistantMessageContent'
import EditDiffBlock from './EditDiffBlock'

interface InterspersedContentProps {
  contentBlocks: ContentBlock[]
  activities: ActivityEvent[]
  isStreaming: boolean
  contextMessages: ChatMessage[]
  isApplying: boolean
  onApply: (blockToApply: string, chatMessages: ChatMessage[]) => void
}

const EDIT_ACTIVITY_TYPES = new Set([
  'vault_write',
  'vault_edit',
  'vault_rename',
  'vault_delete',
])

export default function InterspersedContent({
  contentBlocks,
  activities,
  isStreaming,
  contextMessages,
  isApplying,
  onApply,
}: InterspersedContentProps) {
  // Build activity lookup map
  const activityMap = useMemo(
    () => new Map(activities.map((a) => [a.id, a])),
    [activities],
  )

  return (
    <div className="smtcmp-interspersed-content">
      {contentBlocks.map((block, idx) => {
        const isLastBlock = idx === contentBlocks.length - 1

        switch (block.type) {
          case 'text':
            return (
              <div key={`text-${idx}`} className="smtcmp-chat-messages-assistant">
                <AssistantMessageContent
                  content={block.text}
                  contextMessages={contextMessages}
                  handleApply={onApply}
                  isApplying={isApplying}
                />
              </div>
            )

          case 'activity_group': {
            const groupActivities = block.activityIds
              .map((id) => activityMap.get(id))
              .filter((a): a is ActivityEvent => a !== undefined)

            if (groupActivities.length === 0) return null

            // Separate exploration from edit activities
            const exploration = groupActivities.filter(
              (a) => !EDIT_ACTIVITY_TYPES.has(a.type),
            )
            const edits = groupActivities.filter(
              (a) => EDIT_ACTIVITY_TYPES.has(a.type),
            )

            return (
              <div key={`group-${idx}`} className="smtcmp-interspersed-group">
                {exploration.length > 0 && (
                  <ActivityAccordion
                    activities={exploration}
                    isStreaming={isStreaming && isLastBlock}
                  />
                )}
                {edits.map((edit) => (
                  <EditDiffBlock key={edit.id} activity={edit} />
                ))}
              </div>
            )
          }

          default:
            return null
        }
      })}
    </div>
  )
}

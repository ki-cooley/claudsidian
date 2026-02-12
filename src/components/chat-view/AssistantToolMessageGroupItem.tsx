import { useMemo } from 'react'

import {
  ActivityEvent,
  AssistantToolMessageGroup,
  ChatMessage,
  ChatToolMessage,
} from '../../types/chat'

import ActivityAccordion from './ActivityAccordion'
import AssistantMessageAnnotations from './AssistantMessageAnnotations'
import AssistantMessageContent from './AssistantMessageContent'
import AssistantMessageReasoning from './AssistantMessageReasoning'
import AssistantToolMessageGroupActions from './AssistantToolMessageGroupActions'
import EditDiffBlock from './EditDiffBlock'
import ToolMessage from './ToolMessage'

/**
 * Check if message content is primarily just tool result descriptions.
 * When we have activities displayed, these are redundant.
 * Returns the content minus tool-result patterns, or empty if only tool results.
 */
function getDisplayContent(content: string, hasActivities: boolean): string {
  if (!hasActivities || !content) {
    return content
  }

  // If the content is short (under 200 chars) and contains tool patterns,
  // it's likely just tool result summaries - hide it entirely
  const toolIndicatorPatterns = [
    /\*\*(Read|Created|Edited|Found|Listed|Searched|Matched|Deleted|Renamed|Grep matches|Found files):\*\*/i,
    /[📖📝✏️🔍📂🔎📄🗑️➡️🌐]/,
    /^(I |I've |I'm |Let me |Here's |The )(read|created|edited|found|listed|searched|deleted|renamed)/i,
  ]

  const hasToolIndicators = toolIndicatorPatterns.some((p) => p.test(content))

  if (hasToolIndicators && content.length < 200) {
    return '' // Hide short tool-result-only content
  }

  // For longer content, strip tool patterns but keep the rest
  const stripPatterns = [
    // Bold markdown formats
    /\*\*(Read|Created|Edited|Found|Listed|Searched|Matched|Deleted|Renamed|Grep matches|Found files):\*\*\s*[^\n]+\n?/gi,
    // Emoji formats
    /[📖📝✏️🔍📂🔎📄🗑️➡️🌐]\s*\w+:\s*[^\n]+\n?/g,
  ]

  let result = content
  for (const pattern of stripPatterns) {
    result = result.replace(pattern, '')
  }

  // Clean up extra newlines
  result = result.replace(/\n{3,}/g, '\n\n').trim()

  return result
}

export type AssistantToolMessageGroupItemProps = {
  messages: AssistantToolMessageGroup
  contextMessages: ChatMessage[]
  conversationId: string
  isApplying: boolean // TODO: isApplying should be a boolean for each assistant message
  isStreaming?: boolean // Whether the message is currently streaming
  onApply: (blockToApply: string, chatMessages: ChatMessage[]) => void
  onToolMessageUpdate: (message: ChatToolMessage) => void
}

export default function AssistantToolMessageGroupItem({
  messages,
  contextMessages,
  conversationId,
  isApplying,
  isStreaming = false,
  onApply,
  onToolMessageUpdate,
}: AssistantToolMessageGroupItemProps) {
  // Collect all activities from assistant messages, tool calls, and parsed content
  const { allActivities, editActivities } = useMemo(() => {
    const activities: ActivityEvent[] = []
    const edits: ActivityEvent[] = []
    const seenIds = new Set<string>()

    for (const message of messages) {
      // Collect activities from assistant messages
      if (message.role === 'assistant') {
        // First check for explicit activity events
        if (message.activities) {
          for (const activity of message.activities) {
            if (!seenIds.has(activity.id)) {
              seenIds.add(activity.id)
              activities.push(activity)
              if (
                activity.type === 'vault_write' ||
                activity.type === 'vault_edit' ||
                activity.type === 'vault_rename' ||
                activity.type === 'vault_delete'
              ) {
                edits.push(activity)
              }
            }
          }
        }

        // Parse tool results from message content (for backend that embeds results in text)
        // Only parse if no explicit activities were provided (to avoid duplicates)
        // Patterns: "**Read:** filename", "**Listed:** X folders", "**Found:** ...", etc.
        if (message.activities && message.activities.length > 0) {
          continue // Skip content parsing if we have explicit activities
        }

        const content = message.content || ''
        const toolPatterns = [
          { pattern: /\*\*Read:\*\*\s*\[?([^\]\n]+)\]?/g, type: 'vault_read' as const },
          { pattern: /\*\*Listed:\*\*\s*([^\n]+)/g, type: 'vault_list' as const },
          { pattern: /\*\*Found:\*\*\s*([^\n]+)/g, type: 'vault_search' as const },
          { pattern: /\*\*Created:\*\*\s*([^\n]+)/g, type: 'vault_write' as const },
          { pattern: /\*\*Edited:\*\*\s*([^\n]+)/g, type: 'vault_edit' as const },
          { pattern: /\*\*Renamed:\*\*\s*([^\n]+)/g, type: 'vault_rename' as const },
          { pattern: /\*\*Deleted:\*\*\s*([^\n]+)/g, type: 'vault_delete' as const },
          { pattern: /\*\*Searched:\*\*\s*([^\n]+)/g, type: 'vault_grep' as const },
          { pattern: /\*\*Matched:\*\*\s*([^\n]+)/g, type: 'vault_glob' as const },
        ]

        for (const { pattern, type } of toolPatterns) {
          let match
          while ((match = pattern.exec(content)) !== null) {
            const activityId = `parsed-${type}-${match.index}`
            if (seenIds.has(activityId)) continue
            seenIds.add(activityId)

            const resultText = match[1].trim()
            const activity: ActivityEvent = {
              id: activityId,
              type,
              status: 'complete',
              startTime: Date.now(),
              endTime: Date.now(),
              toolName: type,
              toolResult: resultText,
              filePath: type === 'vault_read' || type === 'vault_write' || type === 'vault_edit'
                ? resultText.split(/[,\s]/)[0]
                : undefined,
            }

            activities.push(activity)

            if (
              type === 'vault_write' ||
              type === 'vault_edit' ||
              type === 'vault_rename' ||
              type === 'vault_delete'
            ) {
              edits.push(activity)
            }
          }
        }
      }

      // Synthesize activities from tool messages (for MCP-based providers)
      if (message.role === 'tool' && message.toolCalls) {
        for (const toolCall of message.toolCalls) {
          const toolName = toolCall.request.name

          const activityId = `tool-${toolCall.request.id}`
          if (seenIds.has(activityId)) continue
          seenIds.add(activityId)

          const cleanName = toolName.replace('backend__', '')
          const toolTypeMapping: Record<string, ActivityEvent['type']> = {
            search_cookbooks: 'search_cookbooks',
            list_cookbook_sources: 'list_cookbook_sources',
            web_search: 'web_search',
          }
          let activityType: ActivityEvent['type'] =
            toolTypeMapping[cleanName] ||
            (cleanName.startsWith('vault_') ? cleanName as ActivityEvent['type'] : 'tool_call')

          let toolInput: Record<string, unknown> = {}
          try {
            if (toolCall.request.arguments) {
              toolInput = JSON.parse(toolCall.request.arguments)
            }
          } catch {
            // Ignore parse errors
          }

          let toolResult: string | undefined
          if ('data' in toolCall.response && toolCall.response.data?.text) {
            toolResult = toolCall.response.data.text
          } else if ('error' in toolCall.response) {
            toolResult = toolCall.response.error
          }

          const activity: ActivityEvent = {
            id: activityId,
            type: activityType,
            status: 'complete',
            startTime: Date.now(),
            endTime: Date.now(),
            toolName: cleanName,
            toolInput,
            toolResult,
            filePath: typeof toolInput.path === 'string' ? toolInput.path : undefined,
          }

          activities.push(activity)

          if (
            activityType === 'vault_write' ||
            activityType === 'vault_edit' ||
            activityType === 'vault_rename' ||
            activityType === 'vault_delete'
          ) {
            edits.push(activity)
          }
        }
      }
    }

    // Deduplicate edit activities by filePath + type, preferring entries with diff data
    const dedupedEdits = new Map<string, ActivityEvent>()
    for (const edit of edits) {
      const key = `${edit.filePath || edit.id}:${edit.type}`
      const existing = dedupedEdits.get(key)
      if (!existing || (edit.diff && !existing.diff)) {
        dedupedEdits.set(key, edit)
      }
    }

    return { allActivities: activities, editActivities: Array.from(dedupedEdits.values()) }
  }, [messages])

  return (
    <div className="smtcmp-assistant-tool-message-group">
      {/* Activity accordion (Cursor-style) - shows before content */}
      {allActivities.length > 0 && (
        <ActivityAccordion activities={allActivities} isStreaming={isStreaming} />
      )}

      {/* Edit diff blocks for file modifications */}
      {editActivities.length > 0 && (
        <div className="smtcmp-edit-blocks">
          {editActivities.map((activity) => (
            <EditDiffBlock key={activity.id} activity={activity} />
          ))}
        </div>
      )}

      {messages.map((message) => {
        if (message.role === 'assistant') {
          // Get display content - filters out tool result summaries when we have activities
          const displayContent = getDisplayContent(
            message.content || '',
            allActivities.length > 0,
          )

          // Don't render if content is empty after filtering
          if (!message.reasoning && !message.annotations && !displayContent) {
            return null
          }

          return (
            <div key={message.id} className="smtcmp-chat-messages-assistant">
              {message.reasoning && (
                <AssistantMessageReasoning reasoning={message.reasoning} />
              )}
              {message.annotations && (
                <AssistantMessageAnnotations
                  annotations={message.annotations}
                />
              )}
              {displayContent && (
                <AssistantMessageContent
                  content={displayContent}
                  contextMessages={contextMessages}
                  handleApply={onApply}
                  isApplying={isApplying}
                />
              )}
            </div>
          )
        }

        // For tool messages, only show if we don't have activities
        // (activities replace the old ToolMessage display)
        if (allActivities.length > 0) {
          return null
        }

        return (
          <div key={message.id}>
            <ToolMessage
              message={message}
              conversationId={conversationId}
              onMessageUpdate={onToolMessageUpdate}
            />
          </div>
        )
      })}
      {messages.length > 0 && (
        <AssistantToolMessageGroupActions messages={messages} />
      )}
    </div>
  )
}

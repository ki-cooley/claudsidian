/**
 * Session Recovery
 *
 * Converts replayed agent events from a resumed session into
 * ChatMessage objects that can be saved to conversation history.
 */

import { v4 as uuidv4 } from 'uuid'
import type { ChatMessage, ActivityEvent } from '../../types/chat'
import type { SessionAgentEvent } from './protocol'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEvent = any

/**
 * Convert an array of raw agent events (from session_replay) into
 * a ChatMessage[] suitable for saving to conversation history.
 */
export function eventsToMessages(events: SessionAgentEvent[]): ChatMessage[] {
  let content = ''
  let reasoning = ''
  const activities: ActivityEvent[] = []
  const activityMap = new Map<string, ActivityEvent>()
  let toolIndex = 0

  for (const event of events) {
    const e = event as AnyEvent
    switch (event.type) {
      case 'text_delta':
        content += e.text || ''
        break

      case 'thinking':
        reasoning += e.text || ''
        break

      case 'tool_start': {
        const name: string = e.name || e.toolName || 'tool'
        const input: Record<string, unknown> = e.input || e.toolInput || {}
        const activityId = `recovered-${toolIndex++}`
        const activity: ActivityEvent = {
          id: activityId,
          type: getActivityType(name),
          status: 'running',
          startTime: Date.now(),
          toolName: name,
          toolInput: input,
          filePath: (input.path as string) || undefined,
        }
        activityMap.set(name + '-pending', activity)
        activities.push(activity)
        break
      }

      case 'tool_end': {
        const name: string = e.name || e.toolName || 'tool'
        const result: string = e.result || ''
        const pending = activityMap.get(name + '-pending')
        if (pending) {
          pending.status = 'complete'
          pending.endTime = Date.now()
          pending.toolResult = result
          activityMap.delete(name + '-pending')
        }
        break
      }

      case 'complete':
      case 'error':
        // Mark any still-running activities as complete
        for (const activity of activities) {
          if (activity.status === 'running') {
            activity.status = 'complete'
            activity.endTime = Date.now()
          }
        }
        break
    }
  }

  // Build the assistant message
  const messages: ChatMessage[] = []

  if (content || reasoning || activities.length > 0) {
    messages.push({
      role: 'assistant',
      content,
      id: uuidv4(),
      reasoning: reasoning || undefined,
      activities: activities.length > 0 ? activities : undefined,
    })
  }

  return messages
}

function getActivityType(name: string): ActivityEvent['type'] {
  const cleanName = name.replace(/^backend__/, '')
  const typeMap: Record<string, ActivityEvent['type']> = {
    vault_read: 'vault_read',
    vault_write: 'vault_write',
    vault_edit: 'vault_edit',
    vault_search: 'vault_search',
    vault_grep: 'vault_grep',
    vault_glob: 'vault_glob',
    vault_list: 'vault_list',
    vault_rename: 'vault_rename',
    vault_delete: 'vault_delete',
    search_cookbooks: 'search_cookbooks',
    list_cookbook_sources: 'list_cookbook_sources',
    web_search: 'web_search',
  }
  return typeMap[cleanName] || 'tool_call'
}

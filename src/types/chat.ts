import { SerializedEditorState } from 'lexical'

import { SelectEmbedding } from '../database/schema'

import { ChatModel } from './chat-model.types'
import { ContentPart } from './llm/request'
import { Annotation, ResponseUsage } from './llm/response'
import { Mentionable, SerializedMentionable } from './mentionable'
import { ToolCallRequest, ToolCallResponse } from './tool-call.types'

/**
 * Activity types for the Cursor-style activity accordion
 */
export type ActivityType =
  | 'thinking'
  | 'vault_read'
  | 'vault_write'
  | 'vault_edit'
  | 'vault_search'
  | 'vault_grep'
  | 'vault_glob'
  | 'vault_list'
  | 'vault_rename'
  | 'vault_delete'
  | 'web_search'
  | 'search_cookbooks'
  | 'list_cookbook_sources'
  | 'tool_call' // Generic fallback for unknown tools

export type ActivityStatus = 'running' | 'complete' | 'error'

/**
 * Represents a single activity event (tool call, thinking, etc.)
 */
export interface ActivityEvent {
  id: string
  type: ActivityType
  status: ActivityStatus
  startTime: number
  endTime?: number
  // Tool-specific fields
  toolName?: string
  toolInput?: Record<string, unknown>
  toolResult?: string
  errorMessage?: string
  // Thinking-specific
  thinkingContent?: string
  // File operation-specific
  filePath?: string
  oldPath?: string // For rename
  newPath?: string // For rename
  // Diff info for write/edit operations
  diff?: {
    additions: number
    deletions: number
    oldContent?: string
    newContent?: string
  }
  // Search results
  resultCount?: number
  results?: string[] // File paths or search results
}

export type ChatUserMessage = {
  role: 'user'
  content: SerializedEditorState | null
  promptContent: string | ContentPart[] | null
  id: string
  mentionables: Mentionable[]
  similaritySearchResults?: (Omit<SelectEmbedding, 'embedding'> & {
    similarity: number
  })[]
}
export type ChatAssistantMessage = {
  role: 'assistant'
  content: string
  reasoning?: string
  annotations?: Annotation[]
  toolCallRequests?: ToolCallRequest[]
  activities?: ActivityEvent[] // Cursor-style activity tracking
  id: string
  metadata?: {
    usage?: ResponseUsage
    model?: ChatModel // TODO: migrate legacy data to new model type
  }
}
export type ChatToolMessage = {
  role: 'tool'
  id: string
  toolCalls: {
    request: ToolCallRequest
    response: ToolCallResponse
  }[]
}

export type ChatMessage =
  | ChatUserMessage
  | ChatAssistantMessage
  | ChatToolMessage

export type AssistantToolMessageGroup = (
  | ChatAssistantMessage
  | ChatToolMessage
)[]

export type SerializedChatUserMessage = {
  role: 'user'
  content: SerializedEditorState | null
  promptContent: string | ContentPart[] | null
  id: string
  mentionables: SerializedMentionable[]
  similaritySearchResults?: (Omit<SelectEmbedding, 'embedding'> & {
    similarity: number
  })[]
}
export type SerializedChatAssistantMessage = {
  role: 'assistant'
  content: string
  reasoning?: string
  annotations?: Annotation[]
  toolCallRequests?: ToolCallRequest[]
  activities?: ActivityEvent[] // Cursor-style activity tracking
  id: string
  metadata?: {
    usage?: ResponseUsage
    model?: ChatModel // TODO: migrate legacy data to new model type
  }
}
export type SerializedChatToolMessage = {
  role: 'tool'
  toolCalls: {
    request: ToolCallRequest
    response: ToolCallResponse
  }[]
  id: string
}
export type SerializedChatMessage =
  | SerializedChatUserMessage
  | SerializedChatAssistantMessage
  | SerializedChatToolMessage

export type ChatConversation = {
  schemaVersion: number
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: SerializedChatMessage[]
}
export type ChatConversationMeta = {
  schemaVersion: number
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

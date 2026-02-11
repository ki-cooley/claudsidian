/**
 * ActivityAccordion - Cursor-style collapsible activity section
 *
 * Shows live streaming of tool calls and thinking with:
 * - Auto-expand during streaming
 * - Live elapsed time counter for running activities
 * - Collapsed summary after completion
 */

import {
  ChevronDown,
  ChevronRight,
  FileText,
  FilePlus,
  FileEdit,
  Search,
  Code,
  FolderSearch,
  Folder,
  FileSymlink,
  Trash2,
  Globe,
  Brain,
  Wrench,
  BookOpen,
  Library,
} from 'lucide-react'
import { memo, useEffect, useMemo, useState } from 'react'

import type { ActivityEvent } from '../../types/chat'

import ActivityItem from './ActivityItem'

export interface ActivityAccordionProps {
  activities: ActivityEvent[]
  isStreaming: boolean
}

/**
 * Get icon for activity type
 */
export function getActivityIcon(type: ActivityEvent['type']) {
  switch (type) {
    case 'vault_read':
      return FileText
    case 'vault_write':
      return FilePlus
    case 'vault_edit':
      return FileEdit
    case 'vault_search':
      return Search
    case 'vault_grep':
      return Code
    case 'vault_glob':
      return FolderSearch
    case 'vault_list':
      return Folder
    case 'vault_rename':
      return FileSymlink
    case 'vault_delete':
      return Trash2
    case 'web_search':
      return Globe
    case 'search_cookbooks':
      return BookOpen
    case 'list_cookbook_sources':
      return Library
    case 'thinking':
      return Brain
    case 'tool_call':
    default:
      return Wrench
  }
}

/**
 * Get display name for activity type
 */
function getActivityLabel(activity: ActivityEvent): string {
  const displayName = activity.filePath?.split('/').pop() || activity.filePath

  switch (activity.type) {
    case 'vault_read':
      return `Read [[${displayName}]]`
    case 'vault_write':
      return `Created [[${displayName}]]`
    case 'vault_edit':
      return `Edited [[${displayName}]]`
    case 'vault_search':
      return `Searched "${activity.toolInput?.query || ''}"`
    case 'vault_grep':
      return `Grep /${activity.toolInput?.pattern || ''}/`
    case 'vault_glob':
      return `Found files matching ${activity.toolInput?.pattern || ''}`
    case 'vault_list':
      return `Listed ${activity.filePath || 'folder'}/`
    case 'vault_rename':
      return `Moved ${activity.oldPath?.split('/').pop()} → ${activity.newPath?.split('/').pop()}`
    case 'vault_delete':
      return `Deleted [[${displayName}]]`
    case 'web_search':
      return `Web search: "${activity.toolInput?.query || ''}"`
    case 'search_cookbooks':
      return `Cookbook search: "${activity.toolInput?.query || ''}"`
    case 'list_cookbook_sources':
      return 'Listed cookbook sources'
    case 'thinking':
      return 'Thinking'
    case 'tool_call':
    default:
      return activity.toolName || 'Tool call'
  }
}

/**
 * Generate summary for collapsed accordion
 */
function generateSummary(activities: ActivityEvent[]): string {
  const counts = {
    files: 0,
    searches: 0,
    edits: 0,
    thinking: 0,
  }

  for (const activity of activities) {
    switch (activity.type) {
      case 'vault_read':
      case 'vault_list':
      case 'vault_glob':
        counts.files++
        break
      case 'vault_search':
      case 'vault_grep':
      case 'web_search':
      case 'search_cookbooks':
      case 'list_cookbook_sources':
        counts.searches++
        break
      case 'vault_write':
      case 'vault_edit':
      case 'vault_rename':
      case 'vault_delete':
        counts.edits++
        break
      case 'thinking':
        counts.thinking++
        break
    }
  }

  const parts: string[] = []
  if (counts.files > 0) parts.push(`${counts.files} file${counts.files > 1 ? 's' : ''}`)
  if (counts.searches > 0)
    parts.push(`${counts.searches} search${counts.searches > 1 ? 'es' : ''}`)
  if (counts.edits > 0) parts.push(`${counts.edits} edit${counts.edits > 1 ? 's' : ''}`)

  if (parts.length === 0) {
    return `${activities.length} operation${activities.length > 1 ? 's' : ''}`
  }

  return parts.join(', ')
}

const ActivityAccordion = memo(function ActivityAccordion({
  activities,
  isStreaming,
}: ActivityAccordionProps) {
  const [isOpen, setIsOpen] = useState(true)

  // Auto-expand during streaming, auto-collapse after
  useEffect(() => {
    if (isStreaming) {
      setIsOpen(true)
    } else if (activities.length > 0) {
      // Collapse after a short delay when streaming ends
      const timer = setTimeout(() => setIsOpen(false), 500)
      return () => clearTimeout(timer)
    }
  }, [isStreaming, activities.length])

  const summary = useMemo(() => generateSummary(activities), [activities])

  // Group activities: separate modify operations (edits) from exploration
  const { explorationActivities, editActivities } = useMemo(() => {
    const exploration: ActivityEvent[] = []
    const edits: ActivityEvent[] = []

    for (const activity of activities) {
      if (
        activity.type === 'vault_write' ||
        activity.type === 'vault_edit' ||
        activity.type === 'vault_rename' ||
        activity.type === 'vault_delete'
      ) {
        edits.push(activity)
      } else {
        exploration.push(activity)
      }
    }

    return { explorationActivities: exploration, editActivities: edits }
  }, [activities])

  if (activities.length === 0) {
    return null
  }

  return (
    <div className="smtcmp-activity-accordion">
      {/* Exploration section */}
      {explorationActivities.length > 0 && (
        <div className="smtcmp-activity-section">
          <div
            className="smtcmp-activity-accordion-header"
            onClick={() => setIsOpen(!isOpen)}
          >
            <span className="smtcmp-activity-accordion-icon">
              {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
            <span className="smtcmp-activity-accordion-title">
              {isStreaming ? 'Exploring...' : `Explored ${summary}`}
            </span>
          </div>

          {isOpen && (
            <div className="smtcmp-activity-accordion-content">
              {explorationActivities.map((activity) => (
                <ActivityItem
                  key={activity.id}
                  activity={activity}
                  label={getActivityLabel(activity)}
                  icon={getActivityIcon(activity.type)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
})

export default ActivityAccordion

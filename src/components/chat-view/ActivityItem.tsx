/**
 * ActivityItem - Individual activity entry in the accordion
 *
 * Shows:
 * - Icon for activity type
 * - Activity label (e.g., "Read [[file.md]]")
 * - Live timer for running activities
 * - Expandable details (params, results)
 */

import clsx from 'clsx'
import { ChevronDown, ChevronRight, LucideIcon } from 'lucide-react'
import { memo, useCallback, useEffect, useState } from 'react'

import type { ActivityEvent } from '../../types/chat'
import { useApp } from '../../contexts/app-context'

export interface ActivityItemProps {
  activity: ActivityEvent
  label: string
  icon: LucideIcon
}

/**
 * Format elapsed time as "Xs" or "Xm Xs"
 */
function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) {
    return `${seconds}s`
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}

/**
 * Clickable file link component
 */
function FileLink({ filePath, displayName }: { filePath: string; displayName?: string }) {
  const app = useApp()

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (app) {
      // Open the file in Obsidian
      const file = app.vault.getAbstractFileByPath(filePath)
      if (file) {
        app.workspace.getLeaf().openFile(file as any)
      }
    }
  }, [app, filePath])

  const name = displayName || filePath.split('/').pop() || filePath

  return (
    <span
      className="smtcmp-activity-file-link"
      onClick={handleClick}
      title={filePath}
    >
      {name}
    </span>
  )
}

const ActivityItem = memo(function ActivityItem({
  activity,
  label,
  icon: Icon,
}: ActivityItemProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  // Live timer for running activities
  useEffect(() => {
    if (activity.status === 'running') {
      const interval = setInterval(() => {
        setElapsed(Date.now() - activity.startTime)
      }, 1000)
      return () => clearInterval(interval)
    } else if (activity.endTime) {
      setElapsed(activity.endTime - activity.startTime)
    }
  }, [activity.status, activity.startTime, activity.endTime])

  // Check if this activity has expandable content
  const hasDetails =
    activity.thinkingContent ||
    (activity.results && activity.results.length > 0) ||
    activity.toolResult

  // Special handling for thinking - show timer in label
  const displayLabel =
    activity.type === 'thinking'
      ? activity.status === 'running'
        ? `Thinking for ${formatElapsed(elapsed)}...`
        : `Thought for ${formatElapsed(elapsed)}`
      : label

  // Add result count to label if available
  const labelWithCount =
    activity.resultCount !== undefined && activity.type !== 'thinking'
      ? `${displayLabel} → ${activity.resultCount} result${activity.resultCount !== 1 ? 's' : ''}`
      : displayLabel

  // Render label with clickable file link if applicable
  const renderLabel = () => {
    // For file operations, make the filename clickable
    if (activity.filePath && (
      activity.type === 'vault_read' ||
      activity.type === 'vault_write' ||
      activity.type === 'vault_edit'
    )) {
      const fileName = activity.filePath.split('/').pop() || activity.filePath
      // Replace [[filename]] pattern in label with clickable link
      const parts = labelWithCount.split(/\[\[[^\]]+\]\]/)
      if (parts.length > 1) {
        return (
          <>
            {parts[0]}
            <FileLink filePath={activity.filePath} displayName={fileName} />
            {parts.slice(1).join('')}
          </>
        )
      }
    }
    return labelWithCount
  }

  return (
    <div
      className={clsx(
        'smtcmp-activity-item',
        `smtcmp-activity-item--${activity.type}`,
        activity.status === 'running' && 'smtcmp-activity-item--running',
        activity.status === 'error' && 'smtcmp-activity-item--error',
      )}
    >
      <div
        className="smtcmp-activity-item-header"
        onClick={() => hasDetails && setIsOpen(!isOpen)}
        style={{ cursor: hasDetails ? 'pointer' : 'default' }}
      >
        <span className="smtcmp-activity-item-icon">
          {hasDetails ? (
            isOpen ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )
          ) : (
            <span style={{ width: 12, display: 'inline-block' }} />
          )}
        </span>
        <span className="smtcmp-activity-item-type-icon">
          <Icon size={14} />
        </span>
        <span className="smtcmp-activity-item-label">{renderLabel()}</span>
        {activity.status === 'running' && activity.type !== 'thinking' && (
          <span className="smtcmp-activity-item-timer">{formatElapsed(elapsed)}</span>
        )}
      </div>

      {isOpen && hasDetails && (
        <div className="smtcmp-activity-item-details">
          {/* Thinking content */}
          {activity.thinkingContent && (
            <div className="smtcmp-activity-item-thinking">
              {activity.thinkingContent}
            </div>
          )}

          {/* Search/grep results */}
          {activity.results && activity.results.length > 0 && (
            <div className="smtcmp-activity-item-results">
              {activity.results.slice(0, 10).map((result, index) => (
                <div key={index} className="smtcmp-activity-item-result">
                  {/* Format as clickable file link if it looks like a file path */}
                  {result.includes('/') || result.endsWith('.md') ? (
                    <FileLink filePath={result} />
                  ) : (
                    <span>{result}</span>
                  )}
                </div>
              ))}
              {activity.results.length > 10 && (
                <div className="smtcmp-activity-item-more">
                  +{activity.results.length - 10} more
                </div>
              )}
            </div>
          )}

          {/* Raw tool result for generic tool calls */}
          {activity.toolResult &&
            !activity.thinkingContent &&
            !activity.results && (
              <div className="smtcmp-activity-item-raw">
                <pre>{activity.toolResult.slice(0, 500)}</pre>
                {activity.toolResult.length > 500 && (
                  <span className="smtcmp-activity-item-more">
                    ... ({activity.toolResult.length - 500} more chars)
                  </span>
                )}
              </div>
            )}
        </div>
      )}
    </div>
  )
})

export default ActivityItem

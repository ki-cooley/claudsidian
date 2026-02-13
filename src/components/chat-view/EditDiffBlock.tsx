/**
 * EditDiffBlock - Live streaming diff with revert button
 *
 * Shows:
 * - File header with +X -Y line count
 * - Diff content with green/red highlighting
 * - Undo button for revert
 */

import { ChevronDown, ChevronRight, Eye, Undo2 } from 'lucide-react'
import { memo, useCallback, useState } from 'react'
import { TFile } from 'obsidian'

import type { ActivityEvent } from '../../types/chat'
import { getEditHistory } from '../../core/backend/EditHistory'
import { useApp } from '../../contexts/app-context'
import { ObsidianMarkdown } from './ObsidianMarkdown'

export interface EditDiffBlockProps {
  activity: ActivityEvent
  onReverted?: () => void
}

/**
 * Simple diff display - shows old (red) and new (green) content
 */
function DiffContent({
  oldContent,
  newContent,
}: {
  oldContent?: string
  newContent?: string
}) {
  // If we have both old and new content, show a simple diff
  if (oldContent && newContent) {
    return (
      <div className="smtcmp-diff-content">
        <div className="smtcmp-diff-deletion">
          <span className="smtcmp-diff-marker">-</span>
          <pre>{oldContent}</pre>
        </div>
        <div className="smtcmp-diff-addition">
          <span className="smtcmp-diff-marker">+</span>
          <pre>{newContent}</pre>
        </div>
      </div>
    )
  }

  // If only new content (write operation), show all as additions
  if (newContent) {
    const lines = newContent.split('\n').slice(0, 20) // Limit displayed lines
    const hasMore = newContent.split('\n').length > 20
    return (
      <div className="smtcmp-diff-content">
        {lines.map((line, i) => (
          <div key={i} className="smtcmp-diff-addition">
            <span className="smtcmp-diff-marker">+</span>
            <pre>{line || ' '}</pre>
          </div>
        ))}
        {hasMore && (
          <div className="smtcmp-diff-more">
            +{newContent.split('\n').length - 20} more lines
          </div>
        )}
      </div>
    )
  }

  // If only old content (delete operation), show all as deletions
  if (oldContent) {
    const lines = oldContent.split('\n').slice(0, 20)
    const hasMore = oldContent.split('\n').length > 20
    return (
      <div className="smtcmp-diff-content">
        {lines.map((line, i) => (
          <div key={i} className="smtcmp-diff-deletion">
            <span className="smtcmp-diff-marker">-</span>
            <pre>{line || ' '}</pre>
          </div>
        ))}
        {hasMore && (
          <div className="smtcmp-diff-more">
            +{oldContent.split('\n').length - 20} more lines
          </div>
        )}
      </div>
    )
  }

  return null
}

const EditDiffBlock = memo(function EditDiffBlock({
  activity,
  onReverted,
}: EditDiffBlockProps) {
  const app = useApp()
  const [isOpen, setIsOpen] = useState(true)
  const [isPreviewMode, setIsPreviewMode] = useState(true)
  const [isReverting, setIsReverting] = useState(false)
  const [reverted, setReverted] = useState(false)

  const handleOpenFile = useCallback(() => {
    if (!app || !activity.filePath) return
    const file = app.vault.getAbstractFileByPath(activity.filePath)
    if (file instanceof TFile) {
      app.workspace.openLinkText(activity.filePath, '', false)
    }
  }, [app, activity.filePath])

  const handleRevert = useCallback(async () => {
    if (!app || isReverting || reverted) return

    setIsReverting(true)
    try {
      const editHistory = getEditHistory(app)
      const success = await editHistory.revertByActivityId(activity.id)
      if (success) {
        setReverted(true)
        onReverted?.()
      }
    } catch (error) {
      console.error('[EditDiffBlock] Failed to revert:', error)
    } finally {
      setIsReverting(false)
    }
  }, [app, activity.id, isReverting, reverted, onReverted])

  // Get display name
  const displayName = activity.filePath?.split('/').pop() || activity.filePath || 'file'

  // Get diff stats
  const additions = activity.diff?.additions || 0
  const deletions = activity.diff?.deletions || 0

  // Determine operation type for display
  let operationLabel = ''
  switch (activity.type) {
    case 'vault_write':
      operationLabel = 'Created'
      break
    case 'vault_edit':
      operationLabel = 'Edited'
      break
    case 'vault_rename':
      operationLabel = 'Renamed'
      break
    case 'vault_delete':
      operationLabel = 'Deleted'
      break
    default:
      operationLabel = 'Modified'
  }

  return (
    <div className="smtcmp-edit-diff">
      <div className="smtcmp-edit-diff-header" onClick={() => setIsOpen(!isOpen)}>
        <span className="smtcmp-edit-diff-toggle">
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="smtcmp-edit-diff-filename">
          {operationLabel}{' '}
          <a
            className="smtcmp-activity-file-link"
            onClick={(e) => {
              e.stopPropagation()
              handleOpenFile()
            }}
            title={activity.filePath}
          >
            [[{displayName}]]
          </a>
        </span>
        <span className="smtcmp-edit-diff-stats">
          {additions > 0 && <span className="smtcmp-diff-stat-add">+{additions}</span>}
          {deletions > 0 && <span className="smtcmp-diff-stat-del">-{deletions}</span>}
        </span>
        <div className="smtcmp-edit-diff-actions">
          <button
            className="clickable-icon smtcmp-edit-diff-view-toggle"
            onClick={(e) => {
              e.stopPropagation()
              setIsPreviewMode(!isPreviewMode)
            }}
            title={isPreviewMode ? 'View raw diff' : 'View rendered'}
          >
            <Eye size={12} />
            {isPreviewMode ? 'Raw' : 'Rendered'}
          </button>
          {!reverted && (
            <button
              className="smtcmp-edit-diff-revert"
              onClick={(e) => {
                e.stopPropagation()
                handleRevert()
              }}
              disabled={isReverting}
              title="Undo this change"
            >
              <Undo2 size={14} />
              {isReverting ? 'Undoing...' : 'Undo'}
            </button>
          )}
          {reverted && (
            <span className="smtcmp-edit-diff-reverted">Reverted</span>
          )}
        </div>
      </div>

      {isOpen && activity.diff && (
        <div className="smtcmp-edit-diff-body">
          {isPreviewMode ? (
            <div className="smtcmp-edit-diff-rendered">
              <ObsidianMarkdown
                content={activity.diff.newContent || activity.diff.oldContent || ''}
                scale="sm"
              />
            </div>
          ) : (
            <DiffContent
              oldContent={activity.diff.oldContent}
              newContent={activity.diff.newContent}
            />
          )}
        </div>
      )}
    </div>
  )
})

export default EditDiffBlock

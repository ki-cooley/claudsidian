import { Check, ChevronDown, ChevronUp, CopyIcon, Eye, Loader2, Play } from 'lucide-react'
import { PropsWithChildren, useMemo, useState } from 'react'

import { useApp } from '../../contexts/app-context'
import { useDarkModeContext } from '../../contexts/dark-mode-context'
import { openMarkdownFile } from '../../utils/obsidian'

import { ObsidianMarkdown } from './ObsidianMarkdown'
import { MemoizedSyntaxHighlighterWrapper } from './SyntaxHighlighterWrapper'

// Max lines to show before truncating
const MAX_LINES_COLLAPSED = 15

export default function MarkdownCodeComponent({
  onApply,
  isApplying,
  language,
  filename,
  children,
}: PropsWithChildren<{
  onApply: (blockToApply: string) => void
  isApplying: boolean
  language?: string
  filename?: string
}>) {
  const app = useApp()
  const { isDarkMode } = useDarkModeContext()

  const [isPreviewMode, setIsPreviewMode] = useState(true)
  const [copied, setCopied] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)

  const wrapLines = useMemo(() => {
    return !language || ['markdown'].includes(language)
  }, [language])

  const fullContent = String(children)
  const lines = fullContent.split('\n')
  const totalLines = lines.length
  const shouldTruncate = totalLines > MAX_LINES_COLLAPSED

  const displayContent = useMemo(() => {
    if (!shouldTruncate || isExpanded) {
      return fullContent
    }
    return lines.slice(0, MAX_LINES_COLLAPSED).join('\n')
  }, [fullContent, lines, shouldTruncate, isExpanded])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(String(children))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy text: ', err)
    }
  }

  const handleOpenFile = () => {
    if (filename) {
      openMarkdownFile(app, filename)
    }
  }

  return (
    <div className="smtcmp-code-block">
      <div className="smtcmp-code-block-header">
        {filename && (
          <div
            className="smtcmp-code-block-header-filename"
            onClick={handleOpenFile}
          >
            {filename}
          </div>
        )}
        <div className="smtcmp-code-block-header-button-container">
          <button
            className="clickable-icon smtcmp-code-block-header-button"
            onClick={() => {
              setIsPreviewMode(!isPreviewMode)
            }}
          >
            <Eye size={12} />
            {isPreviewMode ? 'View Raw Text' : 'View Formatted'}
          </button>
          <button
            className="clickable-icon smtcmp-code-block-header-button"
            onClick={() => {
              handleCopy()
            }}
          >
            {copied ? (
              <>
                <Check size={10} />
                <span>Copied</span>
              </>
            ) : (
              <>
                <CopyIcon size={10} />
                <span>Copy</span>
              </>
            )}
          </button>
          <button
            className="clickable-icon smtcmp-code-block-header-button"
            onClick={
              isApplying
                ? undefined
                : () => {
                    onApply(String(children))
                  }
            }
            aria-disabled={isApplying}
          >
            {isApplying ? (
              <>
                <Loader2 className="spinner" size={14} />
                <span>Applying...</span>
              </>
            ) : (
              <>
                <Play size={10} />
                <span>Apply</span>
              </>
            )}
          </button>
        </div>
      </div>
      {isPreviewMode ? (
        <div className="smtcmp-code-block-obsidian-markdown">
          <ObsidianMarkdown content={displayContent} scale="sm" />
        </div>
      ) : (
        <MemoizedSyntaxHighlighterWrapper
          isDarkMode={isDarkMode}
          language={language}
          hasFilename={!!filename}
          wrapLines={wrapLines}
        >
          {displayContent}
        </MemoizedSyntaxHighlighterWrapper>
      )}
      {shouldTruncate && (
        <button
          className="smtcmp-code-block-expand-button"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? (
            <>
              <ChevronUp size={12} />
              <span>Show less</span>
            </>
          ) : (
            <>
              <ChevronDown size={12} />
              <span>Show {totalLines - MAX_LINES_COLLAPSED} more lines</span>
            </>
          )}
        </button>
      )}
    </div>
  )
}

import { ChevronDown, ChevronUp } from 'lucide-react'
import { memo, useEffect, useRef, useState } from 'react'

import DotLoader from '../common/DotLoader'

import { ObsidianMarkdown } from './ObsidianMarkdown'

const AssistantMessageReasoning = memo(function AssistantMessageReasoning({
  reasoning,
  isStreaming = false,
}: {
  reasoning: string
  isStreaming?: boolean
}) {
  // Start expanded so thinking is visible immediately (like Claude.ai)
  const [isExpanded, setIsExpanded] = useState(true)
  const [showLoader, setShowLoader] = useState(false)
  const previousReasoning = useRef(reasoning)
  const hasUserInteracted = useRef(false)

  useEffect(() => {
    if (previousReasoning.current !== reasoning) {
      setShowLoader(true)
      if (!hasUserInteracted.current) {
        setIsExpanded(true)
      }
      const timer = setTimeout(() => {
        setShowLoader(false)
      }, 1000)
      previousReasoning.current = reasoning
      return () => clearTimeout(timer)
    }
  }, [reasoning])

  // Auto-collapse when streaming ends (after a short delay)
  useEffect(() => {
    if (!isStreaming && reasoning && !hasUserInteracted.current) {
      const timer = setTimeout(() => {
        if (!hasUserInteracted.current) {
          setIsExpanded(false)
        }
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [isStreaming, reasoning])

  const handleToggle = () => {
    hasUserInteracted.current = true
    setIsExpanded(!isExpanded)
  }

  return (
    <div className="smtcmp-assistant-message-metadata">
      <div
        className="smtcmp-assistant-message-metadata-toggle"
        onClick={handleToggle}
      >
        <span>Reasoning {showLoader && <DotLoader />}</span>
        {isExpanded ? (
          <ChevronUp className="smtcmp-assistant-message-metadata-toggle-icon" />
        ) : (
          <ChevronDown className="smtcmp-assistant-message-metadata-toggle-icon" />
        )}
      </div>
      {isExpanded && (
        <div className="smtcmp-assistant-message-metadata-content">
          <ObsidianMarkdown content={reasoning} scale="xs" />
        </div>
      )}
    </div>
  )
})

export default AssistantMessageReasoning

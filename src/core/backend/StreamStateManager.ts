import { ChatMessage } from '../../types/chat'
import { ResponseGenerator } from '../../utils/chat/responseGenerator'

interface ActiveStreamState {
  conversationId: string
  baseMessages: ChatMessage[]
  responseMessages: ChatMessage[]
  responseGenerator: ResponseGenerator
  isComplete: boolean
  unsubscribe?: () => void
}

/**
 * Plugin-level manager that takes ownership of active streams when the
 * chat sidebar closes, then hands them back when it reopens.
 *
 * Supports multiple simultaneous streams (one per conversation).
 */
export class StreamStateManager {
  private activeStreams = new Map<string, ActiveStreamState>()

  /**
   * Called when the sidebar closes while a stream is still running.
   * Subscribes to the ResponseGenerator to keep accumulating messages.
   */
  detachStream(
    conversationId: string,
    baseMessages: ChatMessage[],
    responseGenerator: ResponseGenerator,
    currentResponseMessages: ChatMessage[],
  ): void {
    // Clean up any previous stream for this conversation
    this.cleanupStream(conversationId)

    const state: ActiveStreamState = {
      conversationId,
      baseMessages,
      responseMessages: [...currentResponseMessages],
      responseGenerator,
      isComplete: false,
    }

    // Subscribe to keep accumulating response messages
    state.unsubscribe = responseGenerator.subscribe((responseMessages) => {
      state.responseMessages = responseMessages
    })

    this.activeStreams.set(conversationId, state)
  }

  /**
   * Called when the sidebar reopens. Returns the saved state for
   * rehydration and clears the manager's reference.
   */
  attachStream(
    conversationId: string,
  ): {
    baseMessages: ChatMessage[]
    responseMessages: ChatMessage[]
    responseGenerator: ResponseGenerator
    isComplete: boolean
  } | null {
    const state = this.activeStreams.get(conversationId)
    if (!state) return null

    // Unsubscribe our listener — the React component will re-subscribe
    if (state.unsubscribe) {
      state.unsubscribe()
      state.unsubscribe = undefined
    }

    const result = {
      baseMessages: state.baseMessages,
      responseMessages: state.responseMessages,
      responseGenerator: state.responseGenerator,
      isComplete: state.isComplete,
    }

    this.activeStreams.delete(conversationId)
    return result
  }

  /**
   * Called from the mutation's finally block when the stream completes.
   */
  markComplete(conversationId: string): void {
    const state = this.activeStreams.get(conversationId)
    if (state) {
      state.isComplete = true
    }
  }

  hasActiveStream(conversationId: string): boolean {
    return this.activeStreams.has(conversationId)
  }

  private cleanupStream(conversationId: string): void {
    const state = this.activeStreams.get(conversationId)
    if (state) {
      if (state.unsubscribe) {
        state.unsubscribe()
      }
      this.activeStreams.delete(conversationId)
    }
  }

  cleanup(): void {
    for (const [id] of this.activeStreams) {
      this.cleanupStream(id)
    }
  }
}

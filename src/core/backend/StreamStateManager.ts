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
 * Holds at most one active stream at a time.
 */
export class StreamStateManager {
  private activeStream: ActiveStreamState | null = null

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
    // Clean up any previous detached stream
    this.cleanup()

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

    this.activeStream = state
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
    if (
      !this.activeStream ||
      this.activeStream.conversationId !== conversationId
    ) {
      return null
    }

    const state = this.activeStream

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

    this.activeStream = null
    return result
  }

  /**
   * Called from the mutation's finally block when the stream completes.
   * If we're holding a detached stream for this conversation, mark it
   * complete so the next attach knows not to re-subscribe.
   */
  markComplete(conversationId: string): void {
    if (
      this.activeStream &&
      this.activeStream.conversationId === conversationId
    ) {
      this.activeStream.isComplete = true
    }
  }

  hasActiveStream(conversationId: string): boolean {
    return (
      this.activeStream !== null &&
      this.activeStream.conversationId === conversationId
    )
  }

  cleanup(): void {
    if (this.activeStream) {
      if (this.activeStream.unsubscribe) {
        this.activeStream.unsubscribe()
      }
      this.activeStream = null
    }
  }
}

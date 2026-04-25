import { SerializedEditorState } from 'lexical'

import { ChatUserMessage } from '../../types/chat'
import { Mentionable } from '../../types/mentionable'

import ChatUserInput, { ChatUserInputRef } from './chat-input/ChatUserInput'
import SimilaritySearchResults from './SimilaritySearchResults'

export type UserMessageItemProps = {
  message: ChatUserMessage
  chatUserInputRef: (ref: ChatUserInputRef | null) => void
  onInputChange: (content: SerializedEditorState) => void
  onSubmit: (content: SerializedEditorState, useVaultSearch: boolean) => void
  onFocus: () => void
  onMentionablesChange: (mentionables: Mentionable[]) => void
}

export default function UserMessageItem({
  message,
  chatUserInputRef,
  onInputChange,
  onSubmit,
  onFocus,
  onMentionablesChange,
}: UserMessageItemProps) {
  const className =
    'smtcmp-chat-messages-user' + (message.isAside ? ' smtcmp-chat-messages-user-aside' : '')
  return (
    <div className={className}>
      {message.isAside && (
        <div className="smtcmp-chat-message-aside-label" aria-label="aside (injected mid-turn)">
          aside
        </div>
      )}
      <ChatUserInput
        ref={chatUserInputRef}
        initialSerializedEditorState={message.content}
        onChange={onInputChange}
        onSubmit={onSubmit}
        onFocus={onFocus}
        mentionables={message.mentionables}
        setMentionables={onMentionablesChange}
      />
      {message.similaritySearchResults && (
        <SimilaritySearchResults
          similaritySearchResults={message.similaritySearchResults}
        />
      )}
    </div>
  )
}

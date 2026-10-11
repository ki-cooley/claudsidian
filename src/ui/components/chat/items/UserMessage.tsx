/**
 * A message from the person: a right-aligned bubble. The "[Obsidian context]" tail an echoed
 * message carries folds behind a small toggle so the bubble reads as what was typed.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { UserItem } from '../../../../core/types';
import { Icon } from '../../common/Icon';

const CONTEXT_MARKER = '\n\n[Obsidian context]\n';

export function splitContext(text: string): { body: string; context: string | null } {
  const i = text.indexOf(CONTEXT_MARKER);
  if (i < 0) {
    return text.startsWith('[Obsidian context]\n') ? { body: '', context: text } : { body: text, context: null };
  }
  return { body: text.slice(0, i), context: text.slice(i + 2) };
}

export function UserMessage(p: { item: UserItem }): JSX.Element {
  const [showContext, setShowContext] = useState(false);
  const { body, context } = splitContext(p.item.text);
  const images = p.item.imageCount;
  return (
    <div class={`claudsidian-user ${p.item.synthetic ? 'is-synthetic' : ''}`}>
      <div class="claudsidian-user-bubble">
        {body ? <div class="claudsidian-user-text">{body}</div> : null}
        {images > 0 || context ? (
          <div class="claudsidian-user-meta">
            {images > 0 ? (
              <span class="claudsidian-badge">
                <Icon name="image" size="small" />
                {images === 1 ? '1 image' : `${images} images`}
              </span>
            ) : null}
            {context ? (
              <button type="button" class="claudsidian-badge is-button" aria-expanded={showContext ? 'true' : 'false'} onClick={() => setShowContext((v) => !v)}>
                <Icon name="file-text" size="small" />
                {showContext ? 'Hide context' : 'With context'}
              </button>
            ) : null}
          </div>
        ) : null}
        {context && showContext ? <pre class="claudsidian-user-context">{context}</pre> : null}
      </div>
    </div>
  );
}

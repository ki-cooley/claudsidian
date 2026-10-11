/** Claude's thinking, folded behind a muted "Thinking" toggle; the transcript hides it entirely when the setting is off. */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { ThinkingItem } from '../../../../core/types';
import { Icon } from '../../common/Icon';

export function ThinkingBlock(p: { item: ThinkingItem }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div class={`claudsidian-thinking ${p.item.partial ? 'is-partial' : ''}`}>
      <button type="button" class="claudsidian-thinking-toggle" aria-expanded={open ? 'true' : 'false'} onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size="small" />
        <span>Thinking</span>
      </button>
      {open ? <div class="claudsidian-thinking-body">{p.item.text}</div> : null}
    </div>
  );
}

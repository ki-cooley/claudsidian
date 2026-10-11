/** Cooking mode's one-tap replies, a scrollable row of big buttons above the keyboard. */
import type { JSX } from 'preact';

export interface QuickRepliesProps {
  replies: string[];
  onPick: (text: string) => void;
  disabled?: boolean;
}

export function QuickReplies(p: QuickRepliesProps): JSX.Element | null {
  if (p.replies.length === 0) return null;
  return (
    <div class="claudsidian-quick" role="group" aria-label="Quick replies">
      {p.replies.map((text) => (
        <button type="button" key={text} class="claudsidian-quick-btn" disabled={p.disabled} onClick={() => p.onPick(text)}>
          {text}
        </button>
      ))}
    </div>
  );
}

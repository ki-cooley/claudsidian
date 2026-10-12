/**
 * Cooking mode's one-tap replies: big buttons above the keyboard. ChatScreen shows the bar only
 * while the session is idle or waiting on a question or permission, never mid-turn. "stop" is not
 * a message: it interrupts the session (onStop) and sits last, styled like the composer's Stop.
 */
import type { JSX } from 'preact';
import { useId } from 'preact/hooks';
import { Icon } from '../common/Icon';

export interface QuickRepliesProps {
  replies: string[];
  onPick: (text: string) => void;
  onStop: () => void;
  disabled?: boolean;
}

export function isStopReply(text: string): boolean {
  return text.trim().toLowerCase() === 'stop';
}

/** The replies in their configured order with any "stop" moved to the end. */
export function orderReplies(replies: string[]): string[] {
  const seen = new Set<string>();
  const plain: string[] = [];
  const stops: string[] = [];
  for (const raw of replies) {
    const text = raw.trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    (isStopReply(text) ? stops : plain).push(text);
  }
  return [...plain, ...stops];
}

export function QuickReplies(p: QuickRepliesProps): JSX.Element | null {
  const labelId = useId();
  const replies = orderReplies(p.replies);
  if (replies.length === 0) return null;
  return (
    <div class="claudsidian-quick" role="group" aria-labelledby={labelId}>
      <span id={labelId} class="claudsidian-sr-only">
        Quick replies
      </span>
      {replies.map((text) =>
        isStopReply(text) ? (
          <button type="button" key={text} class="claudsidian-quick-btn is-stop" disabled={p.disabled} onClick={p.onStop}>
            <Icon name="square" size="small" />
            <span>{text}</span>
          </button>
        ) : (
          <button type="button" key={text} class="claudsidian-quick-btn" disabled={p.disabled} onClick={() => p.onPick(text)}>
            {text}
          </button>
        ),
      )}
    </div>
  );
}

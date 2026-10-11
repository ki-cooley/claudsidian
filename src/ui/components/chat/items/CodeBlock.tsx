/**
 * Monospace text with a fold: at most `maxLines` lines or `maxChars` characters until the reader
 * asks for the rest. Tool inputs and results are untrusted strings, rendered as text only.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

export interface CodeBlockProps {
  text: string;
  maxLines?: number;
  maxChars?: number;
  class?: string;
  /** label for the fold button, "Show more" by default */
  moreLabel?: string;
}

export function foldText(text: string, maxLines: number | undefined, maxChars: number | undefined): { shown: string; hidden: boolean; rest: string } {
  let shown = text;
  if (maxChars !== undefined && shown.length > maxChars) shown = shown.slice(0, maxChars);
  if (maxLines !== undefined) {
    const lines = shown.split('\n');
    if (lines.length > maxLines) shown = lines.slice(0, maxLines).join('\n');
  }
  const hidden = shown.length < text.length;
  const restLines = hidden ? text.slice(shown.length).split('\n').filter((l) => l.length > 0).length : 0;
  return { shown, hidden, rest: hidden ? `${restLines} more line${restLines === 1 ? '' : 's'}` : '' };
}

export function CodeBlock(p: CodeBlockProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const fold = open ? { shown: p.text, hidden: false, rest: '' } : foldText(p.text, p.maxLines, p.maxChars);
  return (
    <div class={['claudsidian-codeblock', p.class ?? ''].filter(Boolean).join(' ')}>
      <pre class="claudsidian-code">
        <code>{fold.shown}</code>
      </pre>
      {fold.hidden ? (
        <button type="button" class="claudsidian-link-btn" onClick={() => setOpen(true)}>
          {p.moreLabel ?? 'Show more'} ({fold.rest})
        </button>
      ) : null}
    </div>
  );
}

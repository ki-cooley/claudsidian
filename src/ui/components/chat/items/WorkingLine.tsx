/**
 * The inline working indicator under the last item while a turn runs: three dots, and the
 * running tool's label ("Reading prep-rd-2026-10-18.md", "Running bash") when there is one.
 * The dots stop under prefers-reduced-motion (chat.css).
 */
import type { JSX } from 'preact';

export function WorkingLine(p: { label?: string }): JSX.Element {
  return (
    <div class="claudsidian-working" role="status">
      <span class="claudsidian-working-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {p.label ? <span class="claudsidian-working-text">{p.label}</span> : <span class="claudsidian-sr-text">Working</span>}
    </div>
  );
}

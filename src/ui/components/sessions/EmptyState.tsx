/** What the list shows when there is nothing to list: no sessions at all, or only archived ones hidden. */
import type { JSX } from 'preact';
import { Button } from './primitives';

export interface EmptyStateProps {
  variant: 'none' | 'all-archived';
  onNew: () => void;
  onShowArchived: () => void;
}

export function EmptyState(p: EmptyStateProps): JSX.Element {
  if (p.variant === 'all-archived') {
    return (
      <div class="claudsidian-empty-state">
        <p class="claudsidian-empty-title">Every session is archived.</p>
        <div class="claudsidian-empty-actions">
          <Button label="Show archived" onClick={p.onShowArchived} />
          <Button primary icon="plus" label="New session" onClick={p.onNew} />
        </div>
      </div>
    );
  }
  return (
    <div class="claudsidian-empty-state">
      <p class="claudsidian-empty-title">No sessions yet.</p>
      <p class="claudsidian-empty-text">Start one here, or run claude on the Mac and it shows up in this list.</p>
      <div class="claudsidian-empty-actions">
        <Button primary icon="plus" label="New session" onClick={p.onNew} />
      </div>
    </div>
  );
}

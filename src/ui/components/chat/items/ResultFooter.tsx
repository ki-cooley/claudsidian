/** The end of a turn: duration, cost when the setting is on, and the errors a failed turn reported. */
import type { JSX } from 'preact';
import type { ResultItem } from '../../../../core/types';
import { Icon } from '../../common/Icon';

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export function formatCost(usd: number | undefined): string {
  if (usd === undefined || !Number.isFinite(usd)) return '';
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return 'under $0.01';
  return `$${usd.toFixed(2)}`;
}

const SUBTYPE_TEXT: Record<string, string> = {
  error_max_turns: 'Stopped: turn limit reached',
  error_during_execution: 'Stopped: error during execution',
  error_max_budget_usd: 'Stopped: budget reached',
};

export function ResultFooter(p: { item: ResultItem; showCosts: boolean }): JSX.Element | null {
  const { item } = p;
  // A local command (/cost, /effort) does not end a turn; its output already shows as a system line.
  if (item.localCommand !== undefined && item.errors.length === 0 && !item.isError) return null;
  const parts: string[] = [];
  const duration = formatDuration(item.durationMs);
  if (duration) parts.push(duration);
  if (p.showCosts) {
    const cost = formatCost(item.costUsd);
    if (cost) parts.push(cost);
  }
  if (item.numTurns !== undefined && item.numTurns > 1) parts.push(`${item.numTurns} turns`);
  const headline = item.isError ? (SUBTYPE_TEXT[item.subtype] ?? `Stopped: ${item.subtype.replace(/^error_/, '').replace(/_/g, ' ')}`) : '';
  return (
    <div class={`claudsidian-result ${item.isError ? 'is-error' : ''}`}>
      <span class="claudsidian-result-rule" aria-hidden="true" />
      <span class="claudsidian-result-text">
        {item.isError ? <Icon name="alert-triangle" size="small" /> : null}
        {headline ? <span class="claudsidian-result-headline">{headline}</span> : null}
        {parts.length > 0 ? <span class="claudsidian-result-stats">{parts.join(', ')}</span> : null}
      </span>
      <span class="claudsidian-result-rule" aria-hidden="true" />
      {item.errors.length > 0 ? (
        <ul class="claudsidian-result-errors">
          {item.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

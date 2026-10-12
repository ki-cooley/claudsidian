/**
 * The end of a turn. A normal turn renders nothing (the reply is its own full stop); with the
 * costs setting on, one muted right-aligned line with duration and cost. A failed turn keeps
 * its headline and the errors it reported. An unknown or zero duration is never shown.
 */
import type { JSX } from 'preact';
import type { ResultItem } from '../../../../core/types';
import { Icon } from '../../common/Icon';

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return '';
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
  const failed = item.isError || item.errors.length > 0;
  // A local command (/cost, /effort) does not end a turn; its output already shows as a system line.
  if (item.localCommand !== undefined && !failed) return null;
  const parts: string[] = [];
  const duration = formatDuration(item.durationMs);
  if (duration) parts.push(duration);
  if (p.showCosts) {
    const cost = formatCost(item.costUsd);
    if (cost) parts.push(cost);
  }
  if (!failed) {
    if (!p.showCosts || parts.length === 0) return null;
    return (
      <div class="claudsidian-result is-stats">
        <span class="claudsidian-result-stats">{parts.join(', ')}</span>
      </div>
    );
  }
  if (item.numTurns !== undefined && item.numTurns > 1) parts.push(`${item.numTurns} turns`);
  const headline = item.isError ? (SUBTYPE_TEXT[item.subtype] ?? `Stopped: ${item.subtype.replace(/^error_/, '').replace(/_/g, ' ')}`) : 'Turn ended with errors';
  return (
    <div class="claudsidian-result is-error">
      <span class="claudsidian-result-text">
        <Icon name="alert-triangle" size="small" />
        <span class="claudsidian-result-headline">{headline}</span>
        {parts.length > 0 ? <span class="claudsidian-result-stats">{parts.join(', ')}</span> : null}
      </span>
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

/** Session row status: one of four dot states derived from a SessionSummary, plus its label and summary line. */
import type { SessionSummary } from '../../../core/types';

export type SessionStatus = 'working' | 'needs_you' | 'idle' | 'offline';

export const STATUS_LABEL: Record<SessionStatus, string> = {
  working: 'Working',
  needs_you: 'Needs you',
  idle: 'Idle',
  offline: 'Offline',
};

export function statusOf(s: SessionSummary): SessionStatus {
  if (s.connectionStatus !== 'connected') return 'offline';
  if (s.workerStatus === 'requires_action' || (s.summary?.needsAction ?? '').trim() !== '') return 'needs_you';
  if (s.workerStatus === 'running') return 'working';
  return 'idle';
}

/** The one-line summary under a title: what Claude needs first, then what it is doing or last did. */
export function summaryLine(s: SessionSummary): string {
  const sum = s.summary;
  if (!sum) return '';
  for (const text of [sum.needsAction, sum.detail, sum.recentAction]) {
    const t = (text ?? '').trim();
    if (t) return t;
  }
  return '';
}

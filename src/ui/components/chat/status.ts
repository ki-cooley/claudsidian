/** The header's status pill: one label and tone from the transcript turn and the session's connection. */
import type { SessionSummary, TurnState } from '../../../core/types';

export type StatusTone = 'working' | 'needs' | 'idle' | 'offline' | 'error';

export interface StatusInfo {
  label: string;
  tone: StatusTone;
  /** true while the worker is busy: the pill shows its pulse */
  busy: boolean;
}

/**
 * Connection first: a host that is not connected cannot act whatever the transcript says. An
 * unknown connection status (missing on the wire) is not treated as offline.
 */
export function sessionStatus(turn: TurnState, session: SessionSummary | undefined): StatusInfo {
  const connection = session?.connectionStatus;
  if (connection && connection !== 'connected' && connection !== 'unknown') {
    if (connection === 'connecting') return { label: 'Connecting', tone: 'offline', busy: true };
    return { label: session?.environmentKind === 'cloud' ? 'Offline' : 'Mac offline', tone: 'offline', busy: false };
  }
  switch (turn) {
    case 'offline':
      return { label: 'No connection', tone: 'offline', busy: false };
    case 'needs_input':
      return { label: 'Needs you', tone: 'needs', busy: false };
    case 'working':
    case 'sending':
      return { label: 'Working', tone: 'working', busy: true };
    case 'error':
      return { label: 'Error', tone: 'error', busy: false };
    default:
      return { label: 'Idle', tone: 'idle', busy: false };
  }
}

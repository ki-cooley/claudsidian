/**
 * The header's status pill (one label and tone from the transcript turn and the session's
 * connection) and the friendly labels for the model and permission-mode chips.
 */
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

const MODEL_FAMILY: Record<string, string> = {
  fable: 'Fable',
  opus: 'Opus',
  sonnet: 'Sonnet',
  haiku: 'Haiku',
};

/**
 * "claude-opus-5-5" reads "Opus 5.5", "claude-fable-5-1" "Fable 5.1", "claude-3-5-sonnet-20241022"
 * "Sonnet 3.5" (date suffixes and vendor prefixes dropped). An id with no known family keeps its
 * tail after "claude-" so a custom model still reads as itself.
 */
export function modelLabel(id: string | undefined): string {
  if (!id) return '';
  const tail = /^(?:[\w.-]*\.)?claude-(.+)$/.exec(id)?.[1] ?? id;
  const parts = tail.split('-').filter(Boolean);
  const family = parts.map((p) => MODEL_FAMILY[p.toLowerCase()]).find((f): f is string => f !== undefined);
  if (!family) return tail;
  const version = parts
    .filter((p) => /^\d{1,2}$/.test(p))
    .slice(0, 2)
    .join('.');
  return version ? `${family} ${version}` : family;
}

const MODE_LABEL: Record<string, string> = {
  default: 'Ask',
  acceptEdits: 'Accept edits',
  plan: 'Plan',
  auto: 'Auto',
  bypassPermissions: 'Bypass',
  dontAsk: "Don't ask",
};

/** "acceptEdits" reads "Accept edits"; an unknown mode keeps its id. */
export function permissionModeLabel(mode: string | undefined): string {
  if (!mode) return '';
  return MODE_LABEL[mode] ?? mode;
}

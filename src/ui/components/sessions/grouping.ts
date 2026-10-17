/** Groups the session list into "This vault", "Other local", "Cloud" and "Archived", each sorted for triage. */
import type { Environment } from '../../../core/store-api';
import type { SessionSummary } from '../../../core/types';
import { statusOf } from './status';

/** The part of an Environment the grouping consults for sessions whose init cwd is unknown. */
export type EnvironmentHint = Pick<Environment, 'id' | 'label' | 'cwd'>;

export interface SessionGroupData {
  title: string;
  sessions: SessionSummary[];
}

export const GROUP_TITLES = {
  vault: 'This vault',
  local: 'Other local',
  cloud: 'Cloud',
  archived: 'Archived',
} as const;

function stripTrailingSlash(p: string): string {
  return p.replace(/\/+$/, '');
}

/** True when cwd is root itself or inside it (segment-aware, so "/vault-archive" is not under "/vault"). */
export function isUnderPath(cwd: string, root: string): boolean {
  const r = stripTrailingSlash(root);
  if (!r) return false;
  const c = stripTrailingSlash(cwd);
  return c === r || c.startsWith(r + '/');
}

function lastSegment(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

/**
 * Environments known to serve the vault: by their directory first (bridge_info.directory, or the directory the
 * store learned and persisted from an init event), then by a label naming the vault folder.
 */
function vaultEnvironmentIds(environments: readonly EnvironmentHint[], vaultPathOnMac: string): Set<string> {
  const ids = new Set<string>();
  const folder = lastSegment(vaultPathOnMac);
  for (const e of environments) {
    if (e.cwd) {
      if (isUnderPath(e.cwd, vaultPathOnMac)) ids.add(e.id);
    } else if (folder && (e.label === folder || e.label.startsWith(folder + ' '))) {
      ids.add(e.id);
    }
  }
  return ids;
}

/** 0 for a row waiting on the user, 1 for the rest; quiet (offline, machine-named) rows never rank 0. */
function rank(s: SessionSummary): number {
  return statusOf(s) === 'needs_you' ? 0 : 1;
}

/** The store's stable order key (frozen at the last full re-sort), else last activity. */
function orderAt(s: SessionSummary): number {
  return s.sortAt ?? s.lastEventAt ?? 0;
}

/** Needs-you first, machine-named offline sessions last, the rest by the store's order (most recent first). */
function triageOrder(a: SessionSummary, b: SessionSummary): number {
  const r = rank(a) - rank(b);
  if (r !== 0) return r;
  const q = (a.quiet ? 1 : 0) - (b.quiet ? 1 : 0);
  if (q !== 0) return q;
  return orderAt(b) - orderAt(a);
}

/**
 * Which sessions belong to "This vault": a cwd under the vault; for a session with an unknown cwd (bridge sessions
 * report cwd '') an environment whose directory is under the vault, or a sibling session in the same environment
 * with a cwd under the vault; or a session the person filed there (pinned).
 */
export function vaultMembership(
  sessions: readonly SessionSummary[],
  vaultPathOnMac: string,
  environments: readonly EnvironmentHint[] = [],
  pinned: ReadonlySet<string> = new Set(),
): (s: SessionSummary) => boolean {
  const vaultEnvIds = vaultEnvironmentIds(environments, vaultPathOnMac);
  for (const s of sessions) {
    if (s.cwd && s.environmentId && isUnderPath(s.cwd, vaultPathOnMac)) vaultEnvIds.add(s.environmentId);
  }
  return (s) =>
    pinned.has(s.id) || (s.cwd ? isUnderPath(s.cwd, vaultPathOnMac) : s.environmentId !== '' && vaultEnvIds.has(s.environmentId));
}

/** environments and pinned feed vaultMembership; see there. */
export function groupSessions(
  sessions: SessionSummary[],
  vaultPathOnMac: string,
  showArchived: boolean,
  environments: readonly EnvironmentHint[] = [],
  pinned: ReadonlySet<string> = new Set(),
): SessionGroupData[] {
  const inVaultOf = vaultMembership(sessions, vaultPathOnMac, environments, pinned);

  const vault: SessionSummary[] = [];
  const local: SessionSummary[] = [];
  const cloud: SessionSummary[] = [];
  const archived: SessionSummary[] = [];
  for (const s of sessions) {
    if (s.archived) {
      if (showArchived) archived.push(s);
      continue;
    }
    if (inVaultOf(s)) vault.push(s);
    else if (s.environmentKind === 'bridge') local.push(s);
    else cloud.push(s);
  }

  const groups: SessionGroupData[] = [
    { title: GROUP_TITLES.vault, sessions: vault },
    { title: GROUP_TITLES.local, sessions: local },
    { title: GROUP_TITLES.cloud, sessions: cloud },
  ];
  if (showArchived) groups.push({ title: GROUP_TITLES.archived, sessions: archived });
  for (const g of groups) g.sessions.sort(triageOrder);
  return groups.filter((g) => g.sessions.length > 0);
}

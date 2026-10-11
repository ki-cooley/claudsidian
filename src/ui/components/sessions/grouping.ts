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

/** Environments known to serve the vault: by bridge_info.directory first, then by a label naming the vault folder. */
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

function rank(s: SessionSummary): number {
  return statusOf(s) === 'needs_you' ? 0 : 1;
}

function triageOrder(a: SessionSummary, b: SessionSummary): number {
  const r = rank(a) - rank(b);
  if (r !== 0) return r;
  return (b.lastEventAt ?? 0) - (a.lastEventAt ?? 0);
}

/**
 * environments is an optional hint from store.environments(): a session with an unknown cwd (bridge sessions can
 * report cwd '') lands in "This vault" when its environment's directory is under the vault, or when a sibling
 * session in the same environment has a cwd under the vault.
 */
export function groupSessions(
  sessions: SessionSummary[],
  vaultPathOnMac: string,
  showArchived: boolean,
  environments: readonly EnvironmentHint[] = [],
): SessionGroupData[] {
  const vaultEnvIds = vaultEnvironmentIds(environments, vaultPathOnMac);
  for (const s of sessions) {
    if (s.cwd && s.environmentId && isUnderPath(s.cwd, vaultPathOnMac)) vaultEnvIds.add(s.environmentId);
  }

  const vault: SessionSummary[] = [];
  const local: SessionSummary[] = [];
  const cloud: SessionSummary[] = [];
  const archived: SessionSummary[] = [];
  for (const s of sessions) {
    if (s.archived) {
      if (showArchived) archived.push(s);
      continue;
    }
    const inVault = s.cwd ? isUnderPath(s.cwd, vaultPathOnMac) : s.environmentId !== '' && vaultEnvIds.has(s.environmentId);
    if (inVault) vault.push(s);
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

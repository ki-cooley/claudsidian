// Grouping behaviour owned by package B (store order and quiet rows). The vault/local/cloud split and the
// needs-you-first rule are covered in sessions-screen.test.tsx.
import { describe, expect, it } from 'vitest';
import { summarizeSession, type SessionSummary } from '../../../src/core/types';
import { groupSessions } from '../../../src/ui/components/sessions/grouping';
import { wireSession } from '../../helpers/fake-client';

const VAULT = '/Users/ki/workspace/projects/yes-chef';

function s(partial: Partial<SessionSummary> & { id: string }): SessionSummary {
  return { ...summarizeSession(wireSession({ id: partial.id, title: partial.title ?? partial.id })), ...partial };
}

function order(groups: ReturnType<typeof groupSessions>): [string, string[]][] {
  return groups.map((g) => [g.title, g.sessions.map((x) => x.id)]);
}

describe('groupSessions with store order and quiet rows', () => {
  it('forms "This vault" on a cold start from a persisted environment directory, before any session is opened', () => {
    const list = [s({ id: 'a', environmentId: 'env_vault' }), s({ id: 'b', environmentId: 'env_other' })];
    const groups = groupSessions(list, VAULT, false, [
      { id: 'env_vault', label: 'yes-chef (Mac)', cwd: VAULT },
      { id: 'env_other', label: 'workspace (Mac)', cwd: '/Users/ki/workspace' },
    ]);
    expect(order(groups)).toEqual([
      ['This vault', ['a']],
      ['Other local', ['b']],
    ]);
  });

  it('orders by the store sortAt when present, so a background poll does not reorder rows', () => {
    const list = [
      s({ id: 'old', cwd: VAULT, lastEventAt: 1, sortAt: 3 }),
      s({ id: 'new', cwd: VAULT, lastEventAt: 3, sortAt: 1 }),
      s({ id: 'mid', cwd: VAULT, lastEventAt: 2, sortAt: 2 }),
    ];
    expect(order(groupSessions(list, VAULT, false))).toEqual([['This vault', ['old', 'mid', 'new']]]);
  });

  it('falls back to lastEventAt for rows without sortAt', () => {
    const list = [s({ id: 'a', cwd: VAULT, lastEventAt: 1 }), s({ id: 'b', cwd: VAULT, lastEventAt: 2, sortAt: 5 }), s({ id: 'c', cwd: VAULT, lastEventAt: 9 })];
    expect(order(groupSessions(list, VAULT, false))).toEqual([['This vault', ['c', 'b', 'a']]]);
  });

  it('sorts quiet (offline, machine-named) sessions last in their group, below a needs-you row and the live rows', () => {
    const list = [
      s({ id: 'quiet', title: 'kisworkcomputer-zany-finch', cwd: VAULT, lastEventAt: 9, connectionStatus: 'disconnected', quiet: true }),
      s({ id: 'live', cwd: VAULT, lastEventAt: 2 }),
      s({ id: 'offline', cwd: VAULT, lastEventAt: 3, connectionStatus: 'disconnected' }),
      s({ id: 'blocked', cwd: VAULT, lastEventAt: 1, workerStatus: 'requires_action' }),
    ];
    expect(order(groupSessions(list, VAULT, false))).toEqual([['This vault', ['blocked', 'offline', 'live', 'quiet']]]);
  });

  it('keeps quiet rows in their own group (vault, local, cloud) rather than pooling them', () => {
    const list = [
      s({ id: 'q_local', title: 'kisworkcomputer-zany-finch', connectionStatus: 'disconnected', quiet: true, environmentId: 'env_x' }),
      s({ id: 'q_vault', title: 'kisworkcomputer-apt-fox', cwd: VAULT, connectionStatus: 'disconnected', quiet: true }),
      s({ id: 'v', cwd: VAULT, lastEventAt: 1 }),
    ];
    expect(order(groupSessions(list, VAULT, false))).toEqual([
      ['This vault', ['v', 'q_vault']],
      ['Other local', ['q_local']],
    ]);
  });
});

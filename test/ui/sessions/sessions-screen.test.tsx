// Sessions screen: grouping, status ordering, row taps, the row sheet, toolbar actions, polling lifecycle.
import { signal } from '@preact/signals';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionsScreen } from '../../../src/ui/components/sessions/SessionsScreen';
import { groupSessions } from '../../../src/ui/components/sessions/grouping';
import { statusOf } from '../../../src/ui/components/sessions/status';
import { FakeFacade, FakeStore, makeSession } from './fakes';
import { byText, click, flush, mount } from './render';

const VAULT = '/Users/kicooley-winters/workspace/projects/yes-chef';
const T0 = Date.UTC(2026, 9, 10, 12, 0, 0);

function seed(): ReturnType<typeof makeSession>[] {
  return [
    makeSession({ id: 'cse_vault', title: 'L10 menu questions', cwd: VAULT, lastEventAt: T0 - 60_000 }),
    makeSession({
      id: 'cse_ws',
      title: 'Summarize tech tasks',
      environmentId: 'env_ws',
      cwd: '/Users/kicooley-winters/workspace',
      lastEventAt: T0 - 3_600_000,
    }),
    makeSession({
      id: 'cse_cloud',
      title: 'Cloud refactor',
      environmentId: 'env_cloud',
      environmentKind: 'cloud',
      cwd: '/home/user/repo',
      lastEventAt: T0 - 7_200_000,
    }),
    makeSession({ id: 'cse_old', title: 'Old archived session', archived: true, cwd: VAULT, lastEventAt: T0 - 86_400_000 }),
  ];
}

let mounted: { unmount: () => void } | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('statusOf', () => {
  it('maps connection and worker status to the four dot states', () => {
    expect(statusOf(makeSession({ id: 'a', connectionStatus: 'disconnected', workerStatus: 'running' }))).toBe('offline');
    expect(statusOf(makeSession({ id: 'b', workerStatus: 'requires_action' }))).toBe('needs_you');
    expect(statusOf(makeSession({ id: 'c', summary: { needsAction: 'Allow rm' } }))).toBe('needs_you');
    expect(statusOf(makeSession({ id: 'd', workerStatus: 'running' }))).toBe('working');
    expect(statusOf(makeSession({ id: 'e' }))).toBe('idle');
  });
});

describe('groupSessions', () => {
  it('splits vault, other local, cloud and hides archived by default', () => {
    const groups = groupSessions(seed(), VAULT, false);
    expect(groups.map((g) => [g.title, g.sessions.map((s) => s.id)])).toEqual([
      ['This vault', ['cse_vault']],
      ['Other local', ['cse_ws']],
      ['Cloud', ['cse_cloud']],
    ]);
  });
  it('adds an Archived group when asked', () => {
    const groups = groupSessions(seed(), VAULT, true);
    expect(groups.at(-1)).toMatchObject({ title: 'Archived' });
    expect(groups.at(-1)?.sessions.map((s) => s.id)).toEqual(['cse_old']);
    expect(groups.find((g) => g.title === 'This vault')?.sessions.map((s) => s.id)).toEqual(['cse_vault']);
  });
  it('matches the vault path with or without a trailing slash and not by raw prefix', () => {
    const s = [
      makeSession({ id: 'a', cwd: VAULT + '/' }),
      makeSession({ id: 'b', cwd: VAULT + '-archive' }),
      makeSession({ id: 'c', cwd: VAULT + '/menus' }),
    ];
    const groups = groupSessions(s, VAULT + '/', false);
    expect(groups.find((g) => g.title === 'This vault')?.sessions.map((x) => x.id)).toEqual(['a', 'c']);
    expect(groups.find((g) => g.title === 'Other local')?.sessions.map((x) => x.id)).toEqual(['b']);
  });
  it('puts a bridge session with unknown cwd in the vault group when a sibling in its environment is in the vault', () => {
    const s = [
      makeSession({ id: 'known', cwd: VAULT, environmentId: 'env_vault' }),
      makeSession({ id: 'unknown', cwd: '', environmentId: 'env_vault' }),
      makeSession({ id: 'lonely', environmentId: 'env_other' }),
    ];
    const groups = groupSessions(s, VAULT, false);
    expect(groups.find((g) => g.title === 'This vault')?.sessions.map((x) => x.id).sort()).toEqual(['known', 'unknown']);
    expect(groups.find((g) => g.title === 'Other local')?.sessions.map((x) => x.id)).toEqual(['lonely']);
  });
  it('places a lone unknown-cwd session in the vault group when its environment directory is the vault', () => {
    const s = [makeSession({ id: 'desktop', cwd: '', environmentId: 'env_desk' }), makeSession({ id: 'ws', cwd: '/Users/kicooley-winters/workspace', environmentId: 'env_ws' })];
    const envs = [
      { id: 'env_desk', label: 'yes-chef on KisMac', cwd: VAULT },
      { id: 'env_ws', label: 'workspace on KisMac', cwd: '/Users/kicooley-winters/workspace' },
    ];
    const groups = groupSessions(s, VAULT, false, envs);
    expect(groups.find((g) => g.title === 'This vault')?.sessions.map((x) => x.id)).toEqual(['desktop']);
    expect(groups.find((g) => g.title === 'Other local')?.sessions.map((x) => x.id)).toEqual(['ws']);
    expect(groupSessions(s, VAULT, false).find((g) => g.title === 'This vault')).toBeUndefined();
  });
  it('falls back to the environment label naming the vault folder when it has no directory', () => {
    const s = [makeSession({ id: 'desktop', cwd: '', environmentId: 'env_desk' })];
    expect(groupSessions(s, VAULT, false, [{ id: 'env_desk', label: 'yes-chef (Mac)' }])[0]?.title).toBe('This vault');
    expect(groupSessions(s, VAULT, false, [{ id: 'env_desk', label: 'yes-chef-archive (Mac)' }])[0]?.title).toBe('Other local');
  });
  it('orders needs_you first, then most recent', () => {
    const s = [
      makeSession({ id: 'old', cwd: VAULT, lastEventAt: 1 }),
      makeSession({ id: 'new', cwd: VAULT, lastEventAt: 3 }),
      makeSession({ id: 'blocked', cwd: VAULT, lastEventAt: 2, workerStatus: 'requires_action' }),
    ];
    const groups = groupSessions(s, VAULT, false);
    expect(groups[0]?.sessions.map((x) => x.id)).toEqual(['blocked', 'new', 'old']);
  });
});

describe('SessionsScreen', () => {
  function setup(sessions = seed()) {
    const store = new FakeStore();
    store.sessions.value = sessions;
    const facade = new FakeFacade();
    const calls = { open: [] as string[], rename: [] as string[], archive: [] as string[] };
    mounted = mount(
      <SessionsScreen
        store={store}
        facade={facade}
        onOpen={(id) => calls.open.push(id)}
        onRename={(id) => calls.rename.push(id)}
        onArchive={(id) => calls.archive.push(id)}
      />,
    );
    const root = (mounted as unknown as { root: HTMLElement }).root;
    return { store, facade, calls, root };
  }

  it('refreshes and starts list polling on mount, stops on unmount', () => {
    const { store } = setup();
    expect(store.names()).toEqual(['refreshSessions', 'startListPolling']);
    mounted?.unmount();
    mounted = null;
    expect(store.names()).toContain('stopListPolling');
  });

  it('groups an unknown-cwd session by its environment from the store', () => {
    const store = new FakeStore();
    store.envs = [{ id: 'env_desk', kind: 'bridge', label: 'yes-chef on KisMac', cwd: VAULT, sessionCount: 1 }];
    store.sessions.value = [makeSession({ id: 'desktop', title: 'Desktop bridge', cwd: '', environmentId: 'env_desk' })];
    const facade = new FakeFacade();
    facade.current.vaultPathOnMac = VAULT;
    mounted = mount(<SessionsScreen store={store} facade={facade} onOpen={() => {}} onRename={() => {}} onArchive={() => {}} />);
    const root = (mounted as unknown as { root: HTMLElement }).root;
    expect(root.querySelector('.claudsidian-session-group-title')?.textContent).toBe('This vault');
  });

  it('renders the three groups and hides archived until the toggle is on', () => {
    const { root } = setup();
    const titles = () => Array.from(root.querySelectorAll('.claudsidian-session-group-title')).map((e) => e.textContent);
    expect(titles()).toEqual(['This vault', 'Other local', 'Cloud']);
    expect(root.querySelector('.claudsidian-show-archived')?.textContent?.trim()).toBe('Show archived');
    expect(root.textContent).not.toContain('Old archived session');
    click(root.querySelector('.claudsidian-show-archived input'));
    expect(titles()).toEqual(['This vault', 'Other local', 'Cloud', 'Archived']);
    expect(root.textContent).toContain('Old archived session');
  });

  it('renders a requires_action session first in its group with a Needs you label', () => {
    const sessions = seed();
    sessions.push(
      makeSession({
        id: 'cse_blocked',
        title: 'Clean scratch dir',
        cwd: VAULT,
        workerStatus: 'requires_action',
        lastEventAt: T0 - 9_000_000,
        summary: { needsAction: 'Allow rm -rf /tmp/x', detail: 'Waiting on a Bash permission' },
      }),
    );
    const { root } = setup(sessions);
    const group = root.querySelector('.claudsidian-session-group');
    const rows = Array.from(group?.querySelectorAll('.claudsidian-session-row') ?? []);
    expect(rows.map((r) => r.getAttribute('data-session-id'))).toEqual(['cse_blocked', 'cse_vault']);
    expect(rows[0]?.textContent).toContain('Needs you');
    expect(rows[0]?.querySelector('.claudsidian-session-summary')?.textContent).toBe('Allow rm -rf /tmp/x');
  });

  it('shows a summary line and bold title for unread', () => {
    const sessions = [
      makeSession({ id: 'u', title: 'Unread one', cwd: VAULT, unread: true, summary: { detail: 'Reading tasks' } }),
      makeSession({ id: 'r', title: 'Read one', cwd: VAULT, summary: { recentAction: 'Edited menu.md' } }),
    ];
    const { root } = setup(sessions);
    const rows = Array.from(root.querySelectorAll('.claudsidian-session-row'));
    expect(rows[0]?.classList.contains('is-unread')).toBe(true);
    expect(rows[0]?.querySelector('.claudsidian-session-summary')?.textContent).toBe('Reading tasks');
    expect(rows[1]?.classList.contains('is-unread')).toBe(false);
    expect(rows[1]?.querySelector('.claudsidian-session-summary')?.textContent).toBe('Edited menu.md');
  });

  it('calls onOpen when a row is tapped', () => {
    const { root, calls } = setup();
    click(root.querySelector('[data-session-id="cse_ws"] .claudsidian-session-main'));
    expect(calls.open).toEqual(['cse_ws']);
  });

  it('opens the row sheet with Rename, Archive and Open in claude.ai', () => {
    const { root, calls, facade } = setup();
    click(root.querySelector('[data-session-id="cse_vault"] .claudsidian-session-more'));
    expect(calls.open).toEqual([]);
    const sheet = root.querySelector('.claudsidian-ss-sheet');
    expect(sheet).not.toBeNull();
    click(byText(sheet!, 'button', 'Rename'));
    expect(calls.rename).toEqual(['cse_vault']);
    expect(root.querySelector('.claudsidian-ss-sheet')).toBeNull();

    click(root.querySelector('[data-session-id="cse_vault"] .claudsidian-session-more'));
    click(byText(root.querySelector('.claudsidian-ss-sheet')!, 'button', 'Archive'));
    expect(calls.archive).toEqual(['cse_vault']);

    click(root.querySelector('[data-session-id="cse_vault"] .claudsidian-session-more'));
    click(byText(root.querySelector('.claudsidian-ss-sheet')!, 'button', 'Open in claude.ai'));
    expect(facade.opened).toEqual(['https://claude.ai/code/cse_vault']);
  });

  it('refresh button calls store.refreshSessions', () => {
    const { root, store } = setup();
    click(root.querySelector('.claudsidian-sessions-refresh'));
    expect(store.names().filter((n) => n === 'refreshSessions')).toHaveLength(2);
  });

  it('New opens the new session sheet', () => {
    const { root } = setup();
    click(root.querySelector('.claudsidian-sessions-new'));
    expect(root.querySelector('.claudsidian-new-session')).not.toBeNull();
  });

  it('shows the spinner while loading an empty list and the empty state when there is nothing', async () => {
    const { root, store } = setup([]);
    expect(root.querySelector('.claudsidian-empty-state')).not.toBeNull();
    store.sessionsLoading.value = true;
    await flush();
    expect(root.querySelector('.claudsidian-ss-spinner')).not.toBeNull();
    expect(root.querySelector('.claudsidian-empty-state')).toBeNull();
  });

  it('keeps the all-archived state during a refresh', async () => {
    const { root, store } = setup([makeSession({ id: 'cse_old', title: 'Old', archived: true, cwd: VAULT })]);
    expect(root.querySelector('.claudsidian-empty-state')?.textContent).toContain('Every session is archived');
    store.sessionsLoading.value = true;
    await flush();
    expect(root.querySelector('.claudsidian-ss-spinner')).toBeNull();
    expect(root.querySelector('.claudsidian-empty-state')).not.toBeNull();
    click(byText(root, 'button', 'Show archived'));
    expect(root.querySelector('.claudsidian-session-group-title')?.textContent).toBe('Archived');
  });

  it('opens the new session sheet from an external signal and resets it on cancel and create', async () => {
    const store = new FakeStore();
    store.sessions.value = seed();
    store.envs = [{ id: 'env_vault', kind: 'bridge', label: 'yes-chef (Mac)', cwd: VAULT, sessionCount: 1 }];
    store.createResult = makeSession({ id: 'cse_made' });
    const facade = new FakeFacade();
    facade.current.vaultPathOnMac = VAULT;
    const opened: string[] = [];
    const showNewSession = signal(false);
    mounted = mount(
      <SessionsScreen
        store={store}
        facade={facade}
        onOpen={(id) => opened.push(id)}
        onRename={() => {}}
        onArchive={() => {}}
        showNewSession={showNewSession}
      />,
    );
    const root = (mounted as unknown as { root: HTMLElement }).root;
    expect(root.querySelector('.claudsidian-new-session')).toBeNull();

    showNewSession.value = true;
    await flush();
    expect(root.querySelector('.claudsidian-new-session')).not.toBeNull();
    click(byText(root.querySelector('.claudsidian-new-session')!, 'button', 'Cancel'));
    expect(showNewSession.value).toBe(false);
    expect(root.querySelector('.claudsidian-new-session')).toBeNull();

    showNewSession.value = true;
    await flush();
    click(byText(root.querySelector('.claudsidian-new-session')!, 'button', 'Create'));
    await flush();
    expect(opened).toEqual(['cse_made']);
    expect(showNewSession.value).toBe(false);
    expect(root.querySelector('.claudsidian-new-session')).toBeNull();
  });

  it('only the topmost sheet answers Escape', async () => {
    const { root } = setup();
    click(root.querySelector('[data-session-id="cse_vault"] .claudsidian-session-more'));
    click(root.querySelector('.claudsidian-sessions-new'));
    expect(root.querySelectorAll('.claudsidian-ss-sheet')).toHaveLength(2);
    const escape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    escape();
    await flush();
    expect(root.querySelector('.claudsidian-new-session')).toBeNull();
    expect(root.querySelector('.claudsidian-session-actions')).not.toBeNull();
    escape();
    await flush();
    expect(root.querySelectorAll('.claudsidian-ss-sheet')).toHaveLength(0);
  });

  it('renders the store banner and the list error', async () => {
    const { root, store } = setup();
    store.banner.value = { kind: 'offline', text: 'Mac offline' };
    await flush();
    expect(root.querySelector('.claudsidian-ss-banner')?.textContent).toContain('Mac offline');
    store.banner.value = null;
    store.sessionsError.value = 'Could not load sessions';
    await flush();
    expect(root.querySelector('.claudsidian-ss-banner')?.textContent).toContain('Could not load sessions');
  });
});

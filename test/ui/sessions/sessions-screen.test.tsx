// Sessions screen: grouping, status ordering, row taps, the row sheet, the toolbar (filter, archived toggle,
// manual refresh), the archive flow with its Notice, needs-you text from a known transcript, polling lifecycle.
import { signal } from '@preact/signals';
import { afterEach, describe, expect, it } from 'vitest';
import { createTranscript } from '../../../src/core/types';
import { SessionsScreen, matchesFilter } from '../../../src/ui/components/sessions/SessionsScreen';
import { groupSessions } from '../../../src/ui/components/sessions/grouping';
import { statusOf } from '../../../src/ui/components/sessions/status';
import { FakeFacade, FakeStore, makePending, makeSession } from './fakes';
import { byText, click, flush, mount, setValue } from './render';

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
      summary: { recentAction: 'Edited tasks/tech.md' },
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

describe('matchesFilter', () => {
  it('matches title and preview case-insensitively, and the needs-you line of a blocked row', () => {
    const s = makeSession({ id: 'a', title: 'Plan the knife reel', summary: { recentAction: 'HA VM restarted' } });
    expect(matchesFilter(s, '')).toBe(true);
    expect(matchesFilter(s, 'KNIFE')).toBe(true);
    expect(matchesFilter(s, 'ha vm')).toBe(true);
    expect(matchesFilter(s, 'dessert')).toBe(false);
    const blocked = makeSession({ id: 'b', title: 'yes-chef', summary: { needsAction: 'Approve or deny AskUserQuestion' } });
    expect(matchesFilter(blocked, "claude's question")).toBe(true);
  });
});

describe('SessionsScreen', () => {
  function setup(sessions = seed(), tweak?: (store: FakeStore, facade: FakeFacade) => void) {
    const store = new FakeStore();
    store.sessions.value = sessions;
    const facade = new FakeFacade();
    facade.current.vaultPathOnMac = VAULT;
    tweak?.(store, facade);
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
  const rowIds = (root: ParentNode) => Array.from(root.querySelectorAll('.claudsidian-session-row')).map((r) => r.getAttribute('data-session-id'));
  const groupTitles = (root: ParentNode) => Array.from(root.querySelectorAll('.claudsidian-session-group-title')).map((e) => e.textContent);

  it('refreshes with a full re-sort and starts list polling on mount, stops on unmount', () => {
    const { store } = setup();
    expect(store.names()).toEqual(['refreshSessions', 'startListPolling']);
    expect(store.calls[0]?.args[0]).toEqual({ resort: true });
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
    mounted = mount(<SessionsScreen store={store} facade={facade} onOpen={() => {}} onRename={() => {}} />);
    const root = (mounted as unknown as { root: HTMLElement }).root;
    expect(root.querySelector('.claudsidian-session-group-title')?.textContent).toBe('This vault');
  });

  it('renders the groups in order (This vault, Other local, Cloud, Archived) and hides archived until the icon toggle is on', () => {
    const { root } = setup();
    expect(groupTitles(root)).toEqual(['This vault', 'Other local', 'Cloud']);
    const toggle = root.querySelector('.claudsidian-show-archived');
    expect(toggle?.tagName).toBe('BUTTON');
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
    expect(toggle?.getAttribute('aria-label')).toBe('Show archived');
    expect(root.textContent).not.toContain('Old archived session');
    click(toggle);
    expect(root.querySelector('.claudsidian-show-archived')?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('.claudsidian-show-archived')?.classList.contains('is-pressed')).toBe(true);
    expect(groupTitles(root)).toEqual(['This vault', 'Other local', 'Cloud', 'Archived']);
    expect(root.textContent).toContain('Old archived session');
    click(root.querySelector('.claudsidian-show-archived'));
    expect(groupTitles(root)).toEqual(['This vault', 'Other local', 'Cloud']);
  });

  it('the toolbar is one row of named controls and the heading has no label that becomes a tooltip', () => {
    const { root } = setup();
    const bar = root.querySelector('.claudsidian-sessions-toolbar');
    expect(bar?.querySelector('.claudsidian-sessions-heading')?.textContent).toBe('Sessions');
    const buttons = Array.from(bar?.querySelectorAll('button') ?? []);
    const own = (b: Element) => b.className.split(' ').find((c) => c.startsWith('claudsidian-sessions-') || c === 'claudsidian-show-archived');
    expect(buttons.map(own)).toEqual([
      'claudsidian-sessions-search',
      'claudsidian-show-archived',
      'claudsidian-sessions-refresh',
      'claudsidian-sessions-new',
    ]);
    for (const b of buttons.slice(0, 3)) expect(b.classList.contains('is-ghost')).toBe(true);
    const newBtn = buttons[3]!;
    expect(newBtn.classList.contains('mod-cta')).toBe(true);
    expect(newBtn.querySelector('.claudsidian-ss-btn-label')?.textContent).toBe('New');
    expect(newBtn.getAttribute('aria-label')).toBe('New session');
  });

  it('the search button reveals an inline filter that narrows rows by title and preview, Escape clears it', async () => {
    const { root } = setup();
    expect(root.querySelector('.claudsidian-sessions-filter')).toBeNull();
    click(root.querySelector('.claudsidian-sessions-search'));
    const input = root.querySelector<HTMLInputElement>('.claudsidian-sessions-filter');
    expect(input).not.toBeNull();
    expect(root.querySelector('.claudsidian-sessions-heading')).toBeNull();
    expect(root.querySelector('.claudsidian-sessions-search')?.getAttribute('aria-pressed')).toBe('true');
    expect(input?.hasAttribute('aria-label')).toBe(false);
    expect(root.querySelector(`label[for="${input!.id}"]`)?.textContent).toBe('Filter sessions');

    setValue(input, 'tech');
    expect(rowIds(root)).toEqual(['cse_ws']);
    expect(groupTitles(root)).toEqual(['Other local']);
    setValue(input, 'CLOUD');
    expect(rowIds(root)).toEqual(['cse_cloud']);
    setValue(input, 'nothing here');
    expect(rowIds(root)).toEqual([]);
    expect(root.querySelector('.claudsidian-sessions-nomatch')?.textContent).toContain('No sessions match');
    expect(root.querySelector('.claudsidian-empty-state')).toBeNull();

    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flush();
    expect(root.querySelector('.claudsidian-sessions-filter')).toBeNull();
    expect(rowIds(root)).toEqual(['cse_vault', 'cse_ws', 'cse_cloud']);
  });

  it('closing the filter from its button clears the query', () => {
    const { root } = setup();
    click(root.querySelector('.claudsidian-sessions-search'));
    setValue(root.querySelector('.claudsidian-sessions-filter'), 'tech');
    expect(rowIds(root)).toEqual(['cse_ws']);
    click(root.querySelector('.claudsidian-sessions-search'));
    expect(root.querySelector('.claudsidian-sessions-filter')).toBeNull();
    expect(rowIds(root)).toHaveLength(3);
  });

  it('renders a requires_action session first in its group with the Needs you pill and the needs-you line', () => {
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
    expect(rows[0]?.querySelector('.claudsidian-session-pill')?.textContent).toBe('Needs you');
    expect(rows[0]?.querySelector('.claudsidian-session-summary')?.textContent).toBe('Allow rm -rf /tmp/x');
  });

  it('reads the needs-you line from the transcript when the plugin has seen the pending control', async () => {
    const sessions = [
      makeSession({ id: 'cse_q', title: 'yes-chef', cwd: VAULT, workerStatus: 'requires_action', summary: { needsAction: 'Approve or deny AskUserQuestion' } }),
    ];
    const { root, store } = setup(sessions);
    expect(root.querySelector('.claudsidian-session-summary')?.textContent).toBe("Answer Claude's question");
    store.setTranscript('cse_q', {
      ...createTranscript(),
      turn: 'needs_input',
      pending: [makePending('question', 'AskUserQuestion', { questions: [{ question: 'Does the dessert go in a bowl or on a plate?', options: [] }] })],
    });
    await flush();
    expect(root.querySelector('.claudsidian-session-summary')?.textContent).toBe('Answer: Does the dessert go in a bowl or on a plate?');
    store.setTranscript('cse_q', {
      ...createTranscript(),
      turn: 'needs_input',
      pending: [makePending('permission', 'Edit', { file_path: VAULT + '/prep-rd-2026-10-18.md' })],
    });
    await flush();
    expect(root.querySelector('.claudsidian-session-summary')?.textContent).toBe('Allow Edit prep-rd-2026-10-18.md?');
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

  it('sorts machine-named offline sessions to the bottom of their group', () => {
    const sessions = [
      makeSession({ id: 'quiet', title: 'kisworkcomputer-zany-finch', cwd: VAULT, connectionStatus: 'disconnected', lastEventAt: T0 - 1000 }),
      makeSession({ id: 'older', title: 'Real work', cwd: VAULT, lastEventAt: T0 - 50_000 }),
      makeSession({ id: 'offline', title: 'Induction pans', cwd: VAULT, connectionStatus: 'disconnected', lastEventAt: T0 - 90_000 }),
    ];
    const { root } = setup(sessions);
    expect(rowIds(root)).toEqual(['older', 'offline', 'quiet']);
    expect(root.querySelector('[data-session-id="quiet"]')?.classList.contains('is-quiet')).toBe(true);
  });

  it('calls onOpen when a row is tapped', () => {
    const { root, calls } = setup();
    click(root.querySelector('[data-session-id="cse_ws"] .claudsidian-session-main'));
    expect(calls.open).toEqual(['cse_ws']);
  });

  it('opens the row sheet with Rename and Open in claude.ai, Archive last as a ghost destructive row', () => {
    const { root, calls, facade } = setup();
    click(root.querySelector('[data-session-id="cse_vault"] .claudsidian-session-more'));
    expect(calls.open).toEqual([]);
    const sheet = root.querySelector('.claudsidian-ss-sheet');
    expect(sheet).not.toBeNull();
    const actions = Array.from(sheet!.querySelectorAll<HTMLButtonElement>('.claudsidian-session-action'));
    expect(actions.map((b) => b.textContent?.trim())).toEqual(['Rename', 'Open in claude.ai', 'Archive']);
    expect(actions.every((b) => b.classList.contains('is-ghost'))).toBe(true);
    expect(actions[2]?.classList.contains('is-archive')).toBe(true);
    expect(actions[2]?.classList.contains('mod-warning')).toBe(false);
    expect(sheet!.querySelector('.claudsidian-ss-sheet-title')?.textContent).toBe('L10 menu questions');
    expect(sheet!.getAttribute('aria-labelledby')).toBe(sheet!.querySelector('.claudsidian-ss-sheet-title')?.id);
    expect(sheet!.hasAttribute('aria-label')).toBe(false);

    click(byText(sheet!, 'button', 'Rename'));
    expect(calls.rename).toEqual(['cse_vault']);
    expect(root.querySelector('.claudsidian-ss-sheet')).toBeNull();

    click(root.querySelector('[data-session-id="cse_vault"] .claudsidian-session-more'));
    click(byText(root.querySelector('.claudsidian-ss-sheet')!, 'button', 'Open in claude.ai'));
    expect(facade.opened).toEqual(['https://claude.ai/code/cse_vault']);
  });

  it('the row sheet closes from the X in its head and from the backdrop', () => {
    const { root } = setup();
    click(root.querySelector('[data-session-id="cse_vault"] .claudsidian-session-more'));
    const close = root.querySelector('.claudsidian-ss-sheet-close');
    expect(close?.getAttribute('aria-label')).toBe('Close');
    click(close);
    expect(root.querySelector('.claudsidian-ss-sheet')).toBeNull();
    click(root.querySelector('[data-session-id="cse_vault"] .claudsidian-session-more'));
    click(root.querySelector('.claudsidian-ss-sheet-backdrop'));
    expect(root.querySelector('.claudsidian-ss-sheet')).toBeNull();
  });

  it('Archive archives through the store at once, with a Notice, and never through the confirm handler', async () => {
    const { root, calls, facade, store } = setup();
    click(root.querySelector('[data-session-id="cse_vault"] .claudsidian-session-more'));
    click(byText(root.querySelector('.claudsidian-ss-sheet')!, 'button', 'Archive'));
    expect(root.querySelector('.claudsidian-ss-sheet')).toBeNull();
    expect(store.calls.find((c) => c.name === 'archive')?.args).toEqual(['cse_vault']);
    expect(facade.notices).toEqual(['Archived L10 menu questions']);
    expect(calls.archive).toEqual([]);
    await flush();
    expect(rowIds(root)).toEqual(['cse_ws', 'cse_cloud']);
  });

  it('reports an archive failure in a second Notice', async () => {
    const { root, facade } = setup(seed(), (s) => {
      s.archiveResult = new Error('offline');
    });
    click(root.querySelector('[data-session-id="cse_vault"] .claudsidian-session-more'));
    click(byText(root.querySelector('.claudsidian-ss-sheet')!, 'button', 'Archive'));
    await flush();
    expect(facade.notices).toEqual(['Archived L10 menu questions', 'Archive failed: offline']);
  });

  it('an archived row offers no Archive action', () => {
    const { root } = setup();
    click(root.querySelector('.claudsidian-show-archived'));
    click(root.querySelector('[data-session-id="cse_old"] .claudsidian-session-more'));
    const sheet = root.querySelector('.claudsidian-ss-sheet');
    expect(byText(sheet!, 'button', 'Archive')).toBeUndefined();
    expect(byText(sheet!, 'button', 'Rename')).not.toBeUndefined();
  });

  it('the refresh icon spins only for a manual refresh, not for the background loading flag', async () => {
    let release: () => void = () => {};
    const { root, store } = setup(seed(), (s) => {
      s.refreshGate = new Promise<void>((r) => {
        release = r;
      });
    });
    const button = () => root.querySelector('.claudsidian-sessions-refresh')!;
    expect(button().classList.contains('is-loading')).toBe(false);
    store.sessionsLoading.value = true;
    await flush();
    expect(button().classList.contains('is-loading')).toBe(false);
    store.sessionsLoading.value = false;

    click(button());
    expect(store.names().filter((n) => n === 'refreshSessions')).toHaveLength(2);
    expect(store.calls.filter((c) => c.name === 'refreshSessions').at(-1)?.args[0]).toEqual({ resort: true });
    expect(button().classList.contains('is-loading')).toBe(true);
    click(button());
    expect(store.names().filter((n) => n === 'refreshSessions')).toHaveLength(2);
    release();
    await flush();
    await flush();
    expect(button().classList.contains('is-loading')).toBe(false);
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
      <SessionsScreen store={store} facade={facade} onOpen={(id) => opened.push(id)} onRename={() => {}} showNewSession={showNewSession} />,
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

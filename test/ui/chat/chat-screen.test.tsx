// ChatScreen: context block on send, slash commands without context, header status, menu actions.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionSummary } from '../../../src/core/types';
import { DEFAULT_SETTINGS, type ClaudsidianSettings } from '../../../src/settings';
import { ChatScreen, type ChatScreenProps } from '../../../src/ui/components/chat/ChatScreen';
import { resetDrafts } from '../../../src/ui/components/chat/drafts';
import { FakeFacade } from '../../helpers/fake-facade';
import { FakeStore, fakeSession, items, transcriptWith } from '../../helpers/fake-store';
import { buttonByText, hasButton, key, maybe, mount, q, qa, text, tick, type, type Mounted } from './harness';

const VAULT = DEFAULT_SETTINGS.vaultPathOnMac;

let mounted: Mounted<unknown>[] = [];
afterEach(() => {
  for (const m of mounted) m.unmount();
  mounted = [];
  resetDrafts();
});

interface Options {
  session?: Partial<SessionSummary>;
  settings?: Partial<ClaudsidianSettings>;
  isMobile?: boolean;
  initCwd?: string | null;
}

function setup(opts: Options = {}) {
  const session = fakeSession({ id: 'cse_1', title: 'Menu work', ...opts.session });
  const store = new FakeStore([session]);
  const init = opts.initCwd === null ? undefined : { cwd: opts.initCwd ?? VAULT, model: 'claude-opus-5-5', slashCommands: [], tools: [] };
  store.setTranscript('cse_1', transcriptWith([items.user('hi'), items.assistant('hello'), items.result()], { init, model: 'claude-opus-5-5', permissionMode: 'auto' }));
  const facade = new FakeFacade({ isMobile: opts.isMobile ?? false, settings: opts.settings });
  const props: ChatScreenProps = { store, facade, sessionId: 'cse_1', onBack: vi.fn(), onRename: vi.fn(), onArchive: vi.fn() };
  const m = mount(ChatScreen, props);
  mounted.push(m as Mounted<unknown>);
  const textarea = (): HTMLTextAreaElement => q<HTMLTextAreaElement>(m.root, 'textarea');
  async function send(message: string): Promise<void> {
    type(textarea(), message);
    await tick();
    key(textarea(), 'Enter');
    await tick();
    await tick();
  }
  return { ...m, store, facade, props, textarea, send, session };
}

describe('ChatScreen', () => {
  it('sending appends the context block built from the captured context', async () => {
    const { store, facade, send } = setup();
    await send('hello');
    const sent = store.lastSend();
    expect(sent?.sessionId).toBe('cse_1');
    expect(sent?.text).toBe('hello');
    expect(sent?.opts?.contextText).toContain('[Obsidian context]');
    expect(sent?.opts?.contextText).toContain('active note: menus/latitude 10/menu.md');
    expect(sent?.opts?.contextText).toContain('dashi, kombu cure, fino');
    expect(sent?.opts?.contextText).toContain('open notes: components/dashi.md, techniques/kombu-cure.md');
    // the session runs in the vault, so no vault line
    expect(sent?.opts?.contextText).not.toContain('vault:');
    expect(facade.callsTo('captureContext').at(-1)).toEqual([[]]);
  });

  it('adds the vault line when the session cwd is unknown', async () => {
    const { store, send } = setup({ initCwd: null });
    await send('where am i');
    expect(store.lastSend()?.opts?.contextText).toContain(`vault: yes-chef (${VAULT})`);
  });

  it('a slash command sends with no context', async () => {
    const { store, send } = setup();
    await send('/compact');
    const sent = store.lastSend();
    expect(sent?.text).toBe('/compact');
    expect(sent?.opts?.contextText).toBeUndefined();
  });

  it('context chips toggle parts of the block off for this screen', async () => {
    const { root, store, send } = setup();
    await tick();
    const noteChip = q<HTMLButtonElement>(root, '.claudsidian-chip[data-key="note"]');
    expect(noteChip.getAttribute('aria-pressed')).toBe('true');
    noteChip.click();
    await tick();
    expect(q(root, '.claudsidian-chip[data-key="note"]').getAttribute('aria-pressed')).toBe('false');
    q<HTMLButtonElement>(root, '.claudsidian-chip[data-key="open"]').click();
    await tick();
    await send('no note please');
    const block = store.lastSend()?.opts?.contextText ?? '';
    expect(block).not.toContain('active note:');
    expect(block).not.toContain('open notes:');
    expect(block).toContain('selection (lines 40-44)');
  });

  it('header shows the title, Needs you when the turn needs input, and Working while working', async () => {
    const { root, store } = setup();
    await tick();
    expect(text(q(root, '.claudsidian-header-title'))).toBe('Menu work');
    expect(text(q(root, '.claudsidian-status'))).toBe('Idle');
    store.patchTranscript('cse_1', { turn: 'needs_input' });
    await tick();
    expect(text(q(root, '.claudsidian-status'))).toBe('Needs you');
    store.patchTranscript('cse_1', { turn: 'working' });
    await tick();
    expect(text(q(root, '.claudsidian-status'))).toBe('Working');
    expect(q(root, '.claudsidian-status').classList.contains('is-working')).toBe(true);
  });

  it('shows Mac offline when the session connection is disconnected', async () => {
    const { root } = setup({ session: { connectionStatus: 'disconnected' } });
    await tick();
    expect(text(q(root, '.claudsidian-status'))).toBe('Mac offline');
  });

  it('shows the model and permission mode chips and the store banner', async () => {
    const { root, store } = setup();
    await tick();
    expect(text(root)).toContain('claude-opus-5-5');
    expect(text(q(root, '.claudsidian-header'))).toContain('auto');
    store.banner.value = { kind: 'offline', text: 'No connection. Retrying.' };
    await tick();
    expect(text(q(root, '.claudsidian-banner'))).toContain('No connection. Retrying.');
  });

  it('opens the session in the store on mount when it is not selected, and Back calls onBack', async () => {
    const { store, props, root } = setup();
    await tick();
    expect(store.callsTo('open')).toEqual([['cse_1']]);
    q<HTMLButtonElement>(root, 'button[aria-label="Back to sessions"]').click();
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it('Stop interrupts the session', async () => {
    const { store, root } = setup();
    store.patchTranscript('cse_1', { turn: 'working' });
    await tick();
    q<HTMLButtonElement>(root, 'button[aria-label="Stop"]').click();
    await tick();
    expect(store.callsTo('interrupt')).toEqual([['cse_1']]);
  });

  it('quick replies show only in cooking mode and send without context', async () => {
    const plain = setup();
    await tick();
    expect(maybe(plain.root, '.claudsidian-quick')).toBeNull();
    const cooking = setup({ settings: { cookingMode: true, quickReplies: ['yes', 'stop'] } });
    await tick();
    expect(q(cooking.root, '.claudsidian-chat').classList.contains('is-cooking')).toBe(true);
    buttonByText(q(cooking.root, '.claudsidian-quick'), 'yes').click();
    await tick();
    expect(cooking.store.lastSend()).toMatchObject({ text: 'yes' });
    expect(cooking.store.lastSend()?.opts?.contextText).toBeUndefined();
  });

  it('the overflow menu reaches rename, archive, open in claude.ai, cooking mode, model and permission mode', async () => {
    const { root, store, facade, props } = setup();
    await tick();
    const open = () => q<HTMLButtonElement>(root, 'button[aria-label="More actions"]').click();
    open();
    await tick();
    buttonByText(q(root, '.claudsidian-sheet'), 'Rename').click();
    expect(props.onRename).toHaveBeenCalledTimes(1);
    await tick();
    expect(maybe(root, '.claudsidian-sheet')).toBeNull();

    open();
    await tick();
    buttonByText(q(root, '.claudsidian-sheet'), 'Open in claude.ai').click();
    expect(facade.externalUrls).toEqual(['https://claude.ai/code/cse_1']);
    await tick();

    open();
    await tick();
    buttonByText(q(root, '.claudsidian-sheet'), 'Cooking mode').click();
    await tick();
    expect(facade.settingsValue.cookingMode).toBe(true);
    expect(q(root, '.claudsidian-chat').classList.contains('is-cooking')).toBe(true);

    open();
    await tick();
    buttonByText(q(root, '.claudsidian-sheet'), 'Model').click();
    await tick();
    buttonByText(q(root, '.claudsidian-sheet'), 'claude-sonnet-5-5').click();
    await tick();
    expect(store.callsTo('setModel')).toEqual([['cse_1', 'claude-sonnet-5-5']]);

    open();
    await tick();
    buttonByText(q(root, '.claudsidian-sheet'), 'Permission mode').click();
    await tick();
    buttonByText(q(root, '.claudsidian-sheet'), 'plan').click();
    await tick();
    expect(store.callsTo('setPermissionMode')).toEqual([['cse_1', 'plan']]);

    open();
    await tick();
    buttonByText(q(root, '.claudsidian-sheet'), 'Effort').click();
    await tick();
    buttonByText(q(root, '.claudsidian-sheet'), 'high').click();
    await tick();
    expect(store.lastSend()).toMatchObject({ text: '/effort high' });
    expect(store.lastSend()?.opts?.contextText).toBeUndefined();

    open();
    await tick();
    buttonByText(q(root, '.claudsidian-sheet'), 'Archive').click();
    expect(props.onArchive).toHaveBeenCalledTimes(1);
  });

  it('a custom model id goes through the Model sheet too', async () => {
    const { root, store } = setup();
    await tick();
    q<HTMLButtonElement>(root, 'button[aria-label="More actions"]').click();
    await tick();
    buttonByText(q(root, '.claudsidian-sheet'), 'Model').click();
    await tick();
    type(q<HTMLInputElement>(root, '.claudsidian-sheet input'), ' claude-custom-9 ');
    await tick();
    buttonByText(q(root, '.claudsidian-sheet'), 'Use model').click();
    await tick();
    expect(store.callsTo('setModel')).toEqual([['cse_1', 'claude-custom-9']]);
  });

  it('assistant text actions copy, insert at the cursor, and create a note', async () => {
    const { root, facade } = setup();
    await tick();
    const msg = q(root, '.claudsidian-item[data-kind="assistant_text"]');
    q<HTMLButtonElement>(msg, 'button[aria-label="Copy"]').click();
    q<HTMLButtonElement>(msg, 'button[aria-label="Insert at cursor"]').click();
    q<HTMLButtonElement>(msg, 'button[aria-label="New note"]').click();
    await tick();
    await tick();
    expect(facade.clipboard).toEqual(['hello']);
    expect(facade.inserted).toEqual(['hello']);
    expect(facade.createdNotes[0]?.path).toBe('Claude/Menu work.md');
    expect(facade.createdNotes[0]?.content).toBe('hello');
    expect(facade.openedFiles).toEqual(['Claude/Menu work.md']);
  });

  it('a failed send keeps the draft and leaves the error to the banner', async () => {
    const { root, store, send, textarea } = setup();
    store.failNext = new Error('Network error: offline');
    await send('keep this');
    expect(textarea().value).toBe('keep this');
    expect(hasButton(root, 'Allow')).toBe(false);
    expect(qa(root, '.claudsidian-item[data-kind="user"]').map((el) => text(el))).toEqual(['hi']);
  });
});

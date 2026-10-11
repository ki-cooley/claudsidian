// Tests for ObsidianFacade (src/obsidian/facade-impl.ts) against the obsidian mock: unique note paths,
// cursor insertion with and without an editor, sorted vault files, markdown rendering, clipboard
// fallback, the image picker's cancel path, sign-in, and the wake lock no-op.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App, Component, MarkdownView, Notice, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { ContextCapture } from '../../src/obsidian/context-capture';
import { DEFAULT_SETTINGS } from '../../src/settings';
import { FakeAuth, SIGNED_IN } from '../ui/shell-fakes';

vi.mock('../../src/ui/modals/SignInModal', () => ({
  SignInModal: class {
    static outcome = true;
    constructor(
      _app: unknown,
      _auth: unknown,
      private readonly onDone: (ok: boolean) => void,
    ) {}
    open(): void {
      this.onDone((this.constructor as unknown as { outcome: boolean }).outcome);
    }
  },
}));

import { SignInModal } from '../../src/ui/modals/SignInModal';
import { ObsidianFacade, uniqueNotePath, type FacadeHost } from '../../src/obsidian/facade-impl';

function file(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop() ?? path;
  f.basename = f.name.replace(/\.md$/, '');
  return f;
}

function markdownView(editor: Partial<MarkdownView['editor']> = {}): MarkdownView {
  const view = new MarkdownView(new WorkspaceLeaf());
  view.file = file('note.md');
  Object.assign(view.editor, editor);
  return view;
}

/** The mock Notice records the last message on a static the real typings do not declare. */
function lastNotice(): string | undefined {
  return (Notice as unknown as { last?: string }).last;
}

function setup() {
  const app = new App();
  const capture = new ContextCapture(app, { ownViewType: 'claudsidian-chat' });
  // Plugin is abstract in the real typings; the mock is concrete. install() only needs registerEvent.
  capture.install(new (Plugin as unknown as new (app: App) => Plugin)(app));
  const auth = new FakeAuth(SIGNED_IN);
  const saveSettings = vi.fn(async () => {});
  const host = {
    app,
    manifest: { id: 'claudsidian', version: '2.0.0' },
    settings: structuredClone(DEFAULT_SETTINGS),
    auth,
    capture,
    saveSettings,
  } as unknown as FacadeHost;
  const facade = new ObsidianFacade(host, new Component());
  return { app, capture, auth, saveSettings, facade, host };
}

describe('uniqueNotePath', () => {
  it('keeps a free path and suffixes 2, 3 on collisions', () => {
    const taken = new Set(['Claude/title.md', 'Claude/title 2.md']);
    const exists = (p: string) => taken.has(p);
    expect(uniqueNotePath(exists, 'Claude/other.md')).toBe('Claude/other.md');
    expect(uniqueNotePath(exists, 'Claude/title.md')).toBe('Claude/title 3.md');
    expect(uniqueNotePath((p) => p === 'plain', 'plain')).toBe('plain 2');
  });
});

describe('ObsidianFacade', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    (Notice as unknown as { last?: string }).last = undefined;
  });

  it('exposes platform, vault name, version, auth, and settings', () => {
    const { facade, auth, host } = setup();
    expect(facade.isMobile).toBe(false);
    expect(facade.vaultName).toBe('test-vault');
    expect(facade.version).toBe('2.0.0');
    expect(facade.auth).toBe(auth);
    expect(facade.settings()).toBe(host.settings);
  });

  it('saveSettings forwards the patch to the plugin', async () => {
    const { facade, saveSettings } = setup();
    await facade.saveSettings({ cookingMode: true });
    expect(saveSettings).toHaveBeenCalledWith({ cookingMode: true });
  });

  it('createNote picks a unique path, creates missing folders, and returns the path it wrote', async () => {
    const { facade, app } = setup();
    const taken = new Set(['Claude', 'Claude/title.md', 'Claude/title 2.md']);
    app.vault.getAbstractFileByPath = (p: string) => (taken.has(p) ? file(p) : null);
    const create = vi.fn(async (p: string, _c: string) => file(p));
    app.vault.create = create;
    expect(await facade.createNote('Claude/title.md', 'body')).toBe('Claude/title 3.md');
    expect(create).toHaveBeenCalledWith('Claude/title 3.md', 'body');

    const createFolder = vi.fn(async (p: string) => {
      taken.add(p);
      return file(p);
    });
    (app.vault as unknown as { createFolder: typeof createFolder }).createFolder = createFolder;
    expect(await facade.createNote('Notes/new.md', 'x')).toBe('Notes/new.md');
    expect(createFolder).toHaveBeenCalledWith('Notes');
  });

  it('insertAtCursor returns false without an editor and inserts at the cursor with one', async () => {
    const { facade, app } = setup();
    expect(await facade.insertAtCursor('hello')).toBe(false);
    const replaceRange = vi.fn();
    const view = markdownView({ replaceRange, getCursor: () => ({ line: 3, ch: 1 }) });
    app.workspace.getActiveViewOfType = <T>() => view as unknown as T;
    expect(await facade.insertAtCursor('hello')).toBe(true);
    expect(replaceRange).toHaveBeenCalledWith('hello', { line: 3, ch: 1 });
  });

  it('falls back to the last active markdown view when the chat view is active', async () => {
    const { facade, app } = setup();
    const replaceRange = vi.fn();
    const replaceSelection = vi.fn();
    const view = markdownView({ replaceRange, replaceSelection, getCursor: () => ({ line: 0, ch: 2 }) });
    const leaf = new WorkspaceLeaf();
    (leaf as unknown as { view: unknown }).view = view;
    app.workspace.trigger('active-leaf-change', leaf);
    expect(await facade.insertAtCursor('a')).toBe(true);
    expect(replaceRange).toHaveBeenCalledWith('a', { line: 0, ch: 2 });
    expect(await facade.replaceSelection('b')).toBe(true);
    expect(replaceSelection).toHaveBeenCalledWith('b');
  });

  it('replaceSelection returns false without an editor', async () => {
    const { facade } = setup();
    expect(await facade.replaceSelection('x')).toBe(false);
  });

  it('vaultFiles returns markdown paths sorted', () => {
    const { facade, app } = setup();
    app.vault.getMarkdownFiles = () => [file('notes/b.md'), file('a.md'), file('menus/menu.md')];
    expect(facade.vaultFiles()).toEqual(['a.md', 'menus/menu.md', 'notes/b.md']);
  });

  it('captureContext delegates to the plugin capture with the context settings', () => {
    const { facade } = setup();
    expect(facade.captureContext(['recipes/tare.md'])).toEqual({
      vaultName: 'test-vault',
      openNotes: [],
      mentions: ['recipes/tare.md'],
    });
  });

  it('renderMarkdown renders through MarkdownRenderer into the element', async () => {
    const { facade } = setup();
    const el = document.createElement('div');
    await facade.renderMarkdown('**hi**', el);
    expect(el.textContent).toBe('**hi**');
  });

  it('openFile goes through openLinkText in the current leaf', async () => {
    const { facade, app } = setup();
    const openLinkText = vi.fn(async () => {});
    (app.workspace as unknown as { openLinkText: typeof openLinkText }).openLinkText = openLinkText;
    await facade.openFile('menus/menu.md');
    expect(openLinkText).toHaveBeenCalledWith('menus/menu.md', '', false);
  });

  it('copyToClipboard uses the clipboard API and falls back to a textarea copy', async () => {
    const { facade } = setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await facade.copyToClipboard('text');
    expect(writeText).toHaveBeenCalledWith('text');

    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    const execCommand = vi.fn(() => true);
    (document as unknown as { execCommand: typeof execCommand }).execCommand = execCommand;
    await facade.copyToClipboard('fallback');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('openExternal opens a new window and notice shows an Obsidian notice', () => {
    const { facade } = setup();
    const open = vi.fn();
    vi.stubGlobal('open', open);
    try {
      facade.openExternal('https://claude.ai/code/cse_1');
      expect(open).toHaveBeenCalledWith('https://claude.ai/code/cse_1', '_blank');
    } finally {
      vi.unstubAllGlobals();
    }
    facade.notice('Sent');
    expect(lastNotice()).toBe('Sent');
  });

  it('pickImages resolves [] when the picker is cancelled and removes its input', async () => {
    const { facade } = setup();
    const promise = facade.pickImages();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input?.accept).toBe('image/*');
    expect(input?.multiple).toBe(true);
    input?.dispatchEvent(new Event('cancel'));
    expect(await promise).toEqual([]);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('pickImages resolves the chosen files', async () => {
    const { facade } = setup();
    const promise = facade.pickImages();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const picked = new File(['x'], 'a.png', { type: 'image/png' });
    Object.defineProperty(input, 'files', { value: [picked], configurable: true });
    input.dispatchEvent(new Event('change'));
    expect(await promise).toEqual([picked]);
  });

  it('signIn resolves with the modal outcome', async () => {
    const { facade } = setup();
    const Modal = SignInModal as unknown as { outcome: boolean };
    Modal.outcome = true;
    expect(await facade.signIn()).toBe(true);
    Modal.outcome = false;
    expect(await facade.signIn()).toBe(false);
  });

  it('setWakeLock is a no-op where the API is missing and releases what it acquired', async () => {
    const { facade } = setup();
    await expect(facade.setWakeLock(true)).resolves.toBeUndefined();
    const release = vi.fn(async () => {});
    const request = vi.fn(async () => ({ release }));
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    try {
      await facade.setWakeLock(true);
      expect(request).toHaveBeenCalledWith('screen');
      await facade.setWakeLock(true);
      expect(request).toHaveBeenCalledTimes(1);
      await facade.setWakeLock(false);
      expect(release).toHaveBeenCalledTimes(1);
      await facade.setWakeLock(false);
      expect(release).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(navigator, 'wakeLock', { value: undefined, configurable: true });
    }
  });
});

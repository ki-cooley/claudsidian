// ChatView (src/ui/ChatView.ts) visibility: a desktop window that lost focus counts as not visible (polling
// drops to background), window blur and focus re-evaluate it, and mobile ignores document focus.
import { signal } from '@preact/signals';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, Platform, WorkspaceLeaf } from 'obsidian';
import { ContextCapture } from '../../src/obsidian/context-capture';
import type ClaudsidianPlugin from '../../src/main';
import { DEFAULT_SETTINGS } from '../../src/settings';
import { ChatView } from '../../src/ui/ChatView';
import { FakeAuth, FakeStore } from '../ui/shell-fakes';

function setup() {
  const app = new App();
  const store = new FakeStore();
  const plugin = {
    app,
    store,
    settings: structuredClone(DEFAULT_SETTINGS),
    capture: new ContextCapture(app, { ownViewType: 'claudsidian-chat' }),
    auth: new FakeAuth(null),
    manifest: { id: 'claudsidian', version: 'test' },
    saveSettings: vi.fn(async () => {}),
    ui: { showNewSession: signal(false) },
    settingsChanged: signal(0),
    register: vi.fn(),
  } as unknown as ClaudsidianPlugin;
  const view = new ChatView(new WorkspaceLeaf(), plugin);
  return { view, store, plugin };
}

describe('ChatView visibility', () => {
  let hasFocus: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    Platform.isMobile = false;
  });
  afterEach(() => {
    hasFocus.mockRestore();
    Platform.isMobile = false;
  });

  it('treats a blurred desktop window as not visible', () => {
    const { view } = setup();
    expect(view.isViewVisible()).toBe(true);
    hasFocus.mockReturnValue(false);
    expect(view.isViewVisible()).toBe(false);
  });

  it('ignores document focus on mobile', () => {
    Platform.isMobile = true;
    const { view } = setup();
    hasFocus.mockReturnValue(false);
    expect(view.isViewVisible()).toBe(true);
  });

  it('mirrors window blur and focus into the store while open, and stops after close', async () => {
    const { view, store } = setup();
    await view.onOpen();
    expect(store.visible.value).toBe(true);

    hasFocus.mockReturnValue(false);
    window.dispatchEvent(new Event('blur'));
    expect(store.visible.value).toBe(false);

    hasFocus.mockReturnValue(true);
    window.dispatchEvent(new Event('focus'));
    expect(store.visible.value).toBe(true);

    await view.onClose();
    view.unload();
    expect(store.visible.value).toBe(false);
    hasFocus.mockReturnValue(true);
    window.dispatchEvent(new Event('focus'));
    expect(store.visible.value).toBe(false);
  });

  it('does not listen for window focus on mobile', async () => {
    Platform.isMobile = true;
    const { view, store } = setup();
    const add = vi.spyOn(window, 'addEventListener');
    await view.onOpen();
    expect(add.mock.calls.map((c) => c[0])).not.toContain('blur');
    hasFocus.mockReturnValue(false);
    window.dispatchEvent(new Event('blur'));
    expect(store.visible.value).toBe(true);
    add.mockRestore();
    await view.onClose();
    view.unload();
  });
});

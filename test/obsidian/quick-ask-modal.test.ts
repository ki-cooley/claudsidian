// QuickAskModal (src/ui/modals/QuickAskModal.ts): the reply wait registers its timer and store listener with
// the plugin so an unload clears them, a reply clears both itself, and the insert button says what to do
// when no note is open.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, Notice } from 'obsidian';
import { ContextCapture } from '../../src/obsidian/context-capture';
import { createTranscript } from '../../src/core/types';
import type ClaudsidianPlugin from '../../src/main';
import { DEFAULT_SETTINGS } from '../../src/settings';
import { QuickAskModal } from '../../src/ui/modals/QuickAskModal';
import { FakeAuth, FakeStore, SIGNED_IN, makeSession } from '../ui/shell-fakes';

function lastNotice(): string | undefined {
  return (Notice as unknown as { last?: string }).last;
}

function setup() {
  const app = new App();
  const store = new FakeStore();
  store.sessions.value = [makeSession({ id: 'cse_1', title: 'Menu' })];
  store.selectedId.value = 'cse_1';
  const register = vi.fn<(cb: () => void) => void>();
  const plugin = {
    app,
    store,
    settings: structuredClone(DEFAULT_SETTINGS),
    capture: new ContextCapture(app, { ownViewType: 'claudsidian-chat' }),
    auth: new FakeAuth(SIGNED_IN),
    manifest: { id: 'claudsidian', version: 'test' },
    saveSettings: vi.fn(async () => {}),
    register,
  } as unknown as ClaudsidianPlugin;
  const modal = new QuickAskModal(app, plugin, 'selected text');
  return { store, plugin, modal, register };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('QuickAskModal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (Notice as unknown as { last?: string }).last = undefined;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends with the selection as context and registers the reply wait with the plugin', async () => {
    const { store, modal, register } = setup();
    modal.open();
    modal.contentEl.querySelector<HTMLButtonElement>('button.mod-cta')?.click();
    await flush();
    const sent = store.calls.find((c) => c.name === 'send');
    expect(sent?.args[0]).toBe('cse_1');
    expect(sent?.args[1]).toBe('Look at this selection.');
    expect(String((sent?.args[2] as { contextText?: string }).contextText)).toContain('selected text');
    expect(lastNotice()).toBe('Sent to Menu');
    expect(store.listenerCount('turn_end')).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    expect(register).toHaveBeenCalledTimes(1);

    // Plugin unload: the registered disposer drops the listener and the 10-minute timer.
    register.mock.calls[0]![0]();
    expect(store.listenerCount('turn_end')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the wait when the reply lands and the insert button explains a missing note', async () => {
    const { store, modal } = setup();
    modal.open();
    modal.contentEl.querySelector<HTMLButtonElement>('button.mod-cta')?.click();
    await flush();
    const state = createTranscript();
    state.items.push({ kind: 'assistant_text', id: 'a1', text: 'The reply.', partial: false });
    const fragment = document.createDocumentFragment();
    vi.spyOn(document, 'createDocumentFragment').mockReturnValue(fragment);
    store.emit('turn_end', 'cse_other', state);
    expect(store.listenerCount('turn_end')).toBe(1);
    store.emit('turn_end', 'cse_1', state);
    expect(store.listenerCount('turn_end')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(lastNotice()).toContain('Menu replied.');

    // No note is open (the chat leaf is active, nothing was tracked): the button says so.
    fragment.querySelector<HTMLButtonElement>('.claudsidian-notice-action')?.click();
    await flush();
    expect(lastNotice()).toBe('No editor to insert into. Open a note first.');
  });

  it('gives up after the wait window', async () => {
    const { store, modal } = setup();
    modal.open();
    modal.contentEl.querySelector<HTMLButtonElement>('button.mod-cta')?.click();
    await flush();
    expect(store.listenerCount('turn_end')).toBe(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(store.listenerCount('turn_end')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

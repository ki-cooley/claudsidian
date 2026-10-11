// Tests for Notifications (src/obsidian/notifications.ts): notices for turn_end and needs_input only while
// the view is hidden and the setting is on, deduped per session and event within five seconds.
import { describe, expect, it, vi } from 'vitest';
import { DEDUPE_MS, Notifications } from '../../src/obsidian/notifications';
import { FakeStore } from '../ui/shell-fakes';

function setup(opts: { enabled?: boolean; visible?: boolean } = {}) {
  const store = new FakeStore();
  const state = { enabled: opts.enabled ?? true, visible: opts.visible ?? false, now: 1_000_000 };
  const notice = vi.fn<(text: string) => void>();
  const notifications = new Notifications(store, {
    enabled: () => state.enabled,
    isViewVisible: () => state.visible,
    sessionTitle: (id) => (id === 'cse_1' ? 'Menu work' : id),
    notice,
    now: () => state.now,
  });
  return { store, state, notice, notifications };
}

describe('Notifications', () => {
  it('shows a notice for turn_end and needs_input while hidden and enabled', () => {
    const { store, notice } = setup();
    store.emit('turn_end', 'cse_1');
    store.emit('needs_input', 'cse_1');
    expect(notice.mock.calls.map((c) => c[0])).toEqual(['Menu work: finished', 'Menu work: needs you']);
  });

  it('stays quiet while the view is visible', () => {
    const { store, notice, state } = setup({ visible: true });
    store.emit('turn_end', 'cse_1');
    store.emit('needs_input', 'cse_1');
    expect(notice).not.toHaveBeenCalled();
    state.visible = false;
    store.emit('turn_end', 'cse_1');
    expect(notice).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when notifications are off', () => {
    const { store, notice } = setup({ enabled: false });
    store.emit('turn_end', 'cse_1');
    store.emit('needs_input', 'cse_1');
    expect(notice).not.toHaveBeenCalled();
  });

  it('dedupes the same session and event within five seconds', () => {
    const { store, notice, state } = setup();
    store.emit('turn_end', 'cse_1');
    state.now += DEDUPE_MS - 1;
    store.emit('turn_end', 'cse_1');
    expect(notice).toHaveBeenCalledTimes(1);
    state.now += 1;
    store.emit('turn_end', 'cse_1');
    expect(notice).toHaveBeenCalledTimes(2);
  });

  it('does not dedupe across events or sessions', () => {
    const { store, notice } = setup();
    store.emit('turn_end', 'cse_1');
    store.emit('needs_input', 'cse_1');
    store.emit('turn_end', 'cse_2');
    expect(notice.mock.calls.map((c) => c[0])).toEqual(['Menu work: finished', 'Menu work: needs you', 'cse_2: finished']);
  });

  it('ignores error events', () => {
    const { store, notice } = setup();
    store.emit('error', 'cse_1');
    expect(notice).not.toHaveBeenCalled();
  });

  it('dispose unsubscribes from the store', () => {
    const { store, notice, notifications } = setup();
    expect(store.listenerCount('turn_end')).toBe(1);
    expect(store.listenerCount('needs_input')).toBe(1);
    notifications.dispose();
    expect(store.listenerCount('turn_end')).toBe(0);
    expect(store.listenerCount('needs_input')).toBe(0);
    store.emit('turn_end', 'cse_1');
    expect(notice).not.toHaveBeenCalled();
  });
});

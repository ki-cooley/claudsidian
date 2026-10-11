// Tests for Root (src/ui/components/Root.tsx): routing between the signed-out card, the sessions screen,
// and the chat screen; the shared new-session signal handed to the sessions screen; and the callbacks it
// wires to the store. The screens come from B1 and B2, so they are replaced by markers through the barrel.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signal, type Signal } from '@preact/signals';
import { act } from 'preact/test-utils';
import type { JSX } from 'preact';

vi.mock('../../src/ui/components/screens', () => ({
  SignedOutCard: (p: { facade: { signIn(): Promise<boolean> } }): JSX.Element => (
    <div class="fake-signed-out">
      <button class="sign-in" onClick={() => void p.facade.signIn()}>
        Sign in
      </button>
    </div>
  ),
  SessionsScreen: (p: {
    onOpen: (id: string) => void;
    onRename: (id: string) => void;
    onArchive: (id: string) => void;
    showNewSession?: Signal<boolean>;
  }): JSX.Element => (
    <div class="fake-sessions">
      <button class="open" onClick={() => p.onOpen('cse_1')}>
        open
      </button>
      <button class="rename" onClick={() => p.onRename('cse_2')}>
        rename
      </button>
      <button class="archive" onClick={() => p.onArchive('cse_2')}>
        archive
      </button>
      {p.showNewSession?.value && <div class="fake-sheet" />}
    </div>
  ),
  ChatScreen: (p: { sessionId: string; onBack: () => void; onRename: () => void; onArchive: () => void }): JSX.Element => (
    <div class="fake-chat" data-session={p.sessionId}>
      <button class="back" onClick={() => p.onBack()}>
        back
      </button>
      <button class="rename" onClick={() => p.onRename()}>
        rename
      </button>
      <button class="archive" onClick={() => p.onArchive()}>
        archive
      </button>
    </div>
  ),
}));

import { Root } from '../../src/ui/components/Root';
import { click, FakeAuth, FakeFacade, FakeStore, flush, mount, SIGNED_IN } from './shell-fakes';

function setup(opts: { signedIn?: boolean; selected?: string | null } = {}) {
  const store = new FakeStore();
  const facade = new FakeFacade(new FakeAuth(opts.signedIn === false ? null : SIGNED_IN));
  if (opts.selected) store.selectedId.value = opts.selected;
  const onRename = vi.fn();
  const onArchive = vi.fn();
  const showNewSession = signal(false);
  const mounted = mount(
    <Root store={store} facade={facade} onRename={onRename} onArchive={onArchive} showNewSession={showNewSession} />,
  );
  return { store, facade, onRename, onArchive, showNewSession, ...mounted };
}

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.replaceChildren();
});

describe('Root', () => {
  it('renders the signed-out card when there is no auth state', () => {
    const s = setup({ signedIn: false });
    cleanup = s.unmount;
    expect(s.root.querySelector('.fake-signed-out')).not.toBeNull();
    expect(s.root.querySelector('.fake-sessions')).toBeNull();
    expect(s.root.querySelector('.fake-chat')).toBeNull();
  });

  it('renders the sessions screen when signed in with no selection', () => {
    const s = setup();
    cleanup = s.unmount;
    expect(s.root.querySelector('.fake-sessions')).not.toBeNull();
    expect(s.root.querySelector('.fake-signed-out')).toBeNull();
    expect(s.root.querySelector('.fake-sheet')).toBeNull();
  });

  it('renders the chat screen for the selected session', () => {
    const s = setup({ selected: 'cse_1' });
    cleanup = s.unmount;
    const chat = s.root.querySelector('.fake-chat');
    expect(chat?.getAttribute('data-session')).toBe('cse_1');
    expect(s.root.querySelector('.fake-sessions')).toBeNull();
  });

  it('re-renders when the auth state changes', () => {
    const s = setup({ signedIn: false });
    cleanup = s.unmount;
    expect(s.root.querySelector('.fake-signed-out')).not.toBeNull();
    act(() => s.facade.auth.set(SIGNED_IN));
    expect(s.root.querySelector('.fake-signed-out')).toBeNull();
    expect(s.root.querySelector('.fake-sessions')).not.toBeNull();
    act(() => s.facade.auth.set(null));
    expect(s.root.querySelector('.fake-signed-out')).not.toBeNull();
  });

  it('signing in from the card switches to the sessions screen', async () => {
    const s = setup({ signedIn: false });
    cleanup = s.unmount;
    click(s.root.querySelector('.sign-in'));
    await flush();
    expect(s.facade.signInCalls).toBe(1);
    expect(s.root.querySelector('.fake-sessions')).not.toBeNull();
  });

  it('opening a session from the list calls store.open and shows the chat screen', async () => {
    const s = setup();
    cleanup = s.unmount;
    click(s.root.querySelector('.fake-sessions .open'));
    await flush();
    expect(s.store.calls).toContainEqual({ name: 'open', args: ['cse_1'] });
    expect(s.root.querySelector('.fake-chat')?.getAttribute('data-session')).toBe('cse_1');
  });

  it('passes rename and archive through with the session id from both screens', () => {
    const s = setup();
    cleanup = s.unmount;
    click(s.root.querySelector('.fake-sessions .rename'));
    click(s.root.querySelector('.fake-sessions .archive'));
    expect(s.onRename).toHaveBeenCalledWith('cse_2');
    expect(s.onArchive).toHaveBeenCalledWith('cse_2');
    act(() => {
      s.store.selectedId.value = 'cse_1';
    });
    click(s.root.querySelector('.fake-chat .rename'));
    click(s.root.querySelector('.fake-chat .archive'));
    expect(s.onRename).toHaveBeenLastCalledWith('cse_1');
    expect(s.onArchive).toHaveBeenLastCalledWith('cse_1');
  });

  it('back from the chat screen closes the session and returns to the list', () => {
    const s = setup({ selected: 'cse_1' });
    cleanup = s.unmount;
    click(s.root.querySelector('.fake-chat .back'));
    expect(s.store.names()).toContain('close');
    expect(s.root.querySelector('.fake-sessions')).not.toBeNull();
  });

  it('hands the shared new-session signal to the sessions screen', () => {
    const s = setup();
    cleanup = s.unmount;
    expect(s.root.querySelector('.fake-sheet')).toBeNull();
    act(() => {
      s.showNewSession.value = true;
    });
    expect(s.root.querySelector('.fake-sheet')).not.toBeNull();
    act(() => {
      s.showNewSession.value = false;
    });
    expect(s.root.querySelector('.fake-sheet')).toBeNull();
  });

  it('the signal reaches nothing while signed out or in a chat', () => {
    const s = setup({ signedIn: false });
    cleanup = s.unmount;
    act(() => {
      s.showNewSession.value = true;
    });
    expect(s.root.querySelector('.fake-sheet')).toBeNull();
    act(() => {
      s.facade.auth.set(SIGNED_IN);
      s.store.selectedId.value = 'cse_1';
    });
    expect(s.root.querySelector('.fake-sheet')).toBeNull();
    act(() => {
      s.store.selectedId.value = null;
    });
    expect(s.root.querySelector('.fake-sheet')).not.toBeNull();
  });

  it('unsubscribes from auth changes on unmount', () => {
    const s = setup();
    s.unmount();
    expect(() => s.facade.auth.set(null)).not.toThrow();
    expect(s.root.querySelector('.fake-signed-out')).toBeNull();
  });
});

// ChatScreen layout: the keyboard variable on mobile, quick-reply visibility, the pinned region (named by a
// hidden element, scrolled and focused on the header's request), banner dismissal, and the phone insets.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionSummary, TranscriptItem } from '../../../src/core/types';
import type { ClaudsidianSettings } from '../../../src/settings';
import { ChatScreen, KEYBOARD_VAR, VISIBLE_HEIGHT_VAR, keyboardInset, type ChatScreenProps } from '../../../src/ui/components/chat/ChatScreen';
import { SCROLL_TO_PENDING_EVENT } from '../../../src/ui/components/chat/ChatHeader';
import { resetDrafts } from '../../../src/ui/components/chat/drafts';
import { orderReplies } from '../../../src/ui/components/chat/QuickReplies';
import { Banner, type BannerProps } from '../../../src/ui/components/common/Banner';
import { phoneInsets } from '../../../src/ui/ChatView';
import { FakeFacade } from '../../helpers/fake-facade';
import { FakeStore, fakeSession, items, transcriptWith } from '../../helpers/fake-store';
import { buttonByText, maybe, mount, q, qa, text, tick, type Mounted } from './harness';

let mounted: Mounted<unknown>[] = [];
afterEach(() => {
  for (const m of mounted) m.unmount();
  mounted = [];
  resetDrafts();
});

const QUESTION = [
  {
    question: 'Does the dessert go in a bowl or on a plate?',
    header: 'Vessel',
    options: [{ label: 'Bowl', description: 'Serve the dessert in a bowl.' }, { label: 'Plate' }],
    multiSelect: false,
  },
];

interface Options {
  session?: Partial<SessionSummary>;
  settings?: Partial<ClaudsidianSettings>;
  isMobile?: boolean;
  pending?: boolean;
}

function setup(opts: Options = {}) {
  const session = fakeSession({ id: 'cse_1', title: 'Menu work', ...opts.session });
  const store = new FakeStore([session]);
  const list: TranscriptItem[] = [items.user('hi'), items.assistant('hello'), items.result()];
  if (opts.pending) list.push(items.question(QUESTION));
  store.setTranscript('cse_1', transcriptWith(list, { model: 'claude-opus-5-5', permissionMode: 'auto' }));
  const facade = new FakeFacade({ isMobile: opts.isMobile ?? false, settings: opts.settings });
  const props: ChatScreenProps = { store, facade, sessionId: 'cse_1', onBack: vi.fn(), onRename: vi.fn(), onArchive: vi.fn() };
  const m = mount(ChatScreen, props);
  mounted.push(m as Mounted<unknown>);
  return { ...m, store, facade, props };
}

/** A stand-in for window.visualViewport the test can resize. */
function fakeViewport(height: number, offsetTop = 0): EventTarget & { height: number; offsetTop: number } {
  const target = new EventTarget() as EventTarget & { height: number; offsetTop: number };
  target.height = height;
  target.offsetTop = offsetTop;
  return target;
}

describe('keyboard inset', () => {
  it('is the part of the screen below the visible viewport, never negative (zero when the app already shrank)', () => {
    expect(keyboardInset(800, { height: 500, offsetTop: 0 })).toBe(300);
    expect(keyboardInset(800, { height: 500, offsetTop: 100 })).toBe(200);
    expect(keyboardInset(800, { height: 800, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(500, { height: 800, offsetTop: 0 })).toBe(0);
  });

  it('on mobile the screen publishes --claudsidian-kb from visualViewport resizes and clears it on unmount', async () => {
    const viewport = fakeViewport(window.innerHeight);
    const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
    try {
      const { root, unmount } = setup({ isMobile: true });
      await tick();
      const screen = q<HTMLElement>(root, '.claudsidian-chat');
      let bottom = window.innerHeight;
      screen.getBoundingClientRect = () => ({ bottom }) as DOMRect;
      viewport.dispatchEvent(new Event('resize'));
      expect(screen.style.getPropertyValue(KEYBOARD_VAR)).toBe('0px');
      // the keyboard covers the bottom of a screen that did not shrink: lift the dock by the overlap
      viewport.height = window.innerHeight - 320;
      viewport.dispatchEvent(new Event('resize'));
      expect(screen.style.getPropertyValue(KEYBOARD_VAR)).toBe('320px');
      expect(screen.style.getPropertyValue(VISIBLE_HEIGHT_VAR)).toBe(`${window.innerHeight - 320}px`);
      // the app already shrank for the keyboard (iPad): nothing is hidden, so no second lift
      bottom = window.innerHeight - 320;
      viewport.dispatchEvent(new Event('resize'));
      expect(screen.style.getPropertyValue(KEYBOARD_VAR)).toBe('0px');
      bottom = window.innerHeight;
      viewport.height = window.innerHeight;
      viewport.dispatchEvent(new Event('resize'));
      expect(screen.style.getPropertyValue(KEYBOARD_VAR)).toBe('0px');
      unmount();
      mounted = mounted.filter((m) => m.root !== root);
    } finally {
      if (original) Object.defineProperty(window, 'visualViewport', original);
      else delete (window as unknown as Record<string, unknown>).visualViewport;
    }
  });

  it('on desktop nothing is published', async () => {
    const viewport = fakeViewport(window.innerHeight - 100);
    const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
    try {
      const { root } = setup({ isMobile: false });
      await tick();
      expect(q<HTMLElement>(root, '.claudsidian-chat').style.getPropertyValue(KEYBOARD_VAR)).toBe('');
    } finally {
      if (original) Object.defineProperty(window, 'visualViewport', original);
      else delete (window as unknown as Record<string, unknown>).visualViewport;
    }
  });
});

describe('quick replies', () => {
  it('show in cooking mode while idle, send text without context, and "stop" interrupts instead of sending', async () => {
    const { root, store } = setup({ settings: { cookingMode: true, quickReplies: ['yes', 'stop', 'go ahead', 'what next?'] } });
    await tick();
    const bar = q(root, '.claudsidian-quick');
    expect(qa<HTMLButtonElement>(bar, 'button').map((b) => text(b))).toEqual(['yes', 'go ahead', 'what next?', 'stop']);
    expect(bar.getAttribute('aria-label')).toBeNull();
    expect(bar.getAttribute('aria-labelledby')).toBeTruthy();
    buttonByText(bar, 'go ahead').click();
    await tick();
    expect(store.lastSend()).toMatchObject({ text: 'go ahead' });
    expect(store.lastSend()?.opts?.contextText).toBeUndefined();
    // the fake store marks the turn as sending after a send, so the bar is gone until the turn ends
    expect(maybe(root, '.claudsidian-quick')).toBeNull();
    store.patchTranscript('cse_1', { turn: 'idle' });
    await tick();
    buttonByText(q(root, '.claudsidian-quick'), 'stop').click();
    await tick();
    expect(store.callsTo('interrupt')).toEqual([['cse_1']]);
    expect(store.callsTo('send')).toHaveLength(1);
  });

  it('hide mid-turn and show while a question is pending; never outside cooking mode', async () => {
    const working = setup({ settings: { cookingMode: true } });
    working.store.patchTranscript('cse_1', { turn: 'working' });
    await tick();
    expect(maybe(working.root, '.claudsidian-quick')).toBeNull();
    const pending = setup({ settings: { cookingMode: true }, pending: true });
    await tick();
    expect(maybe(pending.root, '.claudsidian-quick')).not.toBeNull();
    const plain = setup({ pending: true });
    await tick();
    expect(maybe(plain.root, '.claudsidian-quick')).toBeNull();
  });

  it('orders "stop" last whatever the settings say and drops blanks and duplicates', () => {
    expect(orderReplies(['yes', 'stop', ' go ahead ', '', 'Stop', 'yes'])).toEqual(['yes', 'go ahead', 'stop']);
  });
});

describe('pinned region', () => {
  it('holds the question card with every option, is named by a hidden element, and lives above the dock', async () => {
    const { root } = setup({ pending: true });
    await tick();
    const pinned = q(root, '.claudsidian-pinned');
    expect(pinned.getAttribute('aria-label')).toBeNull();
    const id = pinned.getAttribute('aria-labelledby');
    expect(text(document.getElementById(id!))).toBe('Waiting for you');
    expect(qa(pinned, '.claudsidian-option').map((o) => text(q(o, '.claudsidian-option-label')))).toEqual(['Bowl', 'Plate']);
    expect(pinned.nextElementSibling?.classList.contains('claudsidian-dock')).toBe(true);
  });

  it('the header request scrolls the pinned region to its top and focuses the first option', async () => {
    const { root } = setup({ pending: true });
    await tick();
    const pinned = q<HTMLElement>(root, '.claudsidian-pinned');
    pinned.scrollTop = 40;
    document.dispatchEvent(new CustomEvent(SCROLL_TO_PENDING_EVENT, { bubbles: true }));
    expect(pinned.scrollTop).toBe(0);
    expect(document.activeElement).toBe(qa(pinned, '.claudsidian-option')[0]);
  });
});

describe('banner', () => {
  it('can be dismissed, stays dismissed for the same banner, and returns for a different one', async () => {
    const { root, store } = setup();
    store.banner.value = { kind: 'error', text: 'Session not found. It may have been archived.' };
    await tick();
    expect(text(q(root, '.claudsidian-banner'))).toContain('Session not found');
    q<HTMLButtonElement>(root, '.claudsidian-banner button[aria-label="Dismiss"]').click();
    await tick();
    expect(maybe(root, '.claudsidian-banner')).toBeNull();
    store.banner.value = { kind: 'error', text: 'Session not found. It may have been archived.' };
    await tick();
    expect(maybe(root, '.claudsidian-banner')).toBeNull();
    store.banner.value = { kind: 'offline', text: 'No connection. Retrying.' };
    await tick();
    expect(text(q(root, '.claudsidian-banner'))).toContain('No connection');
  });

  it('a cleared banner resets the dismissal, and the action button keeps its visible label without an aria-label', async () => {
    const run = vi.fn();
    const m = mount(Banner, { banner: { kind: 'auth', text: 'Signed out', action: { label: 'Sign in', run } } } satisfies BannerProps as BannerProps);
    mounted.push(m as Mounted<unknown>);
    const action = buttonByText(m.root, 'Sign in');
    expect(action.getAttribute('aria-label')).toBeNull();
    action.click();
    expect(run).toHaveBeenCalledTimes(1);
    q<HTMLButtonElement>(m.root, 'button[aria-label="Dismiss"]').click();
    await tick();
    expect(maybe(m.root, '.claudsidian-banner')).toBeNull();
    m.rerender({ banner: null });
    await tick();
    m.rerender({ banner: { kind: 'auth', text: 'Signed out' } });
    await tick();
    expect(maybe(m.root, '.claudsidian-banner')).not.toBeNull();
  });
});

describe('phone insets', () => {
  const view = { top: 100, bottom: 800, height: 700 };
  it('measure how far the floating header and navbar reach into the view', () => {
    expect(phoneInsets(view, { top: 40, bottom: 156, height: 116 }, { top: 740, bottom: 820, height: 80 })).toEqual({ top: 56, bottom: 60 });
  });
  it('are zero for chrome that sits outside the view, is not laid out, or overlaps absurdly', () => {
    expect(phoneInsets(view, { top: 40, bottom: 100, height: 60 }, { top: 800, bottom: 880, height: 80 })).toEqual({ top: 0, bottom: 0 });
    expect(phoneInsets(view, { top: 40, bottom: 156, height: 0 }, null)).toEqual({ top: 0, bottom: 0 });
    expect(phoneInsets(view, { top: 0, bottom: 700, height: 700 }, { top: 300, bottom: 900, height: 600 })).toEqual({ top: 0, bottom: 0 });
  });
});

// Composer: Enter behaviour per platform, send gating, @ and / popups, Stop while working, images.
import { signal, useSignal } from '@preact/signals';
import { h, type JSX } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutgoingAttachment } from '../../../src/core/types';

// jsdom has no canvas or object URLs; the attachment pipeline has its own tests (test/core/attachments.test.ts).
vi.mock('../../../src/core/attachments', () => ({
  prepareImage: vi.fn(async (file: File): Promise<OutgoingAttachment> => ({
    kind: 'image',
    name: file.name,
    mediaType: file.type,
    base64: 'AAAA',
    width: 1,
    height: 1,
    bytes: 4,
  })),
}));
import { Composer, STOP_GUARD_MS, type ComposerProps } from '../../../src/ui/components/chat/Composer';
import { DEFAULT_FILES, FakeFacade } from '../../helpers/fake-facade';
import { key, maybe, mount, q, qa, tick, type, type Mounted } from './harness';

interface Options {
  isMobile?: boolean;
  files?: string[];
  working?: boolean;
  disabled?: boolean;
  cooking?: boolean;
  initialDraft?: string;
}

let mounted: Mounted<unknown>[] = [];
afterEach(() => {
  for (const m of mounted) m.unmount();
  mounted = [];
});

/** The composer is controlled; this wrapper owns the draft the way ChatScreen does. */
function mountComposer(opts: Options = {}) {
  const facade = new FakeFacade({ isMobile: opts.isMobile ?? false, files: opts.files ?? DEFAULT_FILES });
  const onSend = vi.fn<(text: string, extras: { mentions: string[]; images: OutgoingAttachment[] }) => Promise<void>>(async () => {});
  const onStop = vi.fn();
  const onContextPreview = vi.fn();
  const drafts: string[] = [];
  function Harness(): JSX.Element {
    const draft = useSignal(opts.initialDraft ?? '');
    const props: ComposerProps = {
      facade,
      working: opts.working ?? false,
      disabled: opts.disabled ?? false,
      cooking: opts.cooking ?? false,
      draft: draft.value,
      onDraftChange: (v) => {
        drafts.push(v);
        draft.value = v;
      },
      onSend,
      onStop,
      onContextPreview,
    };
    return h(Composer, props);
  }
  const m = mount(Harness, {});
  mounted.push(m as Mounted<unknown>);
  const textarea = (): HTMLTextAreaElement => q<HTMLTextAreaElement>(m.root, 'textarea');
  return { ...m, facade, onSend, onStop, onContextPreview, drafts, textarea };
}

function sendButton(root: ParentNode): HTMLButtonElement {
  return q<HTMLButtonElement>(root, 'button[aria-label="Send"]');
}

describe('Composer', () => {
  it('composer enter behaviour', async () => {
    const desktop = mountComposer({ isMobile: false });
    type(desktop.textarea(), 'hello');
    await tick();
    expect(key(desktop.textarea(), 'Enter')).toBe(false); // default prevented: no newline, it sent
    await tick();
    expect(desktop.onSend).toHaveBeenCalledTimes(1);
    expect(desktop.onSend.mock.calls[0]?.[0]).toBe('hello');
    expect(desktop.onSend.mock.calls[0]?.[1]).toEqual({ mentions: [], images: [] });
    expect(desktop.textarea().value).toBe('');

    const mobile = mountComposer({ isMobile: true });
    type(mobile.textarea(), 'hello');
    await tick();
    expect(key(mobile.textarea(), 'Enter')).toBe(true); // the newline goes in, nothing sent
    await tick();
    expect(mobile.onSend).not.toHaveBeenCalled();
    expect(mobile.textarea().value).toBe('hello');

    type(desktop.textarea(), 'two');
    await tick();
    expect(key(desktop.textarea(), 'Enter', { shiftKey: true })).toBe(true);
    expect(key(mobile.textarea(), 'Enter', { shiftKey: true })).toBe(true);
    await tick();
    expect(desktop.onSend).toHaveBeenCalledTimes(1);
    expect(mobile.onSend).not.toHaveBeenCalled();
  });

  it('on mobile the Send button sends and Cmd+Enter sends everywhere', async () => {
    const mobile = mountComposer({ isMobile: true });
    type(mobile.textarea(), 'from the ipad');
    await tick();
    sendButton(mobile.root).click();
    await tick();
    expect(mobile.onSend).toHaveBeenCalledWith('from the ipad', { mentions: [], images: [] });
    type(mobile.textarea(), 'again');
    await tick();
    expect(key(mobile.textarea(), 'Enter', { metaKey: true })).toBe(false);
    await tick();
    expect(mobile.onSend).toHaveBeenCalledTimes(2);
  });

  it('disables Send until there is text, and never sends whitespace', async () => {
    const c = mountComposer();
    expect(sendButton(c.root).disabled).toBe(true);
    type(c.textarea(), '   ');
    await tick();
    expect(sendButton(c.root).disabled).toBe(true);
    key(c.textarea(), 'Enter');
    await tick();
    expect(c.onSend).not.toHaveBeenCalled();
    type(c.textarea(), 'go');
    await tick();
    expect(sendButton(c.root).disabled).toBe(false);
  });

  it('typing @men shows matching files, basename matches first, and picking inserts the path', async () => {
    const c = mountComposer({ files: ['components/dashi.md', 'menus/latitude 9/menu.md', 'notes/mention of menus.md', 'menus/latitude 10/menu.md'] });
    type(c.textarea(), 'see @men');
    await tick();
    const options = qa(c.root, '.claudsidian-suggest-item');
    expect(options.map((o) => o.textContent)).toEqual([
      'menus/latitude 10/menu.md',
      'menus/latitude 9/menu.md',
      'notes/mention of menus.md',
    ]);
    (options[0] as HTMLButtonElement).click();
    await tick();
    expect(c.textarea().value).toBe('see @menus/latitude 10/menu.md ');
    expect(maybe(c.root, '.claudsidian-suggest')).toBeNull();
    expect(c.onContextPreview).toHaveBeenLastCalledWith(['menus/latitude 10/menu.md']);

    key(c.textarea(), 'Enter');
    await tick();
    expect(c.onSend).toHaveBeenCalledWith('see @menus/latitude 10/menu.md', { mentions: ['menus/latitude 10/menu.md'], images: [] });
  });

  it('keyboard picks a mention and deleting it drops the mention', async () => {
    const c = mountComposer();
    type(c.textarea(), '@tare');
    await tick();
    expect(qa(c.root, '.claudsidian-suggest-item').map((o) => o.textContent)).toEqual(['recipes/tare.md']);
    expect(key(c.textarea(), 'Enter')).toBe(false);
    await tick();
    expect(c.textarea().value).toBe('@recipes/tare.md ');
    expect(c.onSend).not.toHaveBeenCalled();
    type(c.textarea(), 'plain text');
    await tick();
    expect(c.onContextPreview).toHaveBeenLastCalledWith([]);
  });

  it('caps the popup at eight matches and shows nothing for an email-like token', async () => {
    const many = Array.from({ length: 12 }, (_, i) => `notes/m${i}.md`);
    const c = mountComposer({ files: many });
    type(c.textarea(), '@m');
    await tick();
    expect(qa(c.root, '.claudsidian-suggest-item')).toHaveLength(8);
    type(c.textarea(), 'mail ki@m');
    await tick();
    expect(maybe(c.root, '.claudsidian-suggest')).toBeNull();
  });

  it('typing /mo shows the slash popup and picking inserts the command', async () => {
    const c = mountComposer();
    type(c.textarea(), '/mo');
    await tick();
    const options = qa(c.root, '.claudsidian-suggest-item');
    expect(options.length).toBeGreaterThan(0);
    expect(options[0]?.textContent).toContain('/model');
    (options[0] as HTMLButtonElement).click();
    await tick();
    expect(c.textarea().value).toBe('/model ');
    type(c.textarea(), 'not a /command');
    await tick();
    expect(maybe(c.root, '.claudsidian-suggest')).toBeNull();
  });

  it('shows Stop while working and calls onStop', () => {
    const idle = mountComposer({ working: false });
    expect(maybe(idle.root, 'button[aria-label="Stop"]')).toBeNull();
    const working = mountComposer({ working: true });
    q<HTMLButtonElement>(working.root, 'button[aria-label="Stop"]').click();
    expect(working.onStop).toHaveBeenCalledTimes(1);
  });

  it('keeps Send in its slot after a send and holds Stop disabled for the guard window', async () => {
    vi.useFakeTimers();
    try {
      const facade = new FakeFacade({ isMobile: true });
      const onStop = vi.fn();
      const working = signal(false);
      // The store marks the turn as sending synchronously, so working flips before onSend resolves.
      const onSend = vi.fn(async () => {
        working.value = true;
      });
      function Harness(): JSX.Element {
        const draft = useSignal('go');
        return h(Composer, {
          facade,
          working: working.value,
          disabled: false,
          cooking: false,
          draft: draft.value,
          onDraftChange: (v: string) => (draft.value = v),
          onSend,
          onStop,
          onContextPreview: vi.fn(),
        } satisfies ComposerProps);
      }
      const m = mount(Harness, {});
      mounted.push(m as Mounted<unknown>);
      const actions = q(m.root, '.claudsidian-composer-actions');
      expect(actions.lastElementChild?.getAttribute('aria-label')).toBe('Send');

      sendButton(m.root).click();
      await vi.advanceTimersByTimeAsync(0);
      expect(onSend).toHaveBeenCalledTimes(1);
      // Same slot, still Send (disabled: the text went out), Stop beside it and disabled.
      expect(actions.lastElementChild?.getAttribute('aria-label')).toBe('Send');
      expect(sendButton(m.root).disabled).toBe(true);
      const stop = q<HTMLButtonElement>(m.root, 'button[aria-label="Stop"]');
      expect(stop.disabled).toBe(true);
      stop.click();
      sendButton(m.root).click();
      expect(onStop).not.toHaveBeenCalled();
      expect(onSend).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(STOP_GUARD_MS + 10);
      const armed = q<HTMLButtonElement>(m.root, 'button[aria-label="Stop"]');
      expect(armed.disabled).toBe(false);
      armed.click();
      expect(onStop).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('attaches picked images as thumbnails with remove buttons, four at most', async () => {
    const c = mountComposer();
    const png = (name: string) => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
    c.facade.pickImagesResult = [png('a.png'), png('b.png'), png('c.png'), png('d.png'), png('e.png')];
    q<HTMLButtonElement>(c.root, 'button[aria-label="Attach image"]').click();
    await tick();
    await tick();
    expect(qa(c.root, '.claudsidian-attachment')).toHaveLength(4);
    expect(sendButton(c.root).disabled).toBe(false);
    expect(c.facade.notices.some((n) => /4/.test(n))).toBe(true);
    qa<HTMLButtonElement>(c.root, '.claudsidian-attachment button')[0]?.click();
    await tick();
    expect(qa(c.root, '.claudsidian-attachment')).toHaveLength(3);
    sendButton(c.root).click();
    await tick();
    const extras = c.onSend.mock.calls[0]?.[1];
    expect(extras?.images).toHaveLength(3);
    expect(extras?.images[0]?.kind).toBe('image');
  });

  it('restores the draft when sending fails', async () => {
    const c = mountComposer();
    c.onSend.mockRejectedValueOnce(new Error('offline'));
    type(c.textarea(), 'keep me');
    await tick();
    key(c.textarea(), 'Enter');
    await tick();
    await tick();
    expect(c.textarea().value).toBe('keep me');
  });
});

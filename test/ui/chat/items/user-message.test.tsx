// UserMessage: injected turns (peer sessions, classifier stops, interruptions) collapse to a muted system
// line, pending messages read as sending, and the context badge expands to what was sent.
import { afterEach, describe, expect, it } from 'vitest';
import { classifyInjection, describeContext, UserMessage } from '../../../../src/ui/components/chat/items/UserMessage';
import { items } from '../../../helpers/fake-store';
import { maybe, mount, q, qa, text, tick, type Mounted } from '../harness';

let mounted: Mounted<unknown>[] = [];
afterEach(() => {
  for (const m of mounted) m.unmount();
  mounted = [];
});

function render(props: Parameters<typeof UserMessage>[0]) {
  const m = mount(UserMessage, props);
  mounted.push(m as Mounted<unknown>);
  return m.root;
}

const PEER =
  'Another Claude session sent a message:\n<cross-session-message from="uds:/tmp/cc-socks/1568.sock" from-name="daily digest (fork)">\nThanks, that matches.\n</cross-session-message>\n\nThis came from another Claude session.';

describe('classifyInjection', () => {
  it('recognises peer and system injections and leaves typed text alone', () => {
    expect(classifyInjection(PEER)).toEqual({ kind: 'peer', label: 'Message from another session' });
    expect(classifyInjection('<cross-session-message from="x">hi</cross-session-message>')?.kind).toBe('peer');
    expect(classifyInjection('Your response above was stopped by a safety classifier. Continue.')?.label).toBe('Stopped by a safety classifier');
    expect(classifyInjection('[Request interrupted by user]')?.label).toBe('Request interrupted');
    expect(classifyInjection('<channel source="telegram">hello</channel>')?.label).toBe('Message from a channel');
    expect(classifyInjection('whats left on this for tomorrow')).toBeUndefined();
    expect(classifyInjection('I read <cross-session-message> docs today')).toBeUndefined();
  });
});

describe('UserMessage', () => {
  it('renders a peer message as a collapsed system line that expands on tap, never as a bubble', async () => {
    const root = render({ item: items.user(PEER) });
    expect(maybe(root, '.claudsidian-user-bubble')).toBeNull();
    const line = q(root, '.claudsidian-system.is-injected');
    expect(text(line)).toBe('Message from another session');
    q<HTMLButtonElement>(line, '.claudsidian-system-toggle').click();
    await tick();
    expect(text(q(root, '.claudsidian-system-body'))).toContain('Thanks, that matches.');
  });

  it('renders a pending message muted with a Sending label', () => {
    const root = render({ item: items.user('hello'), pending: true });
    expect(q(root, '.claudsidian-user').classList.contains('is-pending')).toBe(true);
    expect(text(q(root, '.claudsidian-user-pending'))).toBe('Sending...');
    const settled = render({ item: items.user('hello') });
    expect(maybe(settled, '.claudsidian-user-pending')).toBeNull();
  });

  it('says Queued once the server accepted the send and the echo has not landed', () => {
    const item = { ...items.user('and the day after?'), pending: true, queued: true } as ReturnType<typeof items.user>;
    expect(text(q(render({ item }), '.claudsidian-user-pending'))).toBe('Queued');
  });

  it('reads the pending flag off the item when the store sets it', () => {
    const item = { ...items.user('hello'), pending: true } as ReturnType<typeof items.user>;
    expect(q(render({ item }), '.claudsidian-user').classList.contains('is-pending')).toBe(true);
  });

  it('expands With context to the note, selection range and cursor line that were sent', async () => {
    const context = ['[Obsidian context]', 'active note: menus/latitude 10/prep-rd-2026-10-18.md (cursor line 10)', 'selection (lines 10-13):', '"""', 'secret selection text', '"""', 'open notes: a.md, b.md'].join('\n');
    const root = render({ item: items.user(`whats left\n\n${context}`) });
    expect(text(q(root, '.claudsidian-user-text'))).toBe('whats left');
    const badge = q<HTMLButtonElement>(root, '.claudsidian-badge.is-button');
    expect(text(badge)).toBe('With context');
    badge.click();
    await tick();
    const lines = qa(root, '.claudsidian-user-context-line').map((el) => `${text(q(el, 'dt'))} ${text(q(el, 'dd'))}`);
    expect(lines).toEqual(['Note menus/latitude 10/prep-rd-2026-10-18.md', 'Cursor line 10', 'Selection lines 10-13', 'Open a.md, b.md']);
    expect(root.textContent).not.toContain('secret selection text');
  });

  it('describeContext skips fenced selection text and the header', () => {
    expect(describeContext('[Obsidian context]\nvault: yes-chef (/v)\nmentioned: @a.md')).toEqual([
      { label: 'Vault', value: 'yes-chef (/v)' },
      { label: 'Mentioned', value: '@a.md' },
    ]);
  });
});

// Transcript rows: the working line under the last item, vault-relative tool rows with cd stripped,
// consecutive identical tool rows folded with a count, peer turns as system lines, pending user turns,
// no footer after a normal turn, and the Needs you request scrolling an inline card into view.
import { h } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCROLL_TO_PENDING_EVENT } from '../../../src/ui/components/chat/ChatHeader';
import { groupRows, Transcript, workingLine, type TranscriptProps } from '../../../src/ui/components/chat/Transcript';
import { DEFAULT_SETTINGS } from '../../../src/settings';
import { FakeFacade } from '../../helpers/fake-facade';
import { items, transcriptWith } from '../../helpers/fake-store';
import { maybe, mount, q, qa, text, tick, type Mounted } from './harness';

const VAULT = DEFAULT_SETTINGS.vaultPathOnMac;

let mounted: Mounted<unknown>[] = [];
afterEach(() => {
  for (const m of mounted) m.unmount();
  mounted = [];
});

function Rooted(p: TranscriptProps) {
  return h('div', { class: 'claudsidian-root' }, h(Transcript, p));
}

function setup(overrides: Partial<TranscriptProps> = {}) {
  const facade = new FakeFacade();
  const props: TranscriptProps = {
    state: transcriptWith([]),
    facade,
    cooking: false,
    showThinking: true,
    showCosts: false,
    showSubagents: false,
    onAllow: vi.fn(),
    onDeny: vi.fn(),
    onAnswer: vi.fn(),
    ...overrides,
  };
  const m = mount(Rooted, props);
  mounted.push(m as Mounted<unknown>);
  return { ...m, facade, props };
}

describe('working line', () => {
  it('appears under the last item while the turn works, with the running tool named', async () => {
    const afterUser = setup({ state: transcriptWith([items.user('go')], { turn: 'working' }) });
    await tick();
    const line = q(afterUser.root, '.claudsidian-working');
    expect(line.previousElementSibling?.getAttribute('data-kind')).toBe('user');
    expect(qa(line, '.claudsidian-working-dots span')).toHaveLength(3);
    expect(maybe(line, '.claudsidian-working-text')).toBeNull();

    const running = items.tool('Read', { file_path: `${VAULT}/prep-rd-2026-10-18.md` }, { status: 'running' });
    const withTool = setup({ state: transcriptWith([items.user('go'), running], { turn: 'working' }) });
    await tick();
    expect(text(q(withTool.root, '.claudsidian-working-text'))).toBe('Reading prep-rd-2026-10-18.md');

    const sending = setup({ state: transcriptWith([items.user('go')], { turn: 'sending' }) });
    await tick();
    expect(maybe(sending.root, '.claudsidian-working')).not.toBeNull();
  });

  it('stays out of the way while text streams and once the turn is idle', async () => {
    const streaming = setup({ state: transcriptWith([items.user('go'), items.assistant('partial', { partial: true })], { turn: 'working' }) });
    await tick();
    expect(maybe(streaming.root, '.claudsidian-working')).toBeNull();
    const idle = setup({ state: transcriptWith([items.user('go'), items.assistant('done'), items.result()]) });
    await tick();
    expect(maybe(idle.root, '.claudsidian-working')).toBeNull();
    expect(workingLine(transcriptWith([], { turn: 'needs_input' }), [])).toBeUndefined();
  });
});

describe('tool rows', () => {
  it('shows vault-relative paths and drops the cd prefix from Bash', async () => {
    const edit = items.tool('Edit', { file_path: `${VAULT}/scripts/seed-prep.py`, old_string: 'a', new_string: 'b' });
    const bash = items.tool('Bash', { command: `cd "${VAULT}" && python3 scripts/render-prep-window.py 2026-10-12` });
    const { root } = setup({ state: transcriptWith([edit, bash, items.result()]) });
    await tick();
    const summaries = qa(root, '.claudsidian-tool-summary').map((el) => text(el));
    expect(summaries).toEqual(['Edit scripts/seed-prep.py', 'Bash: python3 scripts/render-prep-window.py 2026-10-12']);
    // the expanded card keeps the full command and reads the edit path relative too
    qa<HTMLButtonElement>(root, '.claudsidian-tool-row')[1]?.click();
    await tick();
    expect(q(root, '.claudsidian-tool-input pre').textContent).toContain(`cd "${VAULT}" &&`);
  });

  it('falls back to the session cwd from the list, then the init cwd, for sessions outside the vault', async () => {
    const read = items.tool('Read', { file_path: '/Users/ki/code/app/src/index.ts' });
    const { root } = setup({ state: transcriptWith([read, items.result()]), cwd: '/Users/ki/code/app' });
    await tick();
    expect(text(q(root, '.claudsidian-tool-summary'))).toBe('Read src/index.ts');
    const home = setup({ state: transcriptWith([read, items.result()]) });
    await tick();
    expect(text(q(home.root, '.claudsidian-tool-summary'))).toBe('Read ~/code/app/src/index.ts');
  });

  it('folds consecutive rows with the same summary into one row with a count, each call inside', async () => {
    const edits = [1, 2, 3, 4].map((i) => items.tool('Edit', { file_path: `${VAULT}/scripts/lint.py`, old_string: `a${i}`, new_string: `b${i}` }, { result: `ok ${i}` }));
    const other = items.tool('Edit', { file_path: `${VAULT}/other.md`, old_string: 'x', new_string: 'y' });
    const { root } = setup({ state: transcriptWith([items.user('go'), ...edits, other, items.result()]) });
    await tick();
    const rows = qa(root, '.claudsidian-item[data-kind="tool"]');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute('data-count')).toBe('4');
    expect(text(q(rows[0]!, '.claudsidian-tool-count'))).toBe('×4');
    expect(rows[1]?.getAttribute('data-count')).toBeNull();
    q<HTMLButtonElement>(rows[0]!, '.claudsidian-tool-row').click();
    await tick();
    const calls = qa(rows[0]!, '.claudsidian-tool-call');
    expect(calls).toHaveLength(4);
    expect(text(calls[3]!)).toContain('Call 4');
    expect(text(calls[3]!)).toContain('ok 4');
  });

  it('reports running or failed for a folded run and keeps its array identity between unchanged renders', () => {
    const a = items.tool('Bash', { command: 'npm test' });
    const b = items.tool('Bash', { command: 'npm test' }, { status: 'running' });
    const first = groupRows([a, b], []);
    expect(first[0]?.group).toHaveLength(2);
    const previous = new Map([[a.id, first[0]!.group!]]);
    const second = groupRows([a, b], [], previous);
    expect(second[0]?.group).toBe(first[0]?.group);
    const third = groupRows([a, { ...b, status: 'done' }], [], previous);
    expect(third[0]?.group).not.toBe(first[0]?.group);
  });
});

describe('user rows', () => {
  it('renders a peer injection as a system line and a typed message as a bubble', async () => {
    const peer = items.user('<cross-session-message from="x" from-name="daily digest (fork)">\nthanks\n</cross-session-message>');
    const { root } = setup({ state: transcriptWith([peer, items.user('typed'), items.result()]) });
    await tick();
    expect(qa(root, '.claudsidian-user-bubble')).toHaveLength(1);
    expect(text(q(root, '.claudsidian-system.is-injected'))).toBe('Message from another session');
  });

  it('renders an in-flight user message as pending until the echo clears it', async () => {
    const sent = items.user('whats left', { id: 'uuid-1' });
    const { root, props, rerender } = setup({ state: transcriptWith([sent], { turn: 'sending', inFlightUserUuids: ['uuid-1'] }) });
    await tick();
    const row = q(root, '.claudsidian-item[data-kind="user"]');
    expect(row.classList.contains('is-pending')).toBe(true);
    expect(text(q(row, '.claudsidian-user-pending'))).toBe('Sending...');
    rerender({ ...props, state: transcriptWith([sent], { turn: 'working', inFlightUserUuids: [] }) });
    await tick();
    expect(maybe(root, '.claudsidian-user-pending')).toBeNull();
    expect(q(root, '.claudsidian-item[data-kind="user"]').classList.contains('is-pending')).toBe(false);
  });
});

describe('result rows', () => {
  it('renders no footer after a normal turn and keeps the error one', async () => {
    const { root } = setup({ state: transcriptWith([items.user('hi'), items.assistant('hello'), items.result({ durationMs: 5800 })]) });
    await tick();
    expect(q(root, '.claudsidian-item[data-kind="result"]').textContent).toBe('');
    expect(maybe(root, '.claudsidian-result')).toBeNull();
    const failed = setup({ state: transcriptWith([items.user('hi'), items.result({ subtype: 'error_during_execution', isError: true })]) });
    await tick();
    expect(text(q(failed.root, '.claudsidian-result'))).toContain('Stopped: error during execution');
  });
});

describe('scroll to pending', () => {
  it('scrolls an inline unresolved card into view when the root asks for it', async () => {
    const asked = items.question([{ question: 'Bowl or plate?', options: [{ label: 'Bowl' }, { label: 'Plate' }], multiSelect: false }]);
    const { root } = setup({ state: transcriptWith([items.user('hi'), asked]), pinPending: false });
    await tick();
    const card = q(root, '.claudsidian-question');
    const scrolled = vi.fn();
    (card as HTMLElement).scrollIntoView = scrolled;
    q(root, '.claudsidian-root').dispatchEvent(new CustomEvent(SCROLL_TO_PENDING_EVENT));
    expect(scrolled).toHaveBeenCalledTimes(1);
  });
});

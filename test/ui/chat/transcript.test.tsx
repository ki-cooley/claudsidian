// Transcript: one element per item kind, tool results inside the card, thinking toggle, pinned pending cards.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatScreen } from '../../../src/ui/components/chat/ChatScreen';
import { Transcript, type TranscriptProps } from '../../../src/ui/components/chat/Transcript';
import { FakeFacade } from '../../helpers/fake-facade';
import { FakeStore, fakeSession, items, transcriptWith } from '../../helpers/fake-store';
import { buttonByText, maybe, mount, q, qa, text, tick, type Mounted } from './harness';

let mounted: Mounted<unknown>[] = [];
afterEach(() => {
  for (const m of mounted) m.unmount();
  mounted = [];
});

function mountTranscript(overrides: Partial<TranscriptProps> = {}) {
  const facade = new FakeFacade();
  const props: TranscriptProps = {
    state: transcriptWith([]),
    facade,
    cooking: false,
    showThinking: true,
    showCosts: true,
    showSubagents: false,
    onAllow: vi.fn(),
    onDeny: vi.fn(),
    onAnswer: vi.fn(),
    ...overrides,
  };
  const m = mount(Transcript, props);
  mounted.push(m as Mounted<unknown>);
  return { ...m, facade, props };
}

const EVERY_KIND = [
  items.system('Session started in /Users/ki/yes-chef', 'init'),
  items.user('fix the typo in the tare recipe'),
  items.thinking('The recipe is at recipes/tare.md.'),
  items.assistant('Reading the recipe first.'),
  items.tool('Read', { file_path: '/Users/ki/yes-chef/recipes/tare.md' }, { result: '1\t# Tare\n2\t- 200 g mirn' }),
  items.permission('Bash', { command: 'npm test' }, { resolved: 'allow' }),
  items.question([{ question: 'Which?', options: [{ label: 'A' }], multiSelect: false }], { resolved: true, answers: { 'Which?': 'A' } }),
  items.result({ durationMs: 1200, costUsd: 0.0123 }),
  items.error('Assistant error: overloaded'),
];

describe('Transcript', () => {
  it('renders one element per item kind, in order', async () => {
    const { root } = mountTranscript({ state: transcriptWith(EVERY_KIND) });
    await tick();
    const kinds = qa(root, '.claudsidian-item').map((el) => el.getAttribute('data-kind'));
    expect(kinds).toEqual(['system', 'user', 'thinking', 'assistant_text', 'tool', 'permission', 'question', 'result', 'error']);
    expect(text(q(root, '.claudsidian-item[data-kind="user"]'))).toContain('fix the typo');
    expect(text(q(root, '.claudsidian-item[data-kind="assistant_text"]'))).toContain('Reading the recipe first.');
    expect(text(q(root, '.claudsidian-item[data-kind="result"]'))).toContain('1.2 s');
    expect(text(q(root, '.claudsidian-item[data-kind="result"]'))).toContain('$0.01');
    expect(text(q(root, '.claudsidian-item[data-kind="error"]'))).toContain('overloaded');
    expect(text(q(root, '.claudsidian-item[data-kind="system"]'))).toContain('Session started');
  });

  it('renders assistant text through the facade markdown renderer and marks partial text', async () => {
    const { root, facade } = mountTranscript({ state: transcriptWith([items.assistant('**bold** idea', { partial: true })]) });
    await tick();
    expect(facade.callsTo('renderMarkdown').map((a) => a[0])).toContain('**bold** idea');
    expect(q(root, '.claudsidian-item[data-kind="assistant_text"]').classList.contains('is-partial')).toBe(true);
  });

  it('shows tool results inside the tool card when expanded, never as bubbles', async () => {
    const tool = items.tool('Bash', { command: 'python3 scripts/render-prep-window.py' }, { result: 'Rendered 3 days: Wed 6.5 h' });
    const { root } = mountTranscript({ state: transcriptWith([tool, items.result()]) });
    await tick();
    expect(qa(root, '.claudsidian-item[data-kind="user"]')).toHaveLength(0);
    const card = q(root, '.claudsidian-tool');
    expect(text(card)).toContain('Bash: python3 scripts/render-prep-window.py');
    expect(maybe(card, '.claudsidian-tool-result')).toBeNull();
    q<HTMLButtonElement>(card, '.claudsidian-tool-row').click();
    await tick();
    expect(text(q(card, '.claudsidian-tool-result'))).toContain('Rendered 3 days');
    expect(text(q(card, '.claudsidian-tool-input'))).toContain('render-prep-window.py');
  });

  it('shows a running spinner and an error mark on tool cards', async () => {
    const running = items.tool('Grep', { pattern: 'mirin' }, { status: 'running' });
    const failed = items.tool('Bash', { command: 'false' }, { status: 'error', isError: true, result: 'exit 1' });
    const { root } = mountTranscript({ state: transcriptWith([running, failed]) });
    await tick();
    const cards = qa(root, '.claudsidian-tool');
    expect(cards[0]?.querySelector('.claudsidian-spinner')).not.toBeNull();
    expect(cards[1]?.classList.contains('is-error')).toBe(true);
  });

  it('hides thinking when showThinking is off and collapses it otherwise', async () => {
    const state = transcriptWith([items.thinking('private reasoning'), items.assistant('answer')]);
    const hidden = mountTranscript({ state, showThinking: false });
    await tick();
    expect(qa(hidden.root, '.claudsidian-item[data-kind="thinking"]')).toHaveLength(0);
    expect(text(hidden.root)).not.toContain('private reasoning');

    const shown = mountTranscript({ state, showThinking: true });
    await tick();
    const block = q(shown.root, '.claudsidian-item[data-kind="thinking"]');
    expect(text(block)).toContain('Thinking');
    expect(maybe(block, '.claudsidian-thinking-body')).toBeNull();
    buttonByText(block, 'Thinking').click();
    await tick();
    expect(text(q(block, '.claudsidian-thinking-body'))).toContain('private reasoning');
  });

  it('nests subagent traffic only when showSubagents is on', async () => {
    const child = items.assistant('child text', { parentToolUseId: 'agent-1' });
    const agent = items.tool('Agent', { description: 'search the vault' }, { id: 'agent-1', children: [child, items.tool('Read', { file_path: 'a.md' })] });
    const off = mountTranscript({ state: transcriptWith([agent]) });
    await tick();
    q<HTMLButtonElement>(off.root, '.claudsidian-tool-row').click();
    await tick();
    expect(text(off.root)).toContain('2 subagent events');
    expect(text(off.root)).not.toContain('child text');

    const on = mountTranscript({ state: transcriptWith([agent]), showSubagents: true });
    await tick();
    q<HTMLButtonElement>(on.root, '.claudsidian-tool-row').click();
    await tick();
    expect(text(q(on.root, '.claudsidian-tool-children'))).toContain('child text');
  });

  it('hides costs when showCosts is off and lists result errors', async () => {
    const { root } = mountTranscript({ state: transcriptWith([items.result({ subtype: 'error_max_turns', isError: true, errors: ['Reached the turn limit'] })]), showCosts: false });
    await tick();
    const footer = q(root, '.claudsidian-item[data-kind="result"]');
    expect(text(footer)).not.toContain('$');
    expect(text(footer)).toContain('Reached the turn limit');
    expect(footer.classList.contains('is-error')).toBe(true);
  });

  it('pins unresolved permission and question cards above the composer', async () => {
    const store = new FakeStore([fakeSession({ id: 'cse_1', title: 'Menu work' })]);
    const pending = items.permission('Bash', { command: 'rm -rf build' });
    const asked = items.question([{ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: false }]);
    store.setTranscript('cse_1', transcriptWith([items.user('clean up'), pending, asked]));
    const facade = new FakeFacade();
    const m = mount(ChatScreen, { store, facade, sessionId: 'cse_1', onBack: vi.fn(), onRename: vi.fn(), onArchive: vi.fn() });
    mounted.push(m as Mounted<unknown>);
    await tick();
    const pinned = q(m.root, '.claudsidian-pinned');
    expect(pinned.querySelector('.claudsidian-permission')).not.toBeNull();
    expect(pinned.querySelector('.claudsidian-question')).not.toBeNull();
    const composer = q(m.root, '.claudsidian-composer');
    expect(pinned.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // the transcript keeps the request in the timeline, but only the pinned copy carries buttons
    expect(qa(m.root, 'button').filter((b) => b.textContent?.trim() === 'Allow')).toHaveLength(1);
    buttonByText(pinned, 'Allow').click();
    await tick();
    expect(store.callsTo('respondPermission')[0]).toEqual(['cse_1', pending.requestId, { behavior: 'allow' }]);
    expect(maybe(m.root, '.claudsidian-pinned .claudsidian-permission')).toBeNull();
  });
});

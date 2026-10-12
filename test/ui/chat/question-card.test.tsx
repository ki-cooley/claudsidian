// QuestionCard: answers record keyed by question, multi-select joins, Other text verbatim, submit gating.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionCard } from '../../../src/ui/components/chat/items/QuestionCard';
import { items } from '../../helpers/fake-store';
import { buttonByText, mount, q, qa, text, tick, type, type Mounted } from './harness';

/** Option buttons carry their description too, so match on the label element. */
function option(root: ParentNode, label: string): HTMLButtonElement {
  const el = qa<HTMLButtonElement>(root, '.claudsidian-option').find((b) => b.querySelector('.claudsidian-option-label')?.textContent === label);
  if (!el) throw new Error(`no option ${label}`);
  return el;
}

const QUESTIONS = [
  {
    question: 'Which direction for the dashi pairing?',
    header: 'Pairing',
    options: [{ label: 'Riesling', description: 'off-dry, bright' }, { label: 'Fino', description: 'saline, nutty' }],
    multiSelect: false,
  },
  {
    question: 'Which courses change?',
    options: [{ label: 'Dashi' }, { label: 'Tare' }, { label: 'Dessert' }],
    multiSelect: true,
  },
];

let mounted: Mounted<unknown>[] = [];
afterEach(() => {
  for (const m of mounted) m.unmount();
  mounted = [];
});

function setup(overrides: Parameters<typeof items.question>[1] = {}) {
  const item = items.question(QUESTIONS, overrides);
  const onSubmit = vi.fn();
  const m = mount(QuestionCard, { item, cooking: false, onSubmit });
  mounted.push(m as Mounted<unknown>);
  return { ...m, item, onSubmit };
}

describe('QuestionCard', () => {
  it('shows headers, questions and options, and keeps submit disabled until every question is answered', async () => {
    const { root } = setup();
    expect(text(root)).toContain('Pairing');
    expect(text(root)).toContain('Which direction for the dashi pairing?');
    expect(text(root)).toContain('saline, nutty');
    const submit = buttonByText(root, 'Send answers');
    expect(submit.disabled).toBe(true);
    option(root, 'Fino').click();
    await tick();
    expect(buttonByText(root, 'Send answers').disabled).toBe(true);
    option(root, 'Dashi').click();
    await tick();
    expect(buttonByText(root, 'Send answers').disabled).toBe(false);
  });

  it('builds the answers record and joins multi-select answers with a comma', async () => {
    const { root, onSubmit } = setup();
    option(root, 'Fino').click();
    option(root, 'Dashi').click();
    option(root, 'Tare').click();
    await tick();
    buttonByText(root, 'Send answers').click();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      'Which direction for the dashi pairing?': 'Fino',
      'Which courses change?': 'Dashi, Tare',
    });
  });

  it('single select swaps the choice, multi select toggles it off again', async () => {
    const { root, onSubmit } = setup();
    option(root, 'Riesling').click();
    option(root, 'Fino').click();
    option(root, 'Dashi').click();
    option(root, 'Tare').click();
    option(root, 'Tare').click();
    await tick();
    expect(option(root, 'Fino').getAttribute('aria-pressed')).toBe('true');
    expect(option(root, 'Riesling').getAttribute('aria-pressed')).toBe('false');
    buttonByText(root, 'Send answers').click();
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      'Which direction for the dashi pairing?': 'Fino',
      'Which courses change?': 'Dashi',
    });
  });

  it('uses the Other text verbatim as the answer', async () => {
    const { root, onSubmit } = setup();
    const others = qa<HTMLInputElement>(root, '.claudsidian-question-other input');
    expect(others).toHaveLength(2);
    type(others[0]!, 'Manzanilla, if the fino is tired');
    option(root, 'Dessert').click();
    await tick();
    buttonByText(root, 'Send answers').click();
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({
      'Which direction for the dashi pairing?': 'Manzanilla, if the fino is tired',
      'Which courses change?': 'Dessert',
    });
  });

  it('collapses to the answers once resolved', () => {
    const { root } = setup({ resolved: true, answers: { 'Which direction for the dashi pairing?': 'Fino', 'Which courses change?': 'Dashi, Tare' } });
    expect(root.querySelectorAll('button')).toHaveLength(0);
    expect(text(q(root, '.claudsidian-question'))).toContain('Fino');
    expect(text(q(root, '.claudsidian-question'))).toContain('Dashi, Tare');
  });
});

describe('QuestionCard busy state', () => {
  it('disables the options and spins Send answers after a tap until the handler settles', async () => {
    let resolve: () => void = () => {};
    const onSubmit = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    const item = items.question(QUESTIONS);
    const m = mount(QuestionCard, { item, cooking: false, onSubmit });
    mounted.push(m as Mounted<unknown>);
    option(m.root, 'Fino').click();
    option(m.root, 'Dashi').click();
    await tick();
    buttonByText(m.root, 'Send answers').click();
    buttonByText(m.root, 'Send answers').click();
    await tick();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(buttonByText(m.root, 'Send answers').disabled).toBe(true);
    expect(buttonByText(m.root, 'Send answers').querySelector('.claudsidian-spinner')).not.toBeNull();
    expect(option(m.root, 'Fino').disabled).toBe(true);
    resolve();
    await tick();
    expect(buttonByText(m.root, 'Send answers').disabled).toBe(false);
    expect(option(m.root, 'Fino').disabled).toBe(false);
  });

  it('names the card and each option group through aria-labelledby, never aria-label', () => {
    const { root } = setup();
    expect(qa(root, '[aria-label]')).toHaveLength(0);
    const card = q(root, '.claudsidian-question');
    const kicker = card.getAttribute('aria-labelledby');
    expect(kicker).toMatch(/-kicker$/);
    expect(text(document.getElementById(kicker!))).toBe('Claude asks');
    const groups = qa(root, '.claudsidian-question-options');
    expect(groups.map((g) => text(document.getElementById(g.getAttribute('aria-labelledby')!)))).toEqual(QUESTIONS.map((qq) => qq.question));
  });
});

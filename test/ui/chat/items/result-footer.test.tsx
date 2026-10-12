// ResultFooter: nothing after a normal turn, one muted stats line with costs on, never "0 ms", errors kept.
import { afterEach, describe, expect, it } from 'vitest';
import { formatDuration, ResultFooter } from '../../../../src/ui/components/chat/items/ResultFooter';
import { items } from '../../../helpers/fake-store';
import { maybe, mount, q, text, type Mounted } from '../harness';

let mounted: Mounted<unknown>[] = [];
afterEach(() => {
  for (const m of mounted) m.unmount();
  mounted = [];
});

function render(item: Parameters<typeof ResultFooter>[0]['item'], showCosts = false) {
  const m = mount(ResultFooter, { item, showCosts });
  mounted.push(m as Mounted<unknown>);
  return m.root;
}

describe('ResultFooter', () => {
  it('renders nothing for a successful turn when costs are off', () => {
    const root = render(items.result({ durationMs: 5800, costUsd: 0.03, numTurns: 23 }));
    expect(maybe(root, '.claudsidian-result')).toBeNull();
    expect(root.textContent).toBe('');
  });

  it('renders one stats line with costs on, and nothing when the only stat would be 0 ms', () => {
    const root = render(items.result({ durationMs: 5800, costUsd: 0.03 }), true);
    expect(text(q(root, '.claudsidian-result'))).toBe('5.8 s, $0.03');
    expect(maybe(root, '.claudsidian-result-rule')).toBeNull();
    const zero = render(items.result({ durationMs: 0, costUsd: undefined }), true);
    expect(maybe(zero, '.claudsidian-result')).toBeNull();
  });

  it('keeps the error variant with its headline and errors, without a zero duration', () => {
    const root = render(items.result({ subtype: 'error_max_turns', isError: true, durationMs: 0, errors: ['Reached the turn limit'] }));
    const el = q(root, '.claudsidian-result');
    expect(el.classList.contains('is-error')).toBe(true);
    expect(text(el)).toContain('Stopped: turn limit reached');
    expect(text(el)).toContain('Reached the turn limit');
    expect(text(el)).not.toContain('0 ms');
  });

  it('formatDuration treats zero and unknown as nothing to say', () => {
    expect(formatDuration(0)).toBe('');
    expect(formatDuration(undefined)).toBe('');
    expect(formatDuration(-5)).toBe('');
    expect(formatDuration(450)).toBe('450 ms');
    expect(formatDuration(1200)).toBe('1.2 s');
    expect(formatDuration(61_000)).toBe('1m 01s');
  });
});

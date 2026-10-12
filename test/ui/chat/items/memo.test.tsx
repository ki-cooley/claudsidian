// memoProps: a wrapped component skips renders when its value props are unchanged, even though the
// parent passes new closures every render, and the proxied callbacks still reach the latest closure.
import { h } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoProps, shallowEqualIgnoringFunctions } from '../../../../src/ui/components/chat/items/memo';
import { mount, q, tick, type Mounted } from '../harness';

let mounted: Mounted<unknown>[] = [];
afterEach(() => {
  for (const m of mounted) m.unmount();
  mounted = [];
});

interface Props {
  label: string;
  onPick: (value: string) => void;
}

describe('memoProps', () => {
  it('renders again only when a non-function prop changes', async () => {
    let renders = 0;
    const Inner = (p: Props) => {
      renders += 1;
      return h('button', { type: 'button', onClick: () => p.onPick(p.label) }, p.label);
    };
    const Memo = memoProps(Inner);
    const first = vi.fn();
    const m = mount(Memo, { label: 'one', onPick: first });
    mounted.push(m as Mounted<unknown>);
    expect(renders).toBe(1);

    const second = vi.fn();
    m.rerender({ label: 'one', onPick: second });
    await tick();
    expect(renders).toBe(1);
    // the DOM still holds the first render's handler, which proxies to the latest prop
    q<HTMLButtonElement>(m.root, 'button').click();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('one');

    m.rerender({ label: 'two', onPick: second });
    await tick();
    expect(renders).toBe(2);
    expect(m.root.textContent).toBe('two');
  });

  it('shallowEqualIgnoringFunctions compares values by identity and skips functions', () => {
    const a = { x: 1, items: [1], f: () => 1 };
    expect(shallowEqualIgnoringFunctions(a, { ...a, f: () => 2 })).toBe(true);
    expect(shallowEqualIgnoringFunctions(a, { ...a, items: [1] })).toBe(false);
    expect(shallowEqualIgnoringFunctions(a, { x: 1, f: a.f } as unknown as typeof a)).toBe(false);
  });
});

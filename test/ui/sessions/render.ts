// Small jsdom helpers for the sessions tests: mount a Preact tree and fire DOM events through act().
import { render, type ComponentChild } from 'preact';
import { act } from 'preact/test-utils';

export function mount(tree: ComponentChild): { root: HTMLElement; unmount: () => void } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  act(() => {
    render(tree, root);
  });
  return {
    root,
    unmount: () => {
      act(() => {
        render(null, root);
      });
      root.remove();
    },
  };
}

export function click(el: Element | null | undefined): void {
  if (!el) throw new Error('click target missing');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

export function setValue(el: Element | null | undefined, value: string): void {
  if (!el) throw new Error('input target missing');
  act(() => {
    (el as HTMLInputElement).value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

export function byText(root: ParentNode, selector: string, text: string): HTMLElement | undefined {
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).find((el) => el.textContent?.trim() === text);
}

export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Mounting and DOM helpers for the chat component tests (preact render into jsdom, no
 * testing-library). Re-renders go through preact's microtask queue, so tests await tick().
 */
import { h, options, render, type ComponentType } from 'preact';

// preact flushes effects after a frame (requestAnimationFrame, up to 100 ms); run them on the next
// macrotask instead so tick() below is enough to observe them.
(options as { requestAnimationFrame?: (cb: () => void) => void }).requestAnimationFrame = (cb) => {
  setTimeout(cb, 0);
};

export interface Mounted<P> {
  root: HTMLElement;
  rerender(props: P): void;
  unmount(): void;
}

export function mount<P>(Comp: ComponentType<P>, props: P): Mounted<P> {
  const root = document.createElement('div');
  document.body.appendChild(root);
  render(h(Comp as ComponentType<Record<string, unknown>>, props as Record<string, unknown>), root);
  return {
    root,
    rerender(next: P) {
      render(h(Comp as ComponentType<Record<string, unknown>>, next as Record<string, unknown>), root);
    },
    unmount() {
      render(null, root);
      root.remove();
    },
  };
}

/** Let preact render, run its effects, and let the promises those started settle. */
export async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export function q<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`no element matches ${selector}`);
  return el;
}

export function maybe<T extends Element = HTMLElement>(root: ParentNode, selector: string): T | null {
  return root.querySelector<T>(selector);
}

export function qa<T extends Element = HTMLElement>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

export function buttons(root: ParentNode): HTMLButtonElement[] {
  return qa<HTMLButtonElement>(root, 'button');
}

export function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const b = buttons(root).find((el) => el.textContent?.trim() === text);
  if (!b) throw new Error(`no button "${text}"; have: ${buttons(root).map((x) => JSON.stringify(x.textContent?.trim())).join(', ')}`);
  return b;
}

export function hasButton(root: ParentNode, text: string): boolean {
  return buttons(root).some((el) => el.textContent?.trim() === text);
}

/** Set a field's value the way typing does: value then an input event. */
export function type(el: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Dispatch a keydown; resolves true when the default was NOT prevented (the key would act normally). */
export function key(el: Element, key: string, init: KeyboardEventInit = {}): boolean {
  return el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

export function text(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

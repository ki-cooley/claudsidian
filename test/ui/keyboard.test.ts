// Unit tests for the mobile keyboard helpers (src/ui/keyboard.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installKeyboardDismiss, submitOnReturn } from '../../src/ui/keyboard';

function setup(): { root: HTMLElement; field: HTMLInputElement; text: HTMLElement; button: HTMLButtonElement; area: HTMLTextAreaElement; keep: HTMLElement; remove: () => void } {
  document.body.innerHTML = `
    <div id="root">
      <p id="text">transcript text</p>
      <button id="button">Send</button>
      <div id="keep" data-keeps-keyboard><span id="pad">pad</span></div>
      <input id="field" type="text" />
      <textarea id="area"></textarea>
    </div>`;
  const root = document.getElementById('root')!;
  const remove = installKeyboardDismiss(root);
  return {
    root,
    field: document.getElementById('field') as HTMLInputElement,
    text: document.getElementById('text')!,
    button: document.getElementById('button') as HTMLButtonElement,
    area: document.getElementById('area') as HTMLTextAreaElement,
    keep: document.getElementById('pad')!,
    remove,
  };
}

function tap(el: Element): void {
  el.dispatchEvent(new Event('pointerdown', { bubbles: true }));
}

function touch(el: Element, type: string, y: number): void {
  const ev = new Event(type, { bubbles: true }) as Event & { touches: { clientX: number; clientY: number }[] };
  Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [{ clientX: 0, clientY: y }] });
  el.dispatchEvent(ev);
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('installKeyboardDismiss', () => {
  it('blurs on a tap outside any control, and keeps focus on a tap on a control or a kept surround', () => {
    const { field, text, button, keep } = setup();
    field.focus();
    tap(button);
    expect(document.activeElement).toBe(field);
    tap(keep);
    expect(document.activeElement).toBe(field);
    tap(field);
    expect(document.activeElement).toBe(field);
    tap(text);
    expect(document.activeElement).not.toBe(field);
  });

  it('blurs on a drag that starts outside the field, not on a short touch or a drag inside it', () => {
    const { area, text } = setup();
    area.focus();
    touch(text, 'touchstart', 100);
    touch(text, 'touchmove', 105);
    expect(document.activeElement).toBe(area);
    touch(area, 'touchstart', 100);
    touch(area, 'touchmove', 160);
    expect(document.activeElement).toBe(area);
    touch(text, 'touchstart', 100);
    touch(text, 'touchmove', 140);
    expect(document.activeElement).not.toBe(area);
  });

  it('blurs a single-line field on return unless its own handler took the key; never a textarea', () => {
    const { field, area } = setup();
    field.focus();
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const claimed = (ev: KeyboardEvent): void => ev.preventDefault();
    field.addEventListener('keydown', claimed);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(field);
    field.removeEventListener('keydown', claimed);
    field.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertLineBreak', bubbles: true, cancelable: true }));
    expect(document.activeElement).not.toBe(field);

    area.focus();
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(area);
  });

  it('stops listening once removed', () => {
    const { field, text, remove } = setup();
    remove();
    field.focus();
    tap(text);
    expect(document.activeElement).toBe(field);
  });
});

describe('submitOnReturn', () => {
  it('submits on an Enter keydown and on an inserted line break, and labels the key', () => {
    const field = document.createElement('input');
    document.body.append(field);
    const onSubmit = vi.fn();
    const remove = submitOnReturn(field, onSubmit, 'done');
    expect(field.enterKeyHint).toBe('done');
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    field.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: '\n', cancelable: true }));
    field.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'a', cancelable: true }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, cancelable: true }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
    remove();
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });
});

/**
 * Mobile keyboard handling shared by the view and the modals. iOS keeps the keyboard up until something
 * else takes focus, and neither a tap on plain text nor a scroll does that, so the keyboard covered the
 * buttons it was meant to reach. A tap on anything that is not a control, or a drag that starts outside
 * the focused field, now drops it, and so does return in a single-line field that has no other use for it.
 * Mark a field's surround with data-keeps-keyboard when a tap there should not count as outside.
 * submitOnReturn makes the return key act on keyboards that insert a line break instead of sending an
 * Enter keydown (third-party keyboards such as Wispr Flow).
 */

const TEXT_FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, [contenteditable=""], [contenteditable="true"]';
const CONTROL = `${TEXT_FIELD}, [data-keeps-keyboard], button, a[href], select, label, summary, [role=button], [role=menuitem], [role=option], [role=switch], [role=tab]`;
const SINGLE_LINE = 'input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit])';
/** a drag shorter than this is still a tap */
const DRAG_PX = 12;

function focusedField(): HTMLElement | null {
  const el = document.activeElement;
  return el instanceof HTMLElement && el.matches(TEXT_FIELD) ? el : null;
}

function isLineBreak(ev: InputEvent): boolean {
  return ev.inputType === 'insertLineBreak' || ev.inputType === 'insertParagraph' || (ev.inputType === 'insertText' && ev.data === '\n');
}

/**
 * Blurs the focused text field on a tap outside any control, on a drag that starts outside the field, and on
 * return in a single-line field whose own handler did not take it. Returns the remover.
 */
export function installKeyboardDismiss(root: HTMLElement): () => void {
  let start: { x: number; y: number } | null = null;

  const onPointerDown = (ev: PointerEvent): void => {
    const field = focusedField();
    const target = ev.target instanceof Element ? ev.target : null;
    if (!field || !target || field.contains(target)) return;
    if (target.closest(CONTROL)) return;
    field.blur();
  };
  const onTouchStart = (ev: TouchEvent): void => {
    const field = focusedField();
    const target = ev.target instanceof Node ? ev.target : null;
    const t = ev.touches[0];
    start = field && target && !field.contains(target) && t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchMove = (ev: TouchEvent): void => {
    const t = ev.touches[0];
    if (!start || !t) return;
    if (Math.abs(t.clientY - start.y) < DRAG_PX && Math.abs(t.clientX - start.x) < DRAG_PX) return;
    start = null;
    focusedField()?.blur();
  };
  const onTouchEnd = (): void => {
    start = null;
  };

  // bubble phase, so a field's own Enter handler runs first and claims the key with preventDefault
  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Enter' || ev.isComposing || ev.defaultPrevented) return;
    if (ev.target instanceof HTMLInputElement && ev.target.matches(SINGLE_LINE)) ev.target.blur();
  };
  const onBeforeInput = (ev: InputEvent): void => {
    if (ev.defaultPrevented || !isLineBreak(ev)) return;
    if (ev.target instanceof HTMLInputElement && ev.target.matches(SINGLE_LINE)) ev.target.blur();
  };

  root.addEventListener('pointerdown', onPointerDown, true);
  root.addEventListener('keydown', onKeyDown);
  root.addEventListener('beforeinput', onBeforeInput);
  root.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  root.addEventListener('touchmove', onTouchMove, { capture: true, passive: true });
  root.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
  root.addEventListener('touchcancel', onTouchEnd, { capture: true, passive: true });
  return () => {
    root.removeEventListener('pointerdown', onPointerDown, true);
    root.removeEventListener('keydown', onKeyDown);
    root.removeEventListener('beforeinput', onBeforeInput);
    root.removeEventListener('touchstart', onTouchStart, true);
    root.removeEventListener('touchmove', onTouchMove, true);
    root.removeEventListener('touchend', onTouchEnd, true);
    root.removeEventListener('touchcancel', onTouchEnd, true);
  };
}

/**
 * Runs onSubmit when return is pressed in a single-line field, whether the keyboard sends an Enter keydown
 * or inserts a line break, and labels the key ("go", "done", ...). Returns the remover.
 */
export function submitOnReturn(field: HTMLInputElement, onSubmit: () => void, hint: 'go' | 'done' | 'send' | 'search' = 'go'): () => void {
  field.enterKeyHint = hint;
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key !== 'Enter' || ev.isComposing) return;
    ev.preventDefault();
    onSubmit();
  };
  const onBeforeInput = (ev: InputEvent): void => {
    if (!isLineBreak(ev)) return;
    ev.preventDefault();
    onSubmit();
  };
  field.addEventListener('keydown', onKey);
  field.addEventListener('beforeinput', onBeforeInput);
  return () => {
    field.removeEventListener('keydown', onKey);
    field.removeEventListener('beforeinput', onBeforeInput);
  };
}

// Tap-target contract for the permission and question card buttons, checked against the real bundle
// (src/styles/index.css order) with a real cascade: specificity first, then source order. jsdom's
// getComputedStyle only honours source order, so it would have passed on the regression this guards
// against: cards.css's (0,3,1) 40 px rule loads after chat.css's (0,3,1) mobile 44 px rule and won the tie.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const STYLES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../src/styles');

/** Every file index.css imports, concatenated in its order, with the @import lines dropped. */
function bundledCss(): string {
  const index = readFileSync(resolve(STYLES, 'index.css'), 'utf8');
  const files = [...index.matchAll(/@import\s+'\.\/([^']+)';/g)].map((m) => m[1]!);
  expect(files.indexOf('chat.css')).toBeLessThan(files.indexOf('cards.css'));
  return files.map((f) => readFileSync(resolve(STYLES, f), 'utf8')).join('\n');
}

type Specificity = [ids: number, classes: number, elements: number];

/** Selector specificity per css-selectors-4: :where() adds nothing, :not()/:is() count their argument. */
function specificity(selector: string): Specificity {
  let s = selector.trim();
  s = s.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '');
  s = s.replace(/:(?:not|is)\(([^()]*)\)/g, ' $1');
  const count = (re: RegExp) => (s.match(re) ?? []).length;
  const ids = count(/#[\w-]+/g);
  const attrs = count(/\[[^\]]*\]/g);
  s = s.replace(/\[[^\]]*\]/g, '');
  const classes = count(/\.[\w-]+/g);
  const pseudoElements = count(/::[\w-]+/g);
  s = s.replace(/::[\w-]+/g, '');
  const pseudoClasses = count(/:[\w-]+/g);
  const elements = count(/(?:^|[\s>+~])[a-zA-Z][\w-]*/g);
  return [ids, attrs + classes + pseudoClasses, elements + pseudoElements];
}

function compare(a: Specificity, b: Specificity): number {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

/** Split a selector list on top-level commas only. */
function selectorList(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function matches(el: Element, selector: string): boolean {
  try {
    return el.matches(selector);
  } catch {
    return false;
  }
}

/** The declared value that wins the cascade for `property` on `el`: highest specificity, later source order on a tie. */
function cascaded(el: Element, sheet: CSSStyleSheet, property: string): { value: string; selector: string } {
  let best: { spec: Specificity; value: string; selector: string } | null = null;
  for (const rule of Array.from(sheet.cssRules)) {
    // grouping rules (@media prefers-reduced-motion) carry no sizes in this bundle
    if (!('selectorText' in rule) || !('style' in rule)) continue;
    const styleRule = rule as CSSStyleRule;
    const value = styleRule.style.getPropertyValue(property);
    if (!value) continue;
    let spec: Specificity | null = null;
    let selector = '';
    for (const part of selectorList(styleRule.selectorText)) {
      if (!matches(el, part)) continue;
      const s = specificity(part);
      if (!spec || compare(s, spec) > 0) {
        spec = s;
        selector = part;
      }
    }
    if (!spec) continue;
    if (!best || compare(spec, best.spec) >= 0) best = { spec, value, selector };
  }
  return best ? { value: best.value, selector: best.selector } : { value: '', selector: '' };
}

function el(tag: string, classes: (string | false | undefined)[]): HTMLElement {
  const node = document.createElement(tag);
  node.className = classes.filter(Boolean).join(' ');
  return node;
}

interface Scenario {
  mobile?: boolean;
  cooking?: boolean;
  kind?: 'permission' | 'question';
}

/** The DOM the cards really sit in: ChatView's view content > Root > ChatScreen > card > actions > button. */
function actionButton(s: Scenario): HTMLButtonElement {
  const view = el('div', ['claudsidian-view', s.mobile && 'is-mobile', s.cooking && 'is-cooking']);
  const root = el('div', ['claudsidian-root']);
  const chat = el('div', ['claudsidian-chat', s.mobile && 'is-mobile', s.cooking && 'is-cooking']);
  const card = el('div', [`claudsidian-${s.kind ?? 'permission'}`, s.cooking && 'is-cooking']);
  const actions = el('div', ['claudsidian-perm-actions']);
  const button = el('button', ['claudsidian-btn']) as HTMLButtonElement;
  button.type = 'button';
  button.textContent = 'Allow';
  actions.appendChild(button);
  card.appendChild(actions);
  chat.appendChild(card);
  root.appendChild(chat);
  view.appendChild(root);
  document.body.appendChild(view);
  return button;
}

let styleEl: HTMLStyleElement | null = null;
function sheet(): CSSStyleSheet {
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.textContent = bundledCss();
    document.head.appendChild(styleEl);
  }
  return styleEl.sheet!;
}

afterEach(() => {
  document.body.innerHTML = '';
  styleEl?.remove();
  styleEl = null;
});

describe('specificity helper', () => {
  it('scores the three selectors the review compared', () => {
    expect(specificity('.claudsidian-chat .claudsidian-perm-actions button.claudsidian-btn')).toEqual([0, 3, 1]);
    expect(specificity('.claudsidian-chat.is-mobile button.claudsidian-btn')).toEqual([0, 3, 1]);
    expect(specificity('.claudsidian-chat.is-mobile .claudsidian-perm-actions button.claudsidian-btn')).toEqual([0, 4, 1]);
    expect(specificity('.claudsidian-view.is-mobile .claudsidian-root :where(button:not(.clickable-icon))')).toEqual([0, 3, 0]);
    expect(specificity('.claudsidian-chat button.claudsidian-btn:hover:not(:disabled)')).toEqual([0, 4, 1]);
  });
});

describe('card action buttons: min-height through the whole bundle', () => {
  it('is 40 px on desktop', () => {
    expect(cascaded(actionButton({}), sheet(), 'min-height').value).toBe('40px');
  });

  it('is 44 px on mobile for the permission card (the 40 px desktop rule must not win the tie by source order)', () => {
    const win = cascaded(actionButton({ mobile: true }), sheet(), 'min-height');
    expect(win.value).toBe('44px');
    expect(win.selector).toBe('.claudsidian-chat.is-mobile .claudsidian-perm-actions button.claudsidian-btn');
  });

  it('is 44 px on mobile for the question card (Send answers)', () => {
    expect(cascaded(actionButton({ mobile: true, kind: 'question' }), sheet(), 'min-height').value).toBe('44px');
  });

  it('cooking mode still wins at 56 px, on desktop and on mobile, for both cards', () => {
    expect(cascaded(actionButton({ cooking: true }), sheet(), 'min-height').value).toBe('56px');
    expect(cascaded(actionButton({ mobile: true, cooking: true }), sheet(), 'min-height').value).toBe('56px');
    expect(cascaded(actionButton({ mobile: true, cooking: true, kind: 'question' }), sheet(), 'min-height').value).toBe('56px');
  });

  it('cards.css declares the mobile rule after the desktop one, at (0,4,1)', () => {
    const cards = readFileSync(resolve(STYLES, 'cards.css'), 'utf8');
    const desktop = cards.indexOf('.claudsidian-chat .claudsidian-perm-actions button.claudsidian-btn {');
    const mobile = cards.indexOf('.claudsidian-chat.is-mobile .claudsidian-perm-actions button.claudsidian-btn {');
    expect(desktop).toBeGreaterThan(-1);
    expect(mobile).toBeGreaterThan(desktop);
    expect(cards.slice(mobile).match(/\{([^}]*)\}/)![1]).toMatch(/min-height:\s*44px/);
  });
});

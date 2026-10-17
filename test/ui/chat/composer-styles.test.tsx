// The composer dock's cascade, checked against the real bundle (src/styles/index.css order) with the real
// Composer mounted under the production wrapper classes. jsdom's getComputedStyle applies matching rules in
// source order only (no specificity), which is exactly the axis these contracts live on, so this file
// resolves each property itself: importance, then specificity, then source order, over the rules whose
// selectors jsdom says match the element.
//
// Contracts: the @ and image tools are 28 px ghost icons on desktop and 44 px on any touch device, cooking
// mode included (the iPad in the kitchen); only a desktop pane in cooking mode shrinks them to 32 px. The
// Send/Stop slot keeps its own width (36 / 44 / 56) over chat.css's generic .is-icon rule, and Stop is an
// outlined square with the danger colour on the icon, also under the pointer, over chat.css's .is-ghost.
import { useSignal } from '@preact/signals';
import { h, type JSX } from 'preact';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer, type ComposerProps } from '../../../src/ui/components/chat/Composer';
import { FakeFacade } from '../../helpers/fake-facade';
import { mount, q, type Mounted } from './harness';

const STYLES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/styles');

/** Every file index.css imports, concatenated in its order, with the @import lines dropped. */
function bundledCss(): string {
  const index = readFileSync(resolve(STYLES, 'index.css'), 'utf8');
  const files = [...index.matchAll(/@import\s+'\.\/([^']+)';/g)].map((m) => m[1]!);
  expect(files).toContain('chat.css');
  expect(files).toContain('composer.css');
  expect(files.indexOf('composer.css')).toBeGreaterThan(files.indexOf('chat.css'));
  return files.map((f) => readFileSync(resolve(STYLES, f), 'utf8')).join('\n');
}

// ---- a small cascade: parse, match, rank ----------------------------------------------------------

interface Decl {
  value: string;
  important: boolean;
}
interface Rule {
  selectors: string[];
  decls: Map<string, Decl>;
  order: number;
  /** the enclosing @media / @supports prelude, when any (such rules are skipped: jsdom has no matchMedia) */
  group: string | null;
}

/** Split on a separator at paren depth 0 (`:not(a, b)` stays whole). */
function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === sep && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

function parseRules(css: string): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  let order = 0;
  const walk = (text: string, group: string | null): void => {
    let i = 0;
    for (;;) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const prelude = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      i = j;
      if (prelude.startsWith('@')) {
        if (/^@(media|supports|container|layer)\b/.test(prelude)) walk(body, group ?? prelude);
        continue; // @font-face, @keyframes and the like carry no element rules
      }
      if (!prelude) continue;
      const decls = new Map<string, Decl>();
      for (const part of splitTopLevel(body, ';')) {
        const colon = part.indexOf(':');
        if (colon < 0) continue;
        const prop = part.slice(0, colon).trim().toLowerCase();
        let value = part.slice(colon + 1).trim();
        const important = /!important$/i.test(value);
        if (important) value = value.replace(/\s*!important$/i, '');
        if (prop) decls.set(prop, { value, important });
      }
      rules.push({ selectors: splitTopLevel(prelude, ','), decls, order: order++, group });
    }
  };
  walk(src, null);
  return rules;
}

type Spec = [number, number, number];

function readIdent(s: string, i: number): number {
  while (i < s.length && /[\w-]/.test(s[i]!)) i++;
  return i;
}
function closingParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return i;
  }
  return s.length;
}
function maxSpec(a: Spec, b: Spec): Spec {
  for (let k = 0; k < 3; k++) if (a[k] !== b[k]) return a[k]! > b[k]! ? a : b;
  return a;
}

/** Selector specificity per css-selectors-4: :where() adds nothing, :not/:is/:has add their most specific argument. */
function specificity(selector: string): Spec {
  const s = selector.trim();
  let a = 0;
  let b = 0;
  let c = 0;
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '#') {
      a++;
      i = readIdent(s, i + 1);
    } else if (ch === '.') {
      b++;
      i = readIdent(s, i + 1);
    } else if (ch === '[') {
      b++;
      i = s.indexOf(']', i) + 1 || s.length;
    } else if (ch === ':') {
      if (s[i + 1] === ':') {
        c++;
        i = readIdent(s, i + 2);
        continue;
      }
      const start = i + 1;
      i = readIdent(s, start);
      const name = s.slice(start, i).toLowerCase();
      if (s[i] === '(') {
        const close = closingParen(s, i);
        const inner = s.slice(i + 1, close);
        i = close + 1;
        if (name === 'where') continue;
        if (name === 'not' || name === 'is' || name === 'has') {
          const [sa, sb, sc] = splitTopLevel(inner, ',').map(specificity).reduce(maxSpec, [0, 0, 0]);
          a += sa;
          b += sb;
          c += sc;
          continue;
        }
      }
      b++;
    } else if (/[A-Za-z_]/.test(ch)) {
      c++;
      i = readIdent(s, i);
    } else {
      i++; // combinators, whitespace, `*`
    }
  }
  return [a, b, c];
}

interface Candidate extends Decl {
  spec: Spec;
  order: number;
}
function beats(x: Candidate, y: Candidate): boolean {
  if (x.important !== y.important) return x.important;
  for (let k = 0; k < 3; k++) if (x.spec[k] !== y.spec[k]) return x.spec[k]! > y.spec[k]!;
  return x.order > y.order;
}

/**
 * The cascaded value of `prop` on `el`: the winning declaration among the rules whose selectors match.
 * `hover` treats `:hover` as satisfied (jsdom never matches it); without it, hover rules are left out.
 */
function cascaded(rules: Rule[], el: Element, prop: string, opts: { hover?: boolean } = {}): string | undefined {
  let best: Candidate | undefined;
  for (const rule of rules) {
    if (rule.group) continue;
    const decl = rule.decls.get(prop);
    if (!decl) continue;
    for (const sel of rule.selectors) {
      const hovers = sel.includes(':hover');
      if (hovers && !opts.hover) continue;
      let matches = false;
      try {
        matches = el.matches(hovers ? sel.replace(/:hover/g, '') : sel);
      } catch {
        matches = false; // a pseudo jsdom cannot evaluate (:focus-visible) never matches here
      }
      if (!matches) continue;
      const cand: Candidate = { ...decl, spec: specificity(sel), order: rule.order };
      if (!best || beats(cand, best)) best = cand;
    }
  }
  return best?.value;
}

// ---- mounting the real composer under the production wrappers -----------------------------------

interface Modes {
  mobile?: boolean;
  phone?: boolean;
  cooking?: boolean;
  working?: boolean;
}

let mounted: Mounted<unknown>[] = [];
afterEach(() => {
  for (const m of mounted) m.unmount();
  mounted = [];
});

/** .claudsidian-view > .claudsidian-root > .claudsidian-chat > .claudsidian-dock > Composer, classed as ChatView and ChatScreen do. */
function mountDock(modes: Modes = {}): HTMLElement {
  const facade = new FakeFacade({ isMobile: modes.mobile ?? false });
  const viewCls = ['claudsidian-view', modes.mobile ? 'is-mobile' : '', modes.phone ? 'is-phone' : '', modes.mobile && !modes.phone ? 'is-tablet' : '', modes.cooking ? 'is-cooking' : '']
    .filter(Boolean)
    .join(' ');
  const chatCls = ['claudsidian-chat', modes.cooking ? 'is-cooking' : '', modes.mobile ? 'is-mobile' : ''].filter(Boolean).join(' ');
  function Harness(): JSX.Element {
    const draft = useSignal('');
    const props: ComposerProps = {
      facade,
      working: modes.working ?? false,
      disabled: false,
      cooking: modes.cooking ?? false,
      draft: draft.value,
      onDraftChange: (v) => {
        draft.value = v;
      },
      onSend: vi.fn(async () => {}),
      onStop: vi.fn(),
      onContextPreview: vi.fn(),
    };
    return h('div', { class: viewCls }, h('div', { class: 'claudsidian-root' }, h('div', { class: chatCls }, h('div', { class: 'claudsidian-dock' }, h(Composer, props)))));
  }
  const m = mount(Harness, {});
  mounted.push(m as Mounted<unknown>);
  return m.root;
}

const rules = parseRules(bundledCss());
const tool = (root: ParentNode): HTMLElement => q(root, 'button[aria-label="Mention a note"]');
const send = (root: ParentNode): HTMLElement => q(root, 'button[aria-label="Send"]');
const stop = (root: ParentNode): HTMLElement => q(root, 'button[aria-label="Stop"]');
const DANGER = 'var(--text-error, var(--color-red))';

describe('composer cascade: specificity helpers', () => {
  it('ranks selectors the way the browser does', () => {
    expect(specificity('.claudsidian-chat button.claudsidian-btn.is-icon')).toEqual([0, 3, 1]);
    expect(specificity('.claudsidian-chat.is-mobile .claudsidian-composer-tools .claudsidian-btn.is-icon')).toEqual([0, 5, 0]);
    expect(specificity('.claudsidian-view.is-cooking :where(button)')).toEqual([0, 2, 0]);
    expect(specificity('.claudsidian-chat button.claudsidian-btn.is-ghost:hover:not(:disabled)')).toEqual([0, 5, 1]);
    expect(specificity('.a:not(:has(.x.y, .z)) button')).toEqual([0, 3, 1]);
    expect(specificity('#id .c::before')).toEqual([1, 1, 1]);
  });

  it('matches the generic chat.css rules against the mounted buttons (the competitors are real)', () => {
    const root = mountDock({ cooking: true, working: true });
    expect(stop(root).matches('.claudsidian-chat button.claudsidian-btn.is-ghost')).toBe(true);
    expect(stop(root).matches('.claudsidian-chat button.claudsidian-btn.is-icon')).toBe(true);
    expect(stop(root).matches('.claudsidian-view.is-cooking :where(button)')).toBe(true);
    expect(tool(root).matches('.claudsidian-chat.is-cooking button.claudsidian-btn.is-icon')).toBe(true);
  });
});

describe('composer tools (@ and image)', () => {
  it('are 28 px ghost icons on desktop', () => {
    const root = mountDock();
    const el = tool(root);
    expect(cascaded(rules, el, 'min-width')).toBe('28px');
    expect(cascaded(rules, el, 'min-height')).toBe('28px');
    expect(cascaded(rules, el, 'background')).toBe('transparent');
    expect(cascaded(rules, el, 'padding')).toBe('0');
  });

  it('are 44 px on a touch device', () => {
    for (const modes of [{ mobile: true }, { mobile: true, phone: true }]) {
      const el = tool(mountDock(modes));
      expect(cascaded(rules, el, 'min-width'), JSON.stringify(modes)).toBe('44px');
      expect(cascaded(rules, el, 'min-height'), JSON.stringify(modes)).toBe('44px');
    }
  });

  it('take 48 px kitchen targets in cooking mode, desktop pane or touch device', () => {
    for (const modes of [{ cooking: true }, { mobile: true, cooking: true }, { mobile: true, phone: true, cooking: true }]) {
      const el = tool(mountDock(modes));
      expect(cascaded(rules, el, 'min-width'), JSON.stringify(modes)).toBe('48px');
      expect(cascaded(rules, el, 'min-height'), JSON.stringify(modes)).toBe('48px');
      // centred on the 56 px field: (56 - 48) / 2
      expect(cascaded(rules, el, 'margin-bottom'), JSON.stringify(modes)).toBe('4px');
    }
  });
});

describe('Send/Stop slot', () => {
  it('keeps its own 36 px square on desktop over chat.css .is-icon', () => {
    const sendEl = send(mountDock());
    expect(cascaded(rules, sendEl, 'min-width')).toBe('36px');
    expect(cascaded(rules, sendEl, 'min-height')).toBe('36px');
    expect(cascaded(rules, sendEl, 'padding')).toBe('0');
    expect(cascaded(rules, sendEl, 'background')).toBe('var(--interactive-accent)');
    const stopEl = stop(mountDock({ working: true }));
    expect(cascaded(rules, stopEl, 'min-width')).toBe('36px');
    expect(cascaded(rules, stopEl, 'min-height')).toBe('36px');
    expect(cascaded(rules, stopEl, 'padding')).toBe('0');
  });

  it('is 44 px on mobile and 56 px in cooking mode, both states', () => {
    for (const [modes, px] of [
      [{ mobile: true }, '44px'],
      [{ cooking: true }, '56px'],
      [{ mobile: true, cooking: true }, '56px'],
    ] as const) {
      const sendEl = send(mountDock({ ...modes }));
      expect(cascaded(rules, sendEl, 'min-width'), JSON.stringify(modes)).toBe(px);
      expect(cascaded(rules, sendEl, 'min-height'), JSON.stringify(modes)).toBe(px);
      const stopEl = stop(mountDock({ ...modes, working: true }));
      expect(cascaded(rules, stopEl, 'min-width'), JSON.stringify(modes)).toBe(px);
      expect(cascaded(rules, stopEl, 'min-height'), JSON.stringify(modes)).toBe(px);
    }
  });

  it('renders Stop as an outlined square with the danger colour on the icon, over chat.css .is-ghost', () => {
    const el = stop(mountDock({ working: true }));
    expect(el.classList.contains('is-ghost')).toBe(true);
    expect(cascaded(rules, el, 'background')).toBe('transparent');
    expect(cascaded(rules, el, 'border')).toBe('1px solid var(--background-modifier-border)');
    expect(cascaded(rules, el, 'color')).toBe(DANGER);
    expect(cascaded(rules, el, 'box-shadow')).toBe('none');
  });

  it('keeps the danger colour on Stop under the pointer', () => {
    const el = stop(mountDock({ working: true }));
    expect(cascaded(rules, el, 'color', { hover: true })).toBe(DANGER);
    expect(cascaded(rules, el, 'border-color', { hover: true })).toBe(DANGER);
    expect(cascaded(rules, el, 'background', { hover: true })).toBe('var(--background-modifier-hover)');
  });
});

// Stylesheet contracts the sessions screen depends on, checked against the real bundle order (src/styles/index.css):
// the sessions sheet paints above its own backdrop whatever the other feature files declare, the button reset in
// base.css is one (0,2,1) selector that every sessions button rule outranks (computed specificity, because jsdom
// resolves the cascade by source order alone and would pass a broken mobile variant), and the mobile bottom
// padding reads Obsidian's safe-area variable before env().
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { h } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { Sheet } from '../../../src/ui/components/sessions/primitives';
import { mount } from './render';

const STYLES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/styles');

/** Every file index.css imports, concatenated in its order, with the @import lines dropped. */
function bundledCss(): string {
  const index = readFileSync(resolve(STYLES, 'index.css'), 'utf8');
  const files = [...index.matchAll(/@import\s+'\.\/([^']+)';/g)].map((m) => m[1]!);
  expect(files).toContain('sessions.css');
  expect(files).toContain('chat.css');
  return files.map((f) => readFileSync(resolve(STYLES, f), 'utf8')).join('\n');
}

function zIndexOf(el: Element): number {
  const value = getComputedStyle(el).zIndex;
  return value === 'auto' || value === '' ? 0 : Number(value);
}

let mounted: { unmount: () => void } | null = null;
let styleEl: HTMLStyleElement | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  styleEl?.remove();
  styleEl = null;
});

describe('sessions sheet stacking', () => {
  it('paints the sheet above its backdrop with the whole bundle loaded', () => {
    styleEl = document.createElement('style');
    styleEl.textContent = bundledCss();
    document.head.appendChild(styleEl);
    mounted = mount(
      h('div', { class: 'claudsidian-view claudsidian-sessions' }, h(Sheet, { title: 'New session', onClose: () => {} }, 'body')),
    );
    const root = (mounted as unknown as { root: HTMLElement }).root;
    const layer = root.querySelector('.claudsidian-ss-sheet-layer');
    const backdrop = root.querySelector('.claudsidian-ss-sheet-backdrop');
    const sheet = root.querySelector('.claudsidian-ss-sheet');
    expect(layer).not.toBeNull();
    expect(backdrop).not.toBeNull();
    expect(sheet).not.toBeNull();
    // Siblings inside one stacking context (the layer): the higher positioned z-index receives the tap.
    expect(backdrop!.parentElement).toBe(layer);
    expect(sheet!.parentElement).toBe(layer);
    expect(getComputedStyle(layer!).position).toBe('absolute');
    expect(getComputedStyle(backdrop!).position).toBe('absolute');
    expect(getComputedStyle(sheet!).position).not.toBe('static');
    expect(zIndexOf(sheet!)).toBeGreaterThan(zIndexOf(backdrop!));
  });

  it('keeps its class names out of the shared chat set', () => {
    const chat = readFileSync(resolve(STYLES, 'chat.css'), 'utf8');
    expect(chat).not.toMatch(/claudsidian-ss-/);
    const sessions = readFileSync(resolve(STYLES, 'sessions.css'), 'utf8');
    for (const shared of ['sheet', 'sheet-backdrop', 'btn', 'icon', 'spinner', 'banner', 'status-dot']) {
      expect(sessions).not.toMatch(new RegExp(`\\.claudsidian-${shared}(?![a-z-])`));
    }
  });
});

/* ---- a small CSS reader for the specificity checks below ----------------------------------------------- */

type Specificity = [ids: number, classes: number, types: number];

interface CssRule {
  /** each selector of the list, trimmed */
  selectors: string[];
  /** declared property names, lower-cased */
  props: string[];
  body: string;
}

/** Every style rule in a file, with @media / @container / @supports blocks flattened and @keyframes skipped. */
function rulesOf(css: string): CssRule[] {
  const out: CssRule[] = [];
  const scan = (text: string): void => {
    let i = 0;
    for (;;) {
      const open = text.indexOf('{', i);
      if (open < 0) return;
      const prelude = text.slice(i, open).trim();
      let depth = 1;
      let close = open + 1;
      while (close < text.length && depth > 0) {
        if (text[close] === '{') depth += 1;
        else if (text[close] === '}') depth -= 1;
        close += 1;
      }
      const body = text.slice(open + 1, close - 1);
      if (/^@(media|container|supports)/.test(prelude)) scan(body);
      else if (!prelude.startsWith('@')) {
        out.push({
          selectors: prelude.split(',').map((sel) => sel.replace(/\s+/g, ' ').trim()),
          props: body
            .split(';')
            .map((decl) => decl.split(':')[0]!.trim().toLowerCase())
            .filter((name) => /^[a-z-]+$/.test(name)),
          body,
        });
      }
      i = close;
    }
  };
  scan(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  return out;
}

function count(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

/** CSS specificity of one complex selector. :where() counts nothing; :not(), :is() and :has() count their most
 *  specific argument; pseudo-elements count as types. Enough for every selector in src/styles. */
function specificity(selector: string): Specificity {
  const spec: Specificity = [0, 0, 0];
  const add = (other: Specificity): void => {
    spec[0] += other[0];
    spec[1] += other[1];
    spec[2] += other[2];
  };
  let s = selector.replace(/:where\(((?:[^()]|\([^()]*\))*)\)/g, '');
  s = s.replace(/:(?:not|is|has)\(((?:[^()]|\([^()]*\))*)\)/g, (_m, args: string) => {
    const best = args
      .split(',')
      .map((arg) => specificity(arg.trim()))
      .sort(compareSpecificity)
      .at(-1);
    if (best) add(best);
    return '';
  });
  spec[0] += count(s, /#[\w-]+/g);
  s = s.replace(/#[\w-]+/g, '');
  spec[2] += count(s, /::[\w-]+/g);
  s = s.replace(/::[\w-]+/g, '');
  spec[1] += count(s, /\.[\w-]+/g);
  s = s.replace(/\.[\w-]+/g, '');
  spec[1] += count(s, /\[[^\]]*\]/g);
  s = s.replace(/\[[^\]]*\]/g, '');
  spec[1] += count(s, /:[\w-]+/g);
  s = s.replace(/:[\w-]+/g, '');
  spec[2] += count(s, /(?<![\w-])[a-zA-Z][\w-]*/g);
  return spec;
}

function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** The last compound of a complex selector: what the rule actually styles. */
function subjectOf(selector: string): string {
  return selector.split(/\s*[\s>+~]\s*/).at(-1) ?? selector;
}

/* ---- the button reset ----------------------------------------------------------------------------------- */

/** Obsidian's highest global button rules, from app.css: all (0,2,1). The reset ties them and wins by source order;
 *  a mobile variant of the reset would reach (0,3,x) and outrank every two-class feature rule on the iPad, which is
 *  what broke the kitchen device in round 1 (jsdom cannot see it: it resolves the cascade by source order alone). */
const OBSIDIAN_BUTTON_RULES = [
  '.is-tablet button:not(.clickable-icon)',
  'button:not(.clickable-icon).mobile-tap',
  'button.mod-cta:hover',
  '.is-mobile button.mod-warning',
];
const RESET = '.claudsidian-root button:not(.clickable-icon)';
const RESET_VARIANTS = [':hover', ':focus-visible', ':disabled'];

/** Classes the sessions components put on a <button> (primitives.tsx, SessionRow.tsx, SessionsScreen.tsx). */
const SESSIONS_BUTTON_CLASSES = [
  'claudsidian-ss-btn',
  'claudsidian-session-main',
  'claudsidian-session-more',
  'claudsidian-session-action',
  'claudsidian-ss-sheet-close',
  'claudsidian-sessions-new',
  'claudsidian-sessions-refresh',
  'claudsidian-ss-banner-action',
];

function targetsButton(selector: string): boolean {
  const subject = subjectOf(selector);
  return /(^|[^\w-])button(?![\w-])/.test(subject) || SESSIONS_BUTTON_CLASSES.some((c) => new RegExp(`\\.${c}(?![\\w-])`).test(subject));
}

describe('button reset', () => {
  const base = readFileSync(resolve(STYLES, 'base.css'), 'utf8');
  const baseRules = rulesOf(base);
  const resetRule = baseRules.find((r) => r.selectors.length === 1 && r.selectors[0] === RESET);

  it('computes specificity the way the browser does', () => {
    expect(specificity('button')).toEqual([0, 0, 1]);
    expect(specificity('button:not(.clickable-icon)')).toEqual([0, 1, 1]);
    expect(specificity('.a .b')).toEqual([0, 2, 0]);
    expect(specificity('.a :where(.b) button:not(.c)')).toEqual([0, 2, 1]);
    expect(specificity('.a button.b:hover:not(:disabled)')).toEqual([0, 4, 1]);
    expect(specificity('#x .y::before')).toEqual([1, 1, 1]);
    expect(specificity('.a .b:is(.c .d, .e)')).toEqual([0, 4, 0]);
  });

  it('is one (0,2,1) selector on every platform: no mobile variant, the full reset in its body', () => {
    expect(resetRule, RESET).toBeDefined();
    expect(specificity(RESET)).toEqual([0, 2, 1]);
    for (const decl of [
      'height: auto',
      'min-height: 0',
      'padding: 0',
      'margin: 0',
      'background: none',
      'border: 0',
      'border-radius: 0',
      'box-shadow: none',
      'font: inherit',
      'line-height: inherit',
      'color: inherit',
      'white-space: normal',
      'text-align: left',
      'justify-content: flex-start',
      'display: inline-flex',
      'align-items: center',
      'cursor: pointer',
    ]) {
      expect(resetRule!.body, decl).toContain(decl);
    }
    // no second reset selector keyed on the platform: `.is-mobile` anywhere near `button` would be (0,3,x)
    for (const rule of baseRules) {
      for (const sel of rule.selectors) {
        if (!targetsButton(sel) || sel.startsWith('.claudsidian-modal') || sel.startsWith('body.is-mobile .claudsidian-modal')) continue;
        expect(sel, 'a button rule in base.css outside the reset family').toMatch(new RegExp(`^${RESET.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(:[\\w-]+)?$`));
        expect(sel).not.toMatch(/is-mobile|is-phone|is-tablet/);
      }
    }
    // the old generic min-height on every button is gone: each class sets its own tap target
    expect(base).not.toMatch(/\.claudsidian-view :where\(button\)/);
  });

  it('ties Obsidian\'s highest global button rules and wins by source order; its state variants sit above them', () => {
    for (const obsidian of OBSIDIAN_BUTTON_RULES) {
      expect(compareSpecificity(specificity(RESET), specificity(obsidian)), obsidian).toBeGreaterThanOrEqual(0);
    }
    for (const variant of RESET_VARIANTS) {
      const rule = baseRules.find((r) => r.selectors.includes(RESET + variant));
      expect(rule, RESET + variant).toBeDefined();
      expect(specificity(RESET + variant)).toEqual([0, 3, 1]);
    }
  });

  it('every sessions button rule that touches a reset property outranks the reset (hover rules its hover)', () => {
    const resetProps = resetRule!.props;
    const collides = (prop: string) => resetProps.some((r) => prop === r || prop.startsWith(`${r}-`));
    const sessions = rulesOf(readFileSync(resolve(STYLES, 'sessions.css'), 'utf8'));
    const checked: string[] = [];
    for (const rule of sessions) {
      for (const sel of rule.selectors) {
        if (!targetsButton(sel)) continue;
        const colliding = rule.props.filter(collides);
        if (colliding.length === 0) continue;
        const variant = RESET_VARIANTS.find((v) => sel.includes(v)) ?? '';
        const floor = specificity(RESET + variant);
        const own = specificity(sel);
        expect(
          compareSpecificity(own, floor),
          `${sel} (${own.join(',')}) sets ${colliding.join(', ')} below the reset${variant} (${floor.join(',')})`,
        ).toBeGreaterThanOrEqual(0);
        checked.push(sel);
      }
    }
    // the rules the screen leans on were in the set the loop walked, mobile and cooking variants included
    for (const must of [
      '.claudsidian-sessions button.claudsidian-ss-btn',
      '.claudsidian-sessions button.claudsidian-ss-btn.is-ghost',
      '.claudsidian-sessions button.claudsidian-ss-btn.mod-cta',
      '.claudsidian-sessions button.claudsidian-ss-btn:hover:not(:disabled)',
      '.claudsidian-sessions button.claudsidian-session-main',
      '.is-mobile .claudsidian-sessions button.claudsidian-session-main',
      '.is-cooking .claudsidian-sessions button.claudsidian-session-main',
      '.claudsidian-sessions button.claudsidian-session-more',
      '.claudsidian-sessions button.claudsidian-session-more:hover',
      '.claudsidian-sessions .claudsidian-session-actions button.claudsidian-session-action',
      '.claudsidian-sessions .claudsidian-session-actions button.claudsidian-session-action.is-archive',
      '.claudsidian-sessions button.claudsidian-ss-sheet-close',
      '.claudsidian-signed-out button.claudsidian-ss-btn',
      '.claudsidian-empty-state button.claudsidian-ss-btn',
      '.claudsidian-new-session-actions button.claudsidian-ss-btn',
    ]) {
      expect(checked, must).toContain(must);
    }
    // and the classes the list is written against are the ones the components render
    const components = readdirSync(resolve(STYLES, '../ui/components/sessions'))
      .filter((f) => f.endsWith('.tsx'))
      .map((f) => readFileSync(resolve(STYLES, '../ui/components/sessions', f), 'utf8'))
      .join('\n');
    for (const c of SESSIONS_BUTTON_CLASSES) expect(components, c).toContain(c);
  });

  it('every sessions button class sets its own background and padding above the reset', () => {
    const css = readFileSync(resolve(STYLES, 'sessions.css'), 'utf8');
    const block = (selector: string) => {
      const m = css.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
      expect(m, selector).not.toBeNull();
      return m![1]!;
    };
    expect(block('.claudsidian-sessions button.claudsidian-ss-btn')).toMatch(/background:\s*var\(--interactive-normal\)/);
    expect(block('.claudsidian-sessions button.claudsidian-ss-btn')).toMatch(/padding:\s*0 10px/);
    expect(block('.claudsidian-sessions button.claudsidian-ss-btn')).toMatch(/min-height:\s*var\(--claudsidian-tap\)/);
    expect(block('.claudsidian-sessions button.claudsidian-ss-btn.mod-cta')).toMatch(/background:\s*var\(--interactive-accent\)/);
    expect(block('.claudsidian-sessions button.claudsidian-ss-btn.is-ghost')).toMatch(/background:\s*transparent/);
    expect(block('.claudsidian-sessions button.claudsidian-session-more')).toMatch(/width:\s*var\(--claudsidian-tap\)/);
    expect(block('.claudsidian-sessions button.claudsidian-session-main')).toMatch(/display:\s*grid/);
    expect(block('.claudsidian-sessions button.claudsidian-session-main')).toMatch(/background:\s*none/);
    expect(block('.claudsidian-sessions .claudsidian-session-actions button.claudsidian-session-action')).toMatch(/background:\s*transparent/);
    expect(block('.claudsidian-sessions .claudsidian-session-actions button.claudsidian-session-action.is-archive')).toMatch(/border-top/);
    expect(block('.claudsidian-signed-out button.claudsidian-ss-btn,\n.claudsidian-empty-state button.claudsidian-ss-btn')).toMatch(/background:/);
  });
});

describe('safe area padding', () => {
  it('reads the Obsidian variable first and falls back to env()', () => {
    for (const file of ['mobile.css', 'sessions.css', 'cooking.css']) {
      const css = readFileSync(resolve(STYLES, file), 'utf8');
      const bare = css.match(/(?<!var\(--safe-area-inset-bottom, )env\(safe-area-inset-bottom/g) ?? [];
      expect(bare, `${file} uses env() without the --safe-area-inset-bottom variable`).toHaveLength(0);
    }
    const mobile = readFileSync(resolve(STYLES, 'mobile.css'), 'utf8');
    expect(mobile).toContain('var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))');
  });
});

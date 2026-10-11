// Stylesheet contracts the sessions screen depends on, checked against the real bundle order (src/styles/index.css):
// the sessions sheet paints above its own backdrop whatever the other feature files declare, and the
// mobile bottom padding reads Obsidian's safe-area variable before env().
import { readFileSync } from 'node:fs';
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

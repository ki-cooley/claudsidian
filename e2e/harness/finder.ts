// In-page element finder shared by both drivers. Selector forms: a CSS selector, `text=Exact`, `text*=Partial`,
// and stages chained with ` >> ` (each searched inside the previous match). Only visible elements count.

function visible(el: Element): boolean {
  if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) return false;
  if (el.getClientRects().length === 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
}

function norm(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

const CLICKABLE = 'button, a, [role="button"], [role="menuitem"], [role="option"], [role="tab"], label, summary, input, select, textarea';

/** Prefer the clickable ancestor (within three levels) of a text match, else the deepest matching element. */
function clickableFor(el: Element): Element {
  let cur: Element | null = el;
  for (let i = 0; i < 3 && cur; i++) {
    if (cur.matches(CLICKABLE)) return cur;
    cur = cur.parentElement;
  }
  return el;
}

function byText(root: ParentNode, text: string, exact: boolean): Element | null {
  const wanted = norm(text);
  const all = Array.from(root.querySelectorAll('*')).filter((el) => visible(el) && !['SCRIPT', 'STYLE'].includes(el.tagName));
  // Deepest elements first: a match whose children also match is not the tightest fit.
  const matches = all.filter((el) => {
    const t = norm(el.textContent);
    if (exact ? t !== wanted : !t.includes(wanted)) return false;
    const own = norm(el.getAttribute('aria-label')) === wanted;
    if (own) return true;
    return !Array.from(el.children).some((c) => {
      const ct = norm(c.textContent);
      return visible(c) && (exact ? ct === wanted : ct.includes(wanted));
    });
  });
  const labelled = all.find((el) => norm(el.getAttribute('aria-label')) === wanted || norm(el.getAttribute('placeholder')) === wanted);
  const first = matches[0] ?? labelled ?? null;
  return first ? clickableFor(first) : null;
}

function stage(root: ParentNode, sel: string): Element | null {
  const s = sel.trim();
  if (s.startsWith('text*=')) return byText(root, s.slice(6), false);
  if (s.startsWith('text=')) return byText(root, s.slice(5), true);
  const candidates = Array.from(root.querySelectorAll(s));
  return candidates.find(visible) ?? candidates[0] ?? null;
}

export function find(selector: string, root: ParentNode = document): Element | null {
  let cur: Element | null = null;
  let scope: ParentNode = root;
  for (const part of selector.split(' >> ')) {
    cur = stage(scope, part);
    if (!cur) return null;
    scope = cur;
  }
  return cur;
}

export function findAll(selector: string, root: ParentNode = document): Element[] {
  const parts = selector.split(' >> ');
  const last = parts.pop() ?? '';
  const scope = parts.length ? find(parts.join(' >> '), root) : root;
  if (!scope) return [];
  const s = last.trim();
  if (s.startsWith('text')) {
    const one = stage(scope, s);
    return one ? [one] : [];
  }
  return Array.from(scope.querySelectorAll(s)).filter(visible);
}

export function rectOf(selector: string): { x: number; y: number; width: number; height: number } | null {
  const el = find(selector);
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

export function textOf(selector: string): string | null {
  const el = find(selector);
  if (!el) return null;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
  return norm(el.textContent);
}

export function focusEl(selector: string): boolean {
  const el = find(selector);
  if (!(el instanceof HTMLElement)) return false;
  el.focus();
  return document.activeElement === el;
}

export function installFinder(): void {
  (window as unknown as { __harness: unknown }).__harness = {
    ...((window as unknown as { __harness?: Record<string, unknown> }).__harness ?? {}),
    find,
    findAll,
    rectOf,
    textOf,
    focusEl,
    bodyText: () => norm(document.body.innerText),
  };
}

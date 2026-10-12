// Button: aria-label only on icon-only buttons (Obsidian shows aria-label as a tooltip, so a visible label
// must not get one), title only when passed, pressed state, kind classes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, type ButtonProps } from '../../../src/ui/components/common/Button';
import { mount, q, type Mounted } from '../chat/harness';

let mounted: Mounted<unknown>[] = [];
afterEach(() => {
  for (const m of mounted) m.unmount();
  mounted = [];
});

function button(props: ButtonProps): HTMLButtonElement {
  const m = mount(Button, props);
  mounted.push(m as Mounted<unknown>);
  return q<HTMLButtonElement>(m.root, 'button');
}

describe('Button', () => {
  it('an icon-only button carries its accessible name as aria-label and no duplicate title', () => {
    const b = button({ icon: 'send-horizontal', ariaLabel: 'Send' });
    expect(b.getAttribute('aria-label')).toBe('Send');
    expect(b.getAttribute('title')).toBeNull();
    expect(b.classList.contains('is-icon')).toBe(true);
  });

  it('an icon-only button without ariaLabel falls back to the icon name', () => {
    expect(button({ icon: 'x' }).getAttribute('aria-label')).toBe('x');
  });

  it('a button with a visible label never gets an aria-label, even when one is passed', () => {
    const b = button({ label: 'Cancel', ariaLabel: 'Cancel' });
    expect(b.getAttribute('aria-label')).toBeNull();
    expect(b.textContent?.trim()).toBe('Cancel');
    expect(b.classList.contains('is-icon')).toBe(false);
    const withChildren = mount(Button, { icon: 'check', ariaLabel: 'Done', children: 'Done' });
    mounted.push(withChildren as Mounted<unknown>);
    expect(q<HTMLButtonElement>(withChildren.root, 'button').getAttribute('aria-label')).toBeNull();
  });

  it('title is set only when passed explicitly', () => {
    expect(button({ label: 'Allow and remember', title: 'Bash: npm test' }).getAttribute('title')).toBe('Bash: npm test');
    expect(button({ label: 'Allow' }).getAttribute('title')).toBeNull();
  });

  it('maps kind and pressed onto classes and aria-pressed, and forwards clicks', () => {
    const onClick = vi.fn();
    const b = button({ icon: 'archive', ariaLabel: 'Show archived', kind: 'ghost', pressed: true, onClick });
    expect(b.classList.contains('is-ghost')).toBe(true);
    expect(b.classList.contains('is-pressed')).toBe(true);
    expect(b.getAttribute('aria-pressed')).toBe('true');
    b.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button({ label: 'Go', kind: 'primary' }).classList.contains('mod-cta')).toBe(true);
    expect(button({ label: 'Go' }).getAttribute('aria-pressed')).toBeNull();
  });
});

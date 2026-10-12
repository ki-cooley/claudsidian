// ChatHeader: friendly chip labels, chevrons only on tappable chips, the Needs you chip asks for the pending
// card, the title ellipsises in its own span, and the memo keeps callbacks live across skipped renders.
import { h } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatHeader, SCROLL_TO_PENDING_EVENT, type ChatHeaderProps } from '../../../src/ui/components/chat/ChatHeader';
import { modelLabel, permissionModeLabel } from '../../../src/ui/components/chat/status';
import { maybe, mount, q, qa, text, tick, type Mounted } from './harness';

let mounted: Mounted<unknown>[] = [];
afterEach(() => {
  for (const m of mounted) m.unmount();
  mounted = [];
});

function props(overrides: Partial<ChatHeaderProps> = {}): ChatHeaderProps {
  return {
    title: 'Make gen-prep seed mechanically from dish and component files',
    status: { label: 'Idle', tone: 'idle', busy: false },
    model: 'claude-opus-5-5',
    permissionMode: 'bypassPermissions',
    cooking: false,
    onBack: vi.fn(),
    onRename: vi.fn(),
    onArchive: vi.fn(),
    onSetModel: vi.fn(),
    onSetPermissionMode: vi.fn(),
    onEffort: vi.fn(),
    onOpenExternal: vi.fn(),
    onToggleCooking: vi.fn(),
    ...overrides,
  };
}

/** The header inside a plugin root, the way ChatScreen mounts it, so root events can be observed. */
function Rooted(p: ChatHeaderProps) {
  return h('div', { class: 'claudsidian-root' }, h(ChatHeader, p));
}

function setup(overrides: Partial<ChatHeaderProps> = {}) {
  const p = props(overrides);
  const m = mount(Rooted, p);
  mounted.push(m as Mounted<unknown>);
  return { ...m, p };
}

describe('labels', () => {
  it('maps model ids and permission modes to short names', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5');
    expect(modelLabel('claude-fable-5-1')).toBe('Fable 5.1');
    expect(modelLabel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5');
    expect(modelLabel('claude-3-5-haiku-20241022')).toBe('Haiku 3.5');
    expect(modelLabel('us.anthropic.claude-opus-4-1-20250805')).toBe('Opus 4.1');
    expect(modelLabel('claude-custom-x')).toBe('custom-x');
    expect(modelLabel(undefined)).toBe('');
    expect(permissionModeLabel('bypassPermissions')).toBe('Bypass');
    expect(permissionModeLabel('acceptEdits')).toBe('Accept edits');
    expect(permissionModeLabel('auto')).toBe('Auto');
    expect(permissionModeLabel('default')).toBe('Ask');
    expect(permissionModeLabel('plan')).toBe('Plan');
    expect(permissionModeLabel('weird')).toBe('weird');
  });
});

describe('ChatHeader', () => {
  it('shows friendly chip labels with a chevron on the tappable chips and none on the status', () => {
    const { root } = setup();
    const chips = qa(root, '.claudsidian-meta-chip');
    expect(chips.map((c) => text(c))).toEqual(['Opus 5.5', 'Bypass']);
    expect(chips.every((c) => c.querySelector('.claudsidian-meta-chevron'))).toBe(true);
    expect(chips.map((c) => c.getAttribute('data-value'))).toEqual(['claude-opus-5-5', 'bypassPermissions']);
    const status = q(root, '.claudsidian-status');
    expect(text(status)).toBe('Idle');
    expect(status.tagName).toBe('SPAN');
    expect(maybe(status, '.claudsidian-meta-chevron')).toBeNull();
    expect(root.textContent).not.toContain('claude-opus-5-5');
  });

  it('makes the cooking chip a pressed toggle that turns cooking mode off, and renders the title text in its own ellipsising span', () => {
    const { root, p } = setup({ cooking: true });
    const chips = qa(root, '.claudsidian-meta-chip');
    expect(chips).toHaveLength(3);
    const hat = chips[2] as HTMLButtonElement;
    expect(hat.classList.contains('is-static')).toBe(true);
    expect(hat.tagName).toBe('BUTTON');
    expect(hat.getAttribute('aria-pressed')).toBe('true');
    hat.click();
    expect(p.onToggleCooking).toHaveBeenCalledTimes(1);
    const title = q<HTMLButtonElement>(root, 'button.claudsidian-header-title');
    expect(text(q(title, '.claudsidian-header-title-text'))).toBe('Make gen-prep seed mechanically from dish and component files');
  });

  it('turns the status into a button when the session needs the person and asks the root to scroll to the pending card', () => {
    const { root } = setup({ status: { label: 'Needs you', tone: 'needs', busy: false } });
    const status = q<HTMLButtonElement>(root, 'button.claudsidian-status');
    expect(text(status)).toBe('Needs you');
    const seen = vi.fn();
    q(root, '.claudsidian-root').addEventListener(SCROLL_TO_PENDING_EVENT, seen);
    status.click();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('skips the render when only callbacks change, yet the latest callback is the one called', async () => {
    const { root, p, rerender } = setup();
    const title = q(root, '.claudsidian-header-title-text');
    const laterBack = vi.fn();
    rerender({ ...p, onBack: laterBack });
    await tick();
    // same DOM node: nothing re-rendered
    expect(q(root, '.claudsidian-header-title-text')).toBe(title);
    q<HTMLButtonElement>(root, 'button[aria-label="Back to sessions"]').click();
    expect(laterBack).toHaveBeenCalledTimes(1);
    expect(p.onBack).not.toHaveBeenCalled();

    rerender({ ...p, status: { label: 'Working', tone: 'working', busy: true } });
    await tick();
    expect(text(q(root, '.claudsidian-status'))).toBe('Working');
    expect(q(root, '.claudsidian-status').classList.contains('is-working')).toBe(true);
  });

  it('offers friendly names in the model and mode pickers and sends the raw ids', async () => {
    const { root, p } = setup();
    q<HTMLButtonElement>(root, 'button.claudsidian-meta-chip[data-value="claude-opus-5-5"]').click();
    await tick();
    const rows = qa(root, '.claudsidian-sheet-action').map((el) => text(el));
    expect(rows).toContain('Fable 5.1');
    expect(rows).toContain('Opus 5.5');
    qa<HTMLButtonElement>(root, '.claudsidian-sheet-action')
      .find((el) => text(el) === 'Sonnet 5.5')
      ?.click();
    expect(p.onSetModel).toHaveBeenCalledWith('claude-sonnet-5-5');
    await tick();
    q<HTMLButtonElement>(root, 'button.claudsidian-meta-chip[data-value="bypassPermissions"]').click();
    await tick();
    qa<HTMLButtonElement>(root, '.claudsidian-sheet-action')
      .find((el) => text(el) === 'Accept edits')
      ?.click();
    expect(p.onSetPermissionMode).toHaveBeenCalledWith('acceptEdits');
  });
});

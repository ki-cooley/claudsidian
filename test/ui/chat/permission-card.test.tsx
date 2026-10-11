// PermissionCard: body by tool, Allow / Allow and remember / Deny with a reason, collapsed when resolved.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermissionCard } from '../../../src/ui/components/chat/items/PermissionCard';
import { items } from '../../helpers/fake-store';
import { buttonByText, hasButton, maybe, mount, q, text, tick, type, type Mounted } from './harness';

let mounted: Mounted<unknown>[] = [];
afterEach(() => {
  for (const m of mounted) m.unmount();
  mounted = [];
});

function setup(itemOverrides: Parameters<typeof items.permission>[2] = {}, cooking = false) {
  const item = items.permission('Bash', { command: 'npm test', description: 'Run the tests' }, itemOverrides);
  const onAllow = vi.fn();
  const onDeny = vi.fn();
  const m = mount(PermissionCard, { item, cooking, onAllow, onDeny });
  mounted.push(m as Mounted<unknown>);
  return { ...m, item, onAllow, onDeny };
}

describe('PermissionCard', () => {
  it('renders the Bash command in a code block under a summarised title', () => {
    const { root } = setup();
    expect(text(q(root, '.claudsidian-perm-title'))).toContain('Bash: npm test');
    expect(q(root, '.claudsidian-permission pre').textContent).toContain('npm test');
  });

  it('Allow calls onAllow(false)', () => {
    const { root, onAllow } = setup();
    buttonByText(root, 'Allow').click();
    expect(onAllow).toHaveBeenCalledWith(false);
  });

  it('shows Allow and remember only when there are suggestions, and passes remember=true', () => {
    const plain = setup();
    expect(hasButton(plain.root, 'Allow and remember')).toBe(false);
    const withSuggestions = setup({ suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }] }] });
    buttonByText(withSuggestions.root, 'Allow and remember').click();
    expect(withSuggestions.onAllow).toHaveBeenCalledWith(true);
  });

  it('spells out the rules Allow and remember would persist, with their destination', () => {
    const { root } = setup({
      suggestions: [
        { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'rm:*' }], behavior: 'allow', destination: 'session' },
        { type: 'addRules', rules: [{ toolName: 'Edit' }], behavior: 'deny', destination: 'projectSettings' },
        { type: 'setMode', mode: 'acceptEdits' },
      ],
    });
    const rules = text(q(root, '.claudsidian-perm-rules'));
    expect(rules).toContain('Bash(rm:*) in this session');
    expect(rules).toContain('deny Edit in project settings');
    expect(rules).toContain('mode: acceptEdits');
    expect(buttonByText(root, 'Allow and remember').title).toContain('Bash(rm:*)');
    expect(maybe(setup().root, '.claudsidian-perm-rules')).toBeNull();
  });

  it('Deny reveals a reason field and confirms with the reason', async () => {
    const { root, onDeny } = setup();
    expect(maybe(root, '.claudsidian-perm-reason')).toBeNull();
    buttonByText(root, 'Deny').click();
    await tick();
    const reason = q<HTMLInputElement>(root, '.claudsidian-perm-reason');
    type(reason, 'reason');
    await tick();
    buttonByText(root, 'Confirm deny').click();
    expect(onDeny).toHaveBeenCalledWith('reason');
  });

  it('confirming without a reason passes undefined', async () => {
    const { root, onDeny } = setup();
    buttonByText(root, 'Deny').click();
    await tick();
    buttonByText(root, 'Confirm deny').click();
    expect(onDeny).toHaveBeenCalledWith(undefined);
  });

  it('renders Edit requests as before and after blocks', () => {
    const item = items.permission('Edit', { file_path: '/v/recipes/tare.md', old_string: 'mirn', new_string: 'mirin' });
    const m = mount(PermissionCard, { item, cooking: false, onAllow: vi.fn(), onDeny: vi.fn() });
    mounted.push(m as Mounted<unknown>);
    expect(q(m.root, '.claudsidian-diff-old').textContent).toContain('mirn');
    expect(q(m.root, '.claudsidian-diff-new').textContent).toContain('mirin');
  });

  it('collapses to one line once resolved', () => {
    const { root } = setup({ resolved: 'allow' });
    expect(root.querySelectorAll('button')).toHaveLength(0);
    expect(text(root)).toContain('Allowed');
    expect(text(root)).toContain('npm test');
  });

  it('marks the card for cooking mode so the buttons grow', () => {
    const { root } = setup({}, true);
    expect(q(root, '.claudsidian-permission').classList.contains('is-cooking')).toBe(true);
  });
});

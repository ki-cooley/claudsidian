// Tests for the "[Obsidian context]" block appended to outgoing user text.
import { describe, expect, it } from 'vitest';
import { composeOutgoingText, formatContextBlock } from '../../src/core/context-format';
import type { CapturedContext } from '../../src/core/types';

const VAULT = '/Users/kicooley-winters/workspace/projects/yes-chef';

function full(): CapturedContext {
  return {
    vaultName: 'yes-chef',
    activeNote: { path: 'menus/latitude 10/menu.md', cursorLine: 42 },
    selection: { text: 'line a\nline b', fromLine: 40, toLine: 44, truncated: false },
    openNotes: ['components/dashi.md', 'techniques/kombu-cure.md'],
    mentions: ['recipes/tare.md'],
  };
}

describe('formatContextBlock', () => {
  it('writes the full block with everything', () => {
    const out = formatContextBlock(full(), { vaultPathOnMac: VAULT });
    expect(out).toBe(
      [
        '[Obsidian context]',
        `vault: yes-chef (${VAULT})`,
        'active note: menus/latitude 10/menu.md (cursor line 42)',
        'selection (lines 40-44):',
        '"""',
        'line a',
        'line b',
        '"""',
        'open notes: components/dashi.md, techniques/kombu-cure.md',
        'mentioned: @recipes/tare.md',
      ].join('\n'),
    );
  });

  it('returns an empty string when there is nothing to say', () => {
    const ctx: CapturedContext = { vaultName: 'yes-chef', openNotes: [], mentions: [] };
    expect(formatContextBlock(ctx, { vaultPathOnMac: VAULT })).toBe('');
    expect(formatContextBlock(ctx, { vaultPathOnMac: VAULT, sessionCwd: '/elsewhere' })).toBe('');
  });

  it('keeps paths relative and drops the absolute path when sessionCwd is the vault', () => {
    const out = formatContextBlock(full(), { vaultPathOnMac: VAULT, sessionCwd: VAULT });
    expect(out).not.toContain(VAULT);
    expect(out).toContain('active note: menus/latitude 10/menu.md');
    expect(out).toContain('open notes: components/dashi.md, techniques/kombu-cure.md');
    const outSlash = formatContextBlock(full(), { vaultPathOnMac: VAULT, sessionCwd: VAULT + '/' });
    expect(outSlash).not.toContain(VAULT);
  });

  it('carries the absolute vault path when sessionCwd differs', () => {
    const out = formatContextBlock(full(), { vaultPathOnMac: VAULT, sessionCwd: '/Users/kicooley-winters/workspace' });
    expect(out).toContain(`vault: yes-chef (${VAULT})`);
    expect(out).toContain('active note: menus/latitude 10/menu.md');
  });

  it('format without session cwd keeps the absolute path', () => {
    const out = formatContextBlock(full(), { vaultPathOnMac: VAULT });
    expect(out).toContain(`vault: yes-chef (${VAULT})`);
  });

  it('omits lines whose data is missing', () => {
    const ctx: CapturedContext = {
      vaultName: 'yes-chef',
      activeNote: { path: 'a.md' },
      openNotes: [],
      mentions: [],
    };
    const out = formatContextBlock(ctx, { vaultPathOnMac: VAULT, sessionCwd: VAULT });
    expect(out).toBe('[Obsidian context]\nactive note: a.md');
  });

  it('marks a truncated selection and uses a single line label for one line', () => {
    const ctx: CapturedContext = {
      vaultName: 'yes-chef',
      selection: { text: 'abc', fromLine: 7, toLine: 7, truncated: true },
      openNotes: [],
      mentions: [],
    };
    const out = formatContextBlock(ctx, { vaultPathOnMac: VAULT, sessionCwd: VAULT });
    expect(out).toBe(['[Obsidian context]', 'selection (line 7):', '"""', 'abc', '[truncated]', '"""'].join('\n'));
  });

  it('prefixes mentions with @ exactly once', () => {
    const ctx: CapturedContext = { vaultName: 'v', openNotes: [], mentions: ['@a.md', 'b.md'] };
    const out = formatContextBlock(ctx, { vaultPathOnMac: VAULT, sessionCwd: VAULT });
    expect(out).toContain('mentioned: @a.md, @b.md');
  });
});

describe('composeOutgoingText', () => {
  it('joins text and block with a blank line', () => {
    expect(composeOutgoingText('hello', '[Obsidian context]\nactive note: a.md')).toBe(
      'hello\n\n[Obsidian context]\nactive note: a.md',
    );
  });
  it('returns the text alone when the block is empty', () => {
    expect(composeOutgoingText('hello', '')).toBe('hello');
  });
  it('trims trailing whitespace from the text before joining', () => {
    expect(composeOutgoingText('hello  \n', '[Obsidian context]\nactive note: a.md')).toBe(
      'hello\n\n[Obsidian context]\nactive note: a.md',
    );
  });
  it('returns the block alone when the text is empty', () => {
    expect(composeOutgoingText('', '[Obsidian context]\nactive note: a.md')).toBe('[Obsidian context]\nactive note: a.md');
  });
});

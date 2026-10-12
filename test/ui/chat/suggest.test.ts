// composer-suggest ranking: recent files first on an empty query, then the active note's folder, archived
// and template folders last, six rows at most, and the basename-first ranking for a typed query.
import { describe, expect, it } from 'vitest';
import { filterFiles, isDemotedPath, MAX_FILE_SUGGESTIONS, splitPath, tokenAt } from '../../../src/ui/components/chat/composer-suggest';

const ALL = [
  'AGENTS.md',
  'CLAUDE.md',
  'components/_archived/American Persimmon.md',
  'components/_archived/Apple Cider.md',
  'components/dashi.md',
  'menus/latitude 10/menu.md',
  'menus/latitude 10/prep.md',
  'menus/latitude 10/tasks.md',
  'menus/latitude 9/menu.md',
  'templates/dish.md',
  '.obsidian/plugins/x/README.md',
];

describe('filterFiles', () => {
  it('empty query: recent first (in recency order), then the active note folder, then the rest; demoted folders last', () => {
    const out = filterFiles({ all: ALL, recent: ['menus/latitude 9/menu.md', 'components/dashi.md'], activeNotePath: 'menus/latitude 10/menu.md' }, '');
    expect(out).toEqual([
      'menus/latitude 9/menu.md',
      'components/dashi.md',
      'menus/latitude 10/prep.md',
      'menus/latitude 10/tasks.md',
      'AGENTS.md',
      'CLAUDE.md',
    ]);
    expect(out).toHaveLength(MAX_FILE_SUGGESTIONS);
    expect(out).not.toContain('menus/latitude 10/menu.md'); // the active note is already context
  });

  it('demoted folders only appear once everything else is exhausted', () => {
    const out = filterFiles({ all: ['templates/dish.md', 'components/_archived/Apple Cider.md', 'notes/a.md'] }, '');
    expect(out).toEqual(['notes/a.md', 'components/_archived/Apple Cider.md', 'templates/dish.md']);
    expect(isDemotedPath('components/_archived/x.md')).toBe(true);
    expect(isDemotedPath('archive/x.md')).toBe(true);
    expect(isDemotedPath('templates/x.md')).toBe(true);
    expect(isDemotedPath('.obsidian/x.md')).toBe(true);
    expect(isDemotedPath('menus/archive-notes.md')).toBe(false);
  });

  it('a query ranks basename prefix, then basename contains, then folder matches, recent first within a rank', () => {
    const files = ['notes/mention of menus.md', 'menus/latitude 9/menu.md', 'menus/latitude 10/menu.md', 'components/dashi.md'];
    expect(filterFiles(files, 'men')).toEqual(['menus/latitude 10/menu.md', 'menus/latitude 9/menu.md', 'notes/mention of menus.md']);
    expect(filterFiles({ all: files, recent: ['menus/latitude 9/menu.md'] }, 'men')).toEqual([
      'menus/latitude 9/menu.md',
      'menus/latitude 10/menu.md',
      'notes/mention of menus.md',
    ]);
    // a query that only matches a demoted path still finds it
    expect(filterFiles(ALL, 'persimmon')).toEqual(['components/_archived/American Persimmon.md']);
  });

  it('a plain array still works and the cap holds', () => {
    const many = Array.from({ length: 12 }, (_, i) => `notes/m${i}.md`);
    expect(filterFiles(many, 'm')).toHaveLength(6);
    expect(filterFiles(many, '')).toHaveLength(6);
  });

  it('a recent path that no longer exists in the vault is ignored', () => {
    expect(filterFiles({ all: ['a.md'], recent: ['gone.md', 'a.md'] }, '')).toEqual(['a.md']);
  });
});

describe('splitPath and tokenAt', () => {
  it('splits the folder with its trailing slash from the basename', () => {
    expect(splitPath('menus/latitude 10/menu.md')).toEqual({ dir: 'menus/latitude 10/', name: 'menu.md' });
    expect(splitPath('AGENTS.md')).toEqual({ dir: '', name: 'AGENTS.md' });
  });

  it('finds the @ token under the caret but not an email', () => {
    expect(tokenAt('see @men', 8)).toEqual({ kind: 'mention', query: 'men', start: 4, end: 8 });
    expect(tokenAt('mail ki@m', 9)).toBeNull();
    expect(tokenAt('/mo', 3)).toEqual({ kind: 'slash', query: 'mo', end: 3 });
  });
});

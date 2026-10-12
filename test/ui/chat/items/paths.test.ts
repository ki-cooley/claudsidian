// Paths in tool rows: vault-relative, then session-relative, then ~/; cd prefixes dropped from Bash summaries.
import { describe, expect, it } from 'vitest';
import { pathRoots, relativizePath, relativizeText, stripCdPrefix, toolSummary, workingLabel } from '../../../../src/ui/components/chat/items/paths';
import { items } from '../../../helpers/fake-store';

const VAULT = '/Users/kicooley-winters/workspace/projects/yes-chef';
const CWD = '/Users/kicooley-winters/workspace/projects/yes-chef/menus/latitude 10';

describe('pathRoots', () => {
  it('drops blanks, trailing slashes and duplicates, keeping order', () => {
    expect(pathRoots(`${VAULT}/`, undefined, '', VAULT, CWD)).toEqual([VAULT, CWD]);
  });
});

describe('relativizePath', () => {
  it('prefers the vault, then the session cwd, then ~/', () => {
    const roots = pathRoots(VAULT, CWD);
    expect(relativizePath(`${VAULT}/scripts/seed-prep.py`, roots)).toBe('scripts/seed-prep.py');
    expect(relativizePath(`${CWD}/tasks.md`, roots)).toBe('menus/latitude 10/tasks.md');
    expect(relativizePath('/Users/kicooley-winters/workspace/x.md', roots)).toBe('~/workspace/x.md');
    expect(relativizePath('/etc/hosts', roots)).toBe('/etc/hosts');
    expect(relativizePath(VAULT, roots)).toBe('.');
  });

  it('uses the cwd when the vault is unknown', () => {
    expect(relativizePath(`${CWD}/tasks.md`, pathRoots(undefined, CWD))).toBe('tasks.md');
  });
});

describe('relativizeText', () => {
  it('shortens every root inside free text and never cuts a longer path', () => {
    const roots = pathRoots(VAULT, CWD);
    expect(relativizeText(`Edit ${VAULT}/scripts/a.py and ${CWD}/b.md`, roots)).toBe('Edit scripts/a.py and menus/latitude 10/b.md');
    expect(relativizeText(`Read ${VAULT}-old/x.md`, roots)).toBe('Read ~/workspace/projects/yes-chef-old/x.md');
    expect(relativizeText('Bash: ls /Users/other/docs', roots)).toBe('Bash: ls ~/docs');
  });
});

describe('stripCdPrefix', () => {
  it('drops a leading cd to a quoted or bare directory followed by && or ;', () => {
    expect(stripCdPrefix(`cd "${CWD}" && python3 scripts/render.py 2026-10-12`)).toBe('python3 scripts/render.py 2026-10-12');
    expect(stripCdPrefix(`cd '${VAULT}' ; npm test`)).toBe('npm test');
    expect(stripCdPrefix(`cd ${VAULT} && npm test`)).toBe('npm test');
  });

  it('leaves a command that is only a cd, or does not start with one', () => {
    expect(stripCdPrefix(`cd "${VAULT}"`)).toBe(`cd "${VAULT}"`);
    expect(stripCdPrefix('npm test && cd dist')).toBe('npm test && cd dist');
  });
});

describe('toolSummary', () => {
  const roots = pathRoots(VAULT, CWD);

  it('reads vault-relative for file tools', () => {
    expect(toolSummary('Edit', { file_path: `${VAULT}/scripts/seed-prep.py` }, roots)).toBe('Edit scripts/seed-prep.py');
    expect(toolSummary('Read', { file_path: `${CWD}/prep-rd-2026-10-18.md` }, roots)).toBe('Read menus/latitude 10/prep-rd-2026-10-18.md');
  });

  it('drops the cd prefix from Bash and relativises the rest', () => {
    expect(toolSummary('Bash', { command: `cd "${VAULT}" && python3 scripts/render-prep-window.py 2026-10-12` }, roots)).toBe('Bash: python3 scripts/render-prep-window.py 2026-10-12');
    expect(toolSummary('Bash', { command: `cat ${VAULT}/menu.md` }, roots)).toBe('Bash: cat menu.md');
  });

  it('shows ~/ for paths outside the roots and leaves other tools alone', () => {
    expect(toolSummary('Read', { file_path: '/Users/kicooley-winters/.claude/CLAUDE.md' }, roots)).toBe('Read ~/.claude/CLAUDE.md');
    expect(toolSummary('WebSearch', { query: 'mirin shell isomalt' }, roots)).toBe('Search "mirin shell isomalt"');
  });
});

describe('workingLabel', () => {
  const roots = pathRoots(VAULT);

  it('names the running tool in plain words with a relative path', () => {
    expect(workingLabel(items.tool('Read', { file_path: `${VAULT}/prep-rd-2026-10-18.md` }, { status: 'running' }), roots)).toBe('Reading prep-rd-2026-10-18.md');
    expect(workingLabel(items.tool('Edit', { file_path: `${VAULT}/a.md` }, { status: 'running' }), roots)).toBe('Editing a.md');
    expect(workingLabel(items.tool('Bash', { command: 'npm test' }, { status: 'running' }), roots)).toBe('Running bash');
    expect(workingLabel(items.tool('Grep', { pattern: 'x' }, { status: 'running' }), roots)).toBe('Searching');
    expect(workingLabel(items.tool('Agent', { description: 'audit the vault\nmore' }, { status: 'running' }), roots)).toBe('Running agent: audit the vault');
    expect(workingLabel(items.tool('mcp__wine-tracker__search_wines', {}, { status: 'running' }), roots)).toBe('Running wine-tracker');
    expect(workingLabel(items.tool('TodoWrite', {}, { status: 'running' }), roots)).toBe('Running TodoWrite');
  });
});

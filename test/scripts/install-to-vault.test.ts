// @vitest-environment node
// Shell test for scripts/install-to-vault.sh: copies the three plugin files into a vault, refuses without a build.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = join(__dirname, '..', '..');
const SCRIPT = join(REPO, 'scripts', 'install-to-vault.sh');

let repoCopy: string;
let vault: string;

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync('bash', [join(repoCopy, 'scripts', 'install-to-vault.sh'), ...args], {
    cwd: repoCopy,
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

beforeEach(() => {
  repoCopy = mkdtempSync(join(tmpdir(), 'claudsidian-repo-'));
  vault = mkdtempSync(join(tmpdir(), 'claudsidian-vault-'));
  mkdirSync(join(repoCopy, 'scripts'));
  if (existsSync(SCRIPT)) copyFileSync(SCRIPT, join(repoCopy, 'scripts', 'install-to-vault.sh'));
  writeFileSync(join(repoCopy, 'manifest.json'), '{"id":"claudsidian","version":"2.0.0"}\n');
  writeFileSync(join(repoCopy, 'styles.css'), '.claudsidian{}\n');
});

afterEach(() => {
  rmSync(repoCopy, { recursive: true, force: true });
  rmSync(vault, { recursive: true, force: true });
});

describe('install-to-vault.sh', () => {
  it('copies main.js, manifest.json and styles.css into the vault plugin folder', () => {
    writeFileSync(join(repoCopy, 'main.js'), '// fake build\n');
    const r = run(['--vault', vault]);
    expect(r.status, r.stderr).toBe(0);
    const dest = join(vault, '.obsidian', 'plugins', 'claudsidian');
    for (const f of ['main.js', 'manifest.json', 'styles.css']) {
      expect(existsSync(join(dest, f)), f).toBe(true);
    }
    expect(readFileSync(join(dest, 'main.js'), 'utf8')).toBe('// fake build\n');
    expect(r.stdout).toContain(dest);
  });

  it('exits 1 with a build-first message when main.js is absent', () => {
    const r = run(['--vault', vault]);
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/npm run build/);
    expect(existsSync(join(vault, '.obsidian', 'plugins', 'claudsidian', 'manifest.json'))).toBe(false);
  });

  it('rejects an unknown flag', () => {
    writeFileSync(join(repoCopy, 'main.js'), '');
    const r = run(['--bogus']);
    expect(r.status).not.toBe(0);
  });
});

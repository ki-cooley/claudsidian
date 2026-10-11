import esbuild from 'esbuild';
import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import builtins from 'builtin-modules';
import { spawnSync } from 'node:child_process';

const prod = process.argv[2] === 'production';
const vault = process.env.CLAUDSIDIAN_VAULT; // optional: copy the build into <vault>/.obsidian/plugins/claudsidian after each build

const banner = `/*
Claudsidian ${JSON.parse(fs.readFileSync('manifest.json', 'utf8')).version}
Bundled by esbuild. Source: https://github.com/ki-cooley/claudsidian
*/`;

const external = [
  'obsidian',
  'electron',
  '@codemirror/autocomplete',
  '@codemirror/collab',
  '@codemirror/commands',
  '@codemirror/language',
  '@codemirror/lint',
  '@codemirror/search',
  '@codemirror/state',
  '@codemirror/view',
  '@lezer/common',
  '@lezer/highlight',
  '@lezer/lr',
  ...builtins,
  ...builtins.map((m) => `node:${m}`),
];

/** Copy build outputs into a vault's plugin folder (used by `npm run dev` with CLAUDSIDIAN_VAULT set). */
function installToVault() {
  if (!vault) return;
  const dest = path.join(vault, '.obsidian', 'plugins', 'claudsidian');
  fs.mkdirSync(dest, { recursive: true });
  for (const f of ['main.js', 'manifest.json', 'styles.css']) {
    if (fs.existsSync(f)) fs.copyFileSync(f, path.join(dest, f));
  }
  console.log(`[claudsidian] installed into ${dest}`);
}

const installPlugin = {
  name: 'install-to-vault',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length === 0) installToVault();
    });
  },
};

const common = {
  bundle: true,
  sourcemap: prod ? false : 'inline',
  logLevel: 'info',
  minify: prod,
  treeShaking: true,
};

const js = await esbuild.context({
  ...common,
  banner: { js: banner },
  entryPoints: ['src/main.ts'],
  external,
  format: 'cjs',
  target: 'es2020',
  platform: 'browser',
  outfile: 'main.js',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  define: {
    'process.env.NODE_ENV': prod ? '"production"' : '"development"',
    __CLAUDSIDIAN_VERSION__: JSON.stringify(JSON.parse(fs.readFileSync('manifest.json', 'utf8')).version),
  },
  plugins: [installPlugin],
});

const css = await esbuild.context({
  ...common,
  sourcemap: false,
  entryPoints: ['src/styles/index.css'],
  outfile: 'styles.css',
  loader: { '.css': 'css' },
});

if (prod) {
  await js.rebuild();
  await css.rebuild();
  await js.dispose();
  await css.dispose();
  process.exit(0);
} else {
  await js.watch();
  await css.watch();
  console.log('[claudsidian] watching src/ (set CLAUDSIDIAN_VAULT=<vault path> to auto-install)');
}

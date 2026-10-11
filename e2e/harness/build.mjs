// Bundles the harness page: e2e/harness/main.ts with `obsidian` aliased to the shim, plus the plugin and harness CSS,
// into e2e/harness/dist/. Run directly (node e2e/harness/build.mjs) or import buildHarness().
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '..', '..');
export const distDir = path.join(here, 'dist');

/**
 * Lenient mode (HARNESS_LENIENT=1 or --lenient): relative imports that do not resolve become empty modules, so the
 * page still boots while another task's files are mid-edit. The missing paths are reported in the build result.
 */
function lenientPlugin(missing) {
  return {
    name: 'lenient-missing-imports',
    setup(build) {
      build.onResolve({ filter: /^\.\.?\// }, async (args) => {
        if (args.pluginData?.lenient) return null;
        const r = await build.resolve(args.path, { resolveDir: args.resolveDir, kind: args.kind, pluginData: { lenient: true } });
        if (r.errors.length === 0) return r;
        missing.push(path.relative(repoRoot, path.resolve(args.resolveDir, args.path)));
        return { path: args.path, namespace: 'lenient-stub' };
      });
      build.onLoad({ filter: /.*/, namespace: 'lenient-stub' }, (args) => ({
        contents: args.path.endsWith('.css') ? '' : 'export default undefined;',
        loader: args.path.endsWith('.css') ? 'css' : 'js',
      }));
    },
  };
}

export async function buildHarness({ minify = false, sourcemap = true, lenient = process.env.HARNESS_LENIENT === '1' } = {}) {
  fs.mkdirSync(distDir, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'manifest.json'), 'utf8'));
  const missing = [];
  const result = await esbuild.build({
    plugins: lenient ? [lenientPlugin(missing)] : [],
    entryPoints: [path.join(here, 'main.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    outfile: path.join(distDir, 'main.js'),
    alias: { obsidian: path.join(here, 'obsidian-shim.ts') },
    jsx: 'automatic',
    jsxImportSource: 'preact',
    loader: { '.css': 'css' },
    sourcemap: sourcemap ? 'inline' : false,
    minify,
    logLevel: 'warning',
    define: {
      'process.env.NODE_ENV': '"development"',
      __CLAUDSIDIAN_VERSION__: JSON.stringify(`${manifest.version}-harness`),
    },
  });
  fs.copyFileSync(path.join(here, 'index.html'), path.join(distDir, 'index.html'));
  return { distDir, warnings: result.warnings, missing };
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const { distDir: out, warnings, missing } = await buildHarness({ lenient: process.argv.includes('--lenient') || process.env.HARNESS_LENIENT === '1' });
  for (const w of warnings) console.warn(w.text);
  for (const m of missing) console.warn(`stubbed missing import: ${m}`);
  console.log(`harness built into ${path.relative(process.cwd(), out)}`);
}

// Browser e2e runner: builds the harness, starts the mock Remote Control server serving it, drives the chosen
// scenarios across the chosen profiles, and writes e2e/out/<scenario>-<profile>.png plus e2e/out/report.json.
//
//   node e2e/run.mjs [--profile ipad-landscape|ipad-portrait|phone|desktop-sidebar|all] [--scenario NN]
//                    [--browser playwright|chrome] [--headed] [--no-build] [--lenient] [--timeout MS] [--endpoint URL]
//
// Exit code 1 when any step fails. Playwright's Chromium lives in .pw-browsers (PLAYWRIGHT_BROWSERS_PATH).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(repoRoot, '.pw-browsers');

const { buildHarness, distDir } = await import('./harness/build.mjs');
const { startMockCcr } = await import('../test/mock-ccr/server.mjs');
const { createDriver, PROFILES, resolveProfiles } = await import('./cdp/driver.mjs');

const OUT_DIR = path.join(here, 'out');
const SCENARIO_DIR = path.join(here, 'cdp', 'scenarios');
const SCENARIO_TIMEOUT_MS = 60_000;

function parseArgs(argv) {
  const out = { profile: 'default', scenario: null, browser: 'playwright', headed: false, build: true, lenient: process.env.HARNESS_LENIENT === '1', timeoutMs: 10_000, endpoint: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--profile') out.profile = next();
    else if (a.startsWith('--profile=')) out.profile = a.slice(10);
    else if (a === '--scenario') out.scenario = next();
    else if (a.startsWith('--scenario=')) out.scenario = a.slice(11);
    else if (a === '--browser') out.browser = next();
    else if (a.startsWith('--browser=')) out.browser = a.slice(10);
    else if (a === '--headed') out.headed = true;
    else if (a === '--no-build') out.build = false;
    else if (a === '--lenient') out.lenient = true;
    else if (a === '--timeout') out.timeoutMs = Number(next()) || out.timeoutMs;
    else if (a === '--endpoint') out.endpoint = next();
    else if (a === '--help' || a === '-h') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 8).join('\n'));
      process.exit(0);
    } else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

function listScenarios(filter) {
  const files = fs.readdirSync(SCENARIO_DIR).filter((f) => /^\d\d-.*\.mjs$/.test(f)).sort();
  if (!filter) return files;
  const wanted = filter.split(',').map((s) => s.trim());
  const picked = files.filter((f) => wanted.some((w) => f.startsWith(w) || f === `${w}.mjs` || f.replace(/\.mjs$/, '') === w));
  if (!picked.length) throw new Error(`no scenario matches ${filter}; have ${files.join(', ')}`);
  return picked;
}

function pageUrl(baseUrl, profileName, query = {}) {
  const u = new URL('/index.html', baseUrl);
  u.searchParams.set('profile', profileName);
  u.searchParams.set('platform', PROFILES[profileName].platform);
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  return u.toString();
}

async function runScenario({ driver, mock, file, profileName, timeoutMs }) {
  const name = file.replace(/\.mjs$/, '');
  const mod = await import(pathToFileURL(path.join(SCENARIO_DIR, file)).href);
  const meta = mod.meta ?? {};
  const steps = [];
  let failed = false;
  const ctx = {
    mock,
    profile: { name: profileName, ...PROFILES[profileName] },
    scenario: name,
    baseUrl: mock.url,
    timeoutMs,
    note(label, detail) {
      steps.push({ name: label, ok: true, detail: typeof detail === 'string' ? detail : JSON.stringify(detail), info: true });
    },
    async step(label, fn) {
      if (failed) {
        steps.push({ name: label, ok: false, detail: 'skipped after an earlier failure' });
        return;
      }
      const started = Date.now();
      try {
        await fn();
        steps.push({ name: label, ok: true, detail: `${Date.now() - started} ms` });
      } catch (err) {
        failed = true;
        steps.push({ name: label, ok: false, detail: err instanceof Error ? err.message : String(err) });
      }
    },
  };

  mock.reset();
  await driver.setProfile(profileName);
  const url = pageUrl(mock.url, profileName, meta.query);
  try {
    await driver.goto(url);
    await driver.waitForHarness();
  } catch (err) {
    failed = true;
    steps.push({ name: 'harness boot', ok: false, detail: err instanceof Error ? err.message : String(err) });
  }
  if (!failed) {
    const timer = new Promise((_, reject) => setTimeout(() => reject(new Error(`scenario exceeded ${SCENARIO_TIMEOUT_MS} ms`)), SCENARIO_TIMEOUT_MS));
    try {
      await Promise.race([mod.run(driver, ctx), timer]);
    } catch (err) {
      failed = true;
      steps.push({ name: 'scenario', ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
  }
  let screenshot = null;
  try {
    screenshot = path.relative(repoRoot, await driver.screenshot(`${name}-${profileName}`));
  } catch (err) {
    steps.push({ name: 'screenshot', ok: false, detail: err instanceof Error ? err.message : String(err) });
  }
  const consoleErrors = (driver.consoleErrors ?? []).slice(0, 10);
  return { scenario: name, title: meta.title ?? name, profile: profileName, ok: !failed, steps, screenshot, consoleErrors };
}

function printSummary(results) {
  const width = Math.max(...results.map((r) => r.scenario.length), 8);
  console.log('');
  console.log(`${'scenario'.padEnd(width)}  ${'profile'.padEnd(16)}  result  steps`);
  for (const r of results) {
    const okSteps = r.steps.filter((s) => s.ok && !s.info).length;
    const total = r.steps.filter((s) => !s.info).length;
    console.log(`${r.scenario.padEnd(width)}  ${r.profile.padEnd(16)}  ${r.ok ? 'ok    ' : 'FAIL  '}  ${okSteps}/${total}`);
    for (const s of r.steps) {
      if (s.info) console.log(`    note  ${s.name}: ${s.detail}`);
      else if (!s.ok) console.log(`    fail  ${s.name}: ${s.detail}`);
    }
    if (r.consoleErrors.length) console.log(`    console errors: ${r.consoleErrors.slice(0, 3).join(' | ')}`);
  }
  console.log('');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profiles = resolveProfiles(args.profile);
  const scenarios = listScenarios(args.scenario);
  fs.mkdirSync(OUT_DIR, { recursive: true });

  if (args.build) {
    const built = await buildHarness({ lenient: args.lenient });
    for (const m of built.missing) console.warn(`stubbed missing import (lenient build): ${m}`);
  }
  const mock = await startMockCcr({ port: 0, staticDir: distDir });
  let driver = null;
  const results = [];
  try {
    driver = await createDriver({ browser: args.browser, headed: args.headed, outDir: OUT_DIR, timeoutMs: args.timeoutMs, endpoint: args.endpoint, log: (m) => console.log(`  ${m}`) });
    for (const profileName of profiles) {
      for (const file of scenarios) {
        process.stdout.write(`${file.replace(/\.mjs$/, '')} @ ${profileName} ... `);
        const r = await runScenario({ driver, mock, file, profileName, timeoutMs: args.timeoutMs });
        results.push(r);
        console.log(r.ok ? 'ok' : 'FAIL');
      }
    }
  } finally {
    await driver?.close().catch((err) => console.error(`driver close failed: ${err.message}`));
    await mock.close();
  }
  fs.writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(results, null, 2));
  printSummary(results);
  console.log(`report: ${path.relative(process.cwd(), path.join(OUT_DIR, 'report.json'))}`);
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

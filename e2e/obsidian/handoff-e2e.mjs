// Real-Obsidian check of "Sign in a phone or iPad from this Mac" against the mock server (port 8765), in the
// second instance (CDP 9333). One instance plays both devices via app.emulateMobile: the phone publishes its key,
// the Mac signs in and boxes the grant to it, the phone opens it. Uses a throwaway secret id and restores settings.
// Usage: node test/mock-ccr/server.mjs --port 8765 & node e2e/obsidian/handoff-e2e.mjs   (sandbox off)
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const page = browser.contexts()[0].pages().find((p) => p.url().startsWith('app://obsidian.md'));
const ready = () => page.waitForFunction(() => !!window.app?.plugins?.plugins?.claudsidian?.settings, null, { timeout: 30000 });
const ev = async (fn, a) => {
  await ready();
  return page.evaluate(fn, a);
};
// emulateMobile can reload the window
const emulate = async (on) => {
  await ev((o) => window.app.emulateMobile(o), on);
  await page.waitForTimeout(1500);
  await ready();
};
const out = {};
const prior = await ev(() => JSON.stringify(window.app.plugins.plugins.claudsidian.settings));
try {
  await emulate(true);
  await ev(async () => {
    const p = window.app.plugins.plugins.claudsidian;
    window.app.secretStorage.setSecret('handoff-e2e', '');
    await p.saveData({ ...p.settings, authSecretId: 'handoff-e2e', handoffRequest: null, authHandoff: null, apiBaseUrl: 'http://127.0.0.1:8765', oauthTokenUrl: 'http://127.0.0.1:8765/v1/oauth/token' });
    await p.onExternalSettingsChange();
  });
  out.phonePublished = await ev(() => !!window.app.plugins.plugins.claudsidian.settings.handoffRequest?.publicKey);

  await emulate(false);
  await ev(() => window.app.plugins.plugins.claudsidian.openSignInForDevice());
  await page.waitForFunction(() => document.querySelector('.claudsidian-sign-in input[readonly]')?.value.includes('state='));
  await ev(() => {
    const url = new URL(document.querySelector('.claudsidian-sign-in input[readonly]').value);
    const field = document.querySelector('.claudsidian-sign-in .claudsidian-sign-in-row input:not([readonly])');
    field.value = `good#${url.searchParams.get('state')}`; // the mock takes the code "good"
    [...document.querySelectorAll('.claudsidian-sign-in button')].find((b) => b.textContent === 'Finish').click();
  });
  await page
    .waitForFunction(() => !!window.app.plugins.plugins.claudsidian.settings.authHandoff, null, { timeout: 8000 })
    .catch(async () => {
      out.modalError = await ev(() => document.querySelector('.claudsidian-sign-in-error')?.textContent);
    });
  const dataJson = await ev(async () => JSON.stringify(await window.app.plugins.plugins.claudsidian.loadData()));
  out.boxInDataJson = dataJson.includes('"box"');
  out.plaintextInDataJson = /accessToken|refreshToken|mock-access|mock-refresh/i.test(dataJson);
  out.macOwnSecretUntouched = !(await ev(() => window.app.secretStorage.getSecret('handoff-e2e')));

  await emulate(true);
  await ev(() => window.app.plugins.plugins.claudsidian.onExternalSettingsChange());
  out.phoneSignedIn = await ev(() => !!JSON.parse(window.app.secretStorage.getSecret('handoff-e2e') || '{}').accessToken);
  out.cleared = await ev(async () => {
    const d = await window.app.plugins.plugins.claudsidian.loadData();
    return !d.handoffRequest && !d.authHandoff && !window.app.secretStorage.getSecret('claudsidian-handoff-key');
  });
} catch (e) {
  out.error = String(e).slice(0, 300);
} finally {
  await ev(async (s) => {
    const p = window.app.plugins.plugins.claudsidian;
    window.app.secretStorage.setSecret('handoff-e2e', '');
    window.app.secretStorage.setSecret('claudsidian-handoff-key', '');
    await p.saveData(JSON.parse(s));
    await p.onExternalSettingsChange();
  }, prior);
  await emulate(false);
}
console.log(JSON.stringify(out, null, 1));
const ok = out.phonePublished && out.boxInDataJson && !out.plaintextInDataJson && out.macOwnSecretUntouched && out.phoneSignedIn && out.cleared;
console.log(ok ? '[handoff] ok' : '[handoff] FAIL');
await browser.close();
process.exit(ok ? 0 : 1);

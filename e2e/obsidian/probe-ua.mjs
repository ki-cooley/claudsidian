// Probes which request paths inside a real Obsidian renderer can carry a custom User-Agent.
// Needs a second Obsidian instance with --remote-debugging-port and an echo server
// (e2e/obsidian/echo-server.mjs). Usage: node e2e/obsidian/probe-ua.mjs [cdpPort] [echoPort]
import { chromium } from 'playwright';

const cdpPort = Number(process.argv[2] ?? 9333);
const echoPort = Number(process.argv[3] ?? 9876);
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
const page = browser.contexts()[0].pages().find((p) => p.url().startsWith('app://obsidian.md'));
if (!page) throw new Error('no obsidian page over CDP');

const UA = 'anthropic-sdk-typescript/0.94.0 userOAuthProvider';
const TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const BOGUS = {
  grant_type: 'authorization_code',
  code: 'bogus',
  state: 'bogus',
  redirect_uri: 'https://platform.claude.com/oauth/code/callback',
  client_id: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  code_verifier: 'bogusbogusbogusbogusbogusbogusbogusbogusbogus',
};

const result = await page.evaluate(
  async ({ echoPort, UA, TOKEN_URL, BOGUS }) => {
    // The renderer cannot require('obsidian'); go through the plugin's own transport (requestUrl under the hood).
    for (const b of document.querySelectorAll('.modal-close-button')) b.click();
    const plugins = window.app.plugins;
    if (!plugins.isEnabled?.()) await plugins.setEnable(true);
    if (!plugins.plugins['claudsidian']) await plugins.enablePluginAndSave('claudsidian');
    for (let i = 0; i < 50 && !plugins.plugins['claudsidian']; i++) await new Promise((r) => setTimeout(r, 200));
    const plugin = plugins.plugins['claudsidian'];
    if (!plugin) return { error: 'plugin did not load' };
    const transport = plugin.auth.deps.transport;
    const requestUrl = async (o) => {
      const r = await transport({ method: o.method, url: o.url, headers: o.headers, body: o.body });
      return { status: r.status, text: r.text, headers: r.headers };
    };
    const out = {};
    const headers = { 'Content-Type': 'application/json', 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': UA };

    // 1. requestUrl -> echo: what headers actually leave the app?
    try {
      const r = await requestUrl({ url: `http://127.0.0.1:${echoPort}/echo`, method: 'POST', headers, body: '{}', contentType: 'application/json', throw: false });
      const seen = JSON.parse(r.text).headers;
      out.requestUrl_echo = { status: r.status, 'user-agent': seen['user-agent'], 'anthropic-beta': seen['anthropic-beta'], keys: Object.keys(seen) };
    } catch (e) {
      out.requestUrl_echo = { error: String(e?.message ?? e) };
    }

    // 2. requestUrl -> real token endpoint with a bogus code: 400 means the edge let us through, 429 means it did not.
    try {
      const r = await requestUrl({ url: TOKEN_URL, method: 'POST', headers, body: JSON.stringify(BOGUS), contentType: 'application/json', throw: false });
      out.requestUrl_token = { status: r.status, text: (r.text ?? '').slice(0, 160), requestId: r.headers?.['request-id'] };
    } catch (e) {
      out.requestUrl_token = { error: String(e?.message ?? e) };
    }

    // 3. fetch -> echo and token endpoint (Chromium may refuse to override the UA, and CORS may block).
    try {
      const r = await fetch(`http://127.0.0.1:${echoPort}/echo`, { method: 'POST', headers, body: '{}' });
      const seen = (await r.json()).headers;
      out.fetch_echo = { status: r.status, 'user-agent': seen['user-agent'], origin: seen['origin'], 'sec-fetch-mode': seen['sec-fetch-mode'] };
    } catch (e) {
      out.fetch_echo = { error: String(e?.message ?? e) };
    }
    try {
      const r = await fetch(TOKEN_URL, { method: 'POST', headers, body: JSON.stringify(BOGUS) });
      out.fetch_token = { status: r.status, text: (await r.text()).slice(0, 160) };
    } catch (e) {
      out.fetch_token = { error: String(e?.message ?? e) };
    }

    // 4. Node https from the renderer (desktop only): the curl-equivalent path.
    try {
      const https = require('https');
      out.node_https_token = await new Promise((resolve) => {
        const body = JSON.stringify(BOGUS);
        const req = https.request(TOKEN_URL, { method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } }, (res) => {
          let text = '';
          res.on('data', (c) => (text += c));
          res.on('end', () => resolve({ status: res.statusCode, text: text.slice(0, 160), requestId: res.headers['request-id'] }));
        });
        req.on('error', (e) => resolve({ error: String(e?.message ?? e) }));
        req.end(body);
      });
    } catch (e) {
      out.node_https_token = { error: String(e?.message ?? e) };
    }

    out.navigatorUA = navigator.userAgent;
    out.platform = { isMobile: !!window.app.isMobile, pluginVersion: plugin.manifest.version };
    return out;
  },
  { echoPort, UA, TOKEN_URL, BOGUS },
);
console.log(JSON.stringify(result, null, 2));
await browser.close().catch(() => {});

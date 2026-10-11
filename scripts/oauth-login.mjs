#!/usr/bin/env node
// Runs the same PKCE sign-in the plugin uses, from a terminal, and keeps the tokens in a private
// env file so live tests can run without a fresh authorization each time.
//
//   node scripts/oauth-login.mjs begin            prints the claude.ai URL to open; saves the verifier
//   node scripts/oauth-login.mjs finish <code>    exchanges the pasted code (code or code#state); writes the env file
//   node scripts/oauth-login.mjs refresh          refreshes the access token in place
//   node scripts/oauth-login.mjs show             prints expiry and org uuid, never the tokens
//
// Env file: $CLAUDSIDIAN_OAUTH_ENV or ~/workspace/private/claudsidian-oauth/token.env (mode 600).
// Keys: CLAUDSIDIAN_ACCESS_TOKEN, CLAUDSIDIAN_REFRESH_TOKEN, CLAUDSIDIAN_EXPIRES_AT (ms), CLAUDSIDIAN_ORG_UUID, CLAUDSIDIAN_SCOPES.
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import https from 'node:https';

const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback';
const SCOPES = ['org:create_api_key', 'user:profile', 'user:inference', 'user:sessions:claude_code'];
const AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const TOKEN_URL = 'https://api.anthropic.com/v1/oauth/token';
const PROFILE_URL = 'https://api.anthropic.com/api/oauth/profile';
// The token endpoint's edge answers 429 to anything but the SDK user agent (docs/protocol.md).
const USER_AGENT = 'anthropic-sdk-typescript/0.94.0 userOAuthProvider';

const dir = process.env.CLAUDSIDIAN_OAUTH_ENV
  ? path.dirname(process.env.CLAUDSIDIAN_OAUTH_ENV)
  : path.join(homedir(), 'workspace', 'private', 'claudsidian-oauth');
const envFile = process.env.CLAUDSIDIAN_OAUTH_ENV ?? path.join(dir, 'token.env');
const pendingFile = path.join(dir, 'pending.json');

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

function writePrivate(file, text) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(file, text, { mode: 0o600 });
  chmodSync(file, 0o600);
}

function request(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = https.request(
      url,
      { method, headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}), ...headers } },
      (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let json;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode ?? 0, text, json, requestId: res.headers['request-id'] });
        });
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

function readEnv() {
  if (!existsSync(envFile)) return {};
  const out = {};
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  return out;
}

function writeEnv(e) {
  // Quoted so the file can be sourced by a shell (scopes contain spaces).
  const lines = Object.entries(e).map(([k, v]) => `${k}="${String(v).replace(/"/g, '')}"`);
  writePrivate(envFile, lines.join('\n') + '\n');
}

async function orgUuid(accessToken) {
  const r = await request('GET', PROFILE_URL, { Authorization: `Bearer ${accessToken}` });
  return r.json?.organization?.uuid ?? r.json?.org_uuid ?? '';
}

async function storeTokenResponse(json, prev = {}) {
  if (!json?.access_token) throw new Error('token response had no access_token');
  const expiresAt = Date.now() + Number(json.expires_in ?? 3600) * 1000;
  const env = {
    CLAUDSIDIAN_ACCESS_TOKEN: json.access_token,
    CLAUDSIDIAN_REFRESH_TOKEN: json.refresh_token ?? prev.CLAUDSIDIAN_REFRESH_TOKEN ?? '',
    CLAUDSIDIAN_EXPIRES_AT: String(expiresAt),
    CLAUDSIDIAN_SCOPES: json.scope ?? prev.CLAUDSIDIAN_SCOPES ?? SCOPES.join(' '),
    CLAUDSIDIAN_ORG_UUID: json.organization?.uuid ?? json.org_uuid ?? prev.CLAUDSIDIAN_ORG_UUID ?? '',
  };
  if (!env.CLAUDSIDIAN_ORG_UUID) env.CLAUDSIDIAN_ORG_UUID = await orgUuid(env.CLAUDSIDIAN_ACCESS_TOKEN);
  writeEnv(env);
  return env;
}

const [, , cmd, arg] = process.argv;

if (cmd === 'begin') {
  const verifier = b64url(randomBytes(32));
  const state = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('code', 'true');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  writePrivate(pendingFile, JSON.stringify({ verifier, state, startedAt: Date.now() }));
  console.log(url.toString());
} else if (cmd === 'finish') {
  if (!arg) throw new Error('usage: finish <code or code#state>');
  if (!existsSync(pendingFile)) throw new Error('run begin first');
  const pending = JSON.parse(readFileSync(pendingFile, 'utf8'));
  const raw = arg.trim();
  let code = raw;
  let state;
  if (/^https?:\/\//i.test(raw)) {
    const u = new URL(raw);
    code = u.searchParams.get('code') ?? '';
    state = u.searchParams.get('state') ?? undefined;
  } else if (raw.includes('#')) {
    [code, state] = raw.split('#', 2);
  }
  if (state && state !== pending.state) throw new Error('state mismatch: run begin again and use the new URL');
  const r = await request('POST', TOKEN_URL, { 'anthropic-beta': 'oauth-2025-04-20' }, {
    grant_type: 'authorization_code',
    code,
    state: pending.state,
    code_verifier: pending.verifier,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
  });
  if (r.status < 200 || r.status >= 300) throw new Error(`exchange failed: HTTP ${r.status} ${r.text.slice(0, 300)}`);
  const env = await storeTokenResponse(r.json);
  writePrivate(pendingFile, '{}');
  console.log(`signed in; tokens in ${envFile}; org ${env.CLAUDSIDIAN_ORG_UUID || '(unknown)'}; scopes ${env.CLAUDSIDIAN_SCOPES}; expires ${new Date(Number(env.CLAUDSIDIAN_EXPIRES_AT)).toISOString()}`);
} else if (cmd === 'refresh') {
  const prev = readEnv();
  if (!prev.CLAUDSIDIAN_REFRESH_TOKEN) throw new Error('no refresh token on file');
  const r = await request('POST', TOKEN_URL, { 'anthropic-beta': 'oauth-2025-04-20' }, {
    grant_type: 'refresh_token',
    refresh_token: prev.CLAUDSIDIAN_REFRESH_TOKEN,
    client_id: CLIENT_ID,
  });
  if (r.status < 200 || r.status >= 300) throw new Error(`refresh failed: HTTP ${r.status} ${r.text.slice(0, 300)}`);
  const env = await storeTokenResponse(r.json, prev);
  console.log(`refreshed; expires ${new Date(Number(env.CLAUDSIDIAN_EXPIRES_AT)).toISOString()}`);
} else if (cmd === 'show') {
  const e = readEnv();
  if (!e.CLAUDSIDIAN_ACCESS_TOKEN) {
    console.log(`no token on file (${envFile})`);
  } else {
    const left = Math.round((Number(e.CLAUDSIDIAN_EXPIRES_AT) - Date.now()) / 60000);
    console.log(`token on file: org ${e.CLAUDSIDIAN_ORG_UUID || '(unknown)'}; scopes ${e.CLAUDSIDIAN_SCOPES}; expires in ${left} min; refresh token ${e.CLAUDSIDIAN_REFRESH_TOKEN ? 'present' : 'missing'}`);
  }
} else {
  console.error('usage: oauth-login.mjs begin | finish <code> | refresh | show');
  process.exit(2);
}

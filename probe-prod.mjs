/**
 * Probe prod backend directly via WebSocket to see what it returns.
 * Reads the auth token from the local test vault's data.json (so it's
 * never committed to the repo).
 */
import WebSocket from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataJsonPath =
  process.env.CLAUDSIDIAN_DATA_JSON ||
  path.join(os.homedir(), 'yes-chef-test', '.obsidian', 'plugins', 'claudsidian', 'data.json');

const data = JSON.parse(fs.readFileSync(dataJsonPath, 'utf8'));
const provider = data.providers.find((p) => p.type === 'backend');
if (!provider?.backendUrl || !provider?.authToken) {
  console.error('Could not read backend URL/token from', dataJsonPath);
  process.exit(1);
}

const URL = `${provider.backendUrl}/?token=${encodeURIComponent(provider.authToken)}`;

const ws = new WebSocket(URL);
const timeout = setTimeout(() => {
  console.error('Timed out waiting for messages');
  process.exit(1);
}, 30000);

ws.on('open', () => {
  console.log('connected');
  ws.send(JSON.stringify({
    type: 'prompt',
    id: 'probe-' + Date.now(),
    prompt: 'say hi',
    model: 'claude-haiku-4-5-20251001',
  }));
});

ws.on('message', (raw) => {
  try {
    const msg = JSON.parse(raw.toString());
    const summary = { type: msg.type };
    if (msg.text) summary.text = msg.text.slice(0, 80);
    if (msg.code) summary.code = msg.code;
    if (msg.message) summary.message = String(msg.message).slice(0, 200);
    if (msg.sessionId) summary.sessionId = msg.sessionId;
    if (msg.requestId) summary.requestId = msg.requestId;
    if (msg.delta?.content) summary.content = msg.delta.content.slice(0, 80);
    console.log(JSON.stringify(summary));
    if (msg.type === 'agent_event' && msg.event?.type === 'complete') {
      clearTimeout(timeout);
      ws.close();
    }
    if (msg.type === 'agent_event' && msg.event?.type === 'error') {
      console.log('ERROR EVENT:', JSON.stringify(msg.event));
      clearTimeout(timeout);
      ws.close();
    }
    if (msg.type === 'error') {
      console.log('ERROR:', JSON.stringify(msg));
      clearTimeout(timeout);
      ws.close();
    }
  } catch {
    console.log('raw:', raw.toString().slice(0, 200));
  }
});

ws.on('close', () => {
  console.log('closed');
  process.exit(0);
});
ws.on('error', (e) => {
  console.error('err:', e.message);
  process.exit(2);
});

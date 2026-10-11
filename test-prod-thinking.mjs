import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const AUTH_TOKEN = process.env.AUTH_TOKEN || 'dev-token';
const ws = new WebSocket(`wss://claudsidian-production.up.railway.app?token=${encodeURIComponent(AUTH_TOKEN)}`);
const start = Date.now();
const t = () => `+${((Date.now() - start) / 1000).toFixed(1)}s`;
let thinking = 0, text = 0;

const timeout = setTimeout(() => { console.log(`[${t()}] TIMEOUT`); ws.close(); process.exit(1); }, 60000);

ws.on('open', () => {
  console.log(`[${t()}] Connected to production`);
  ws.send(JSON.stringify({ type: 'prompt', id: randomUUID(), prompt: 'Say hello in one sentence.' }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  switch (msg.type) {
    case 'thinking': thinking++; console.log(`[${t()}] THINKING #${thinking}`); break;
    case 'text_delta': if (++text === 1) console.log(`[${t()}] FIRST TEXT: "${msg.text}"`); break;
    case 'rpc_request':
      ws.send(JSON.stringify({ type: 'rpc_response', id: msg.id, error: { code: 'NA', message: 'test' } }));
      break;
    case 'complete':
      console.log(`[${t()}] DONE — Thinking: ${thinking}, Text: ${text}`);
      console.log(thinking > 0 ? '✓ Deploy includes synthetic thinking' : '✗ Old deploy still serving');
      clearTimeout(timeout); ws.close(); break;
    case 'error': console.log(`[${t()}] ERROR: ${msg.code}: ${msg.message}`); break;
  }
});
ws.on('error', (e) => { console.error(e.message); process.exit(1); });
ws.on('close', () => process.exit(0));

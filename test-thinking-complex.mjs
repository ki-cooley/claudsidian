import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const ws = new WebSocket('ws://localhost:3001?token=dev-token');
const start = Date.now();
const t = () => `+${((Date.now() - start) / 1000).toFixed(1)}s`;
let thinking = 0, text = 0;

const timeout = setTimeout(() => { console.log(`\n[${t()}] TIMEOUT`); ws.close(); process.exit(1); }, 120000);

ws.on('open', () => {
  console.log(`[${t()}] Connected, sending complex prompt...`);
  ws.send(JSON.stringify({
    type: 'prompt',
    id: randomUUID(),
    prompt: 'I need you to think carefully about this: What are the philosophical implications of Gödel\'s incompleteness theorems for artificial intelligence? Give me a nuanced 3-paragraph analysis.',
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  switch (msg.type) {
    case 'thinking':
      thinking++;
      if (thinking <= 5) console.log(`[${t()}] THINKING #${thinking}: "${msg.text.substring(0, 120)}..."`);
      else if (thinking === 6) console.log(`[${t()}] THINKING ... (${thinking}+ events, suppressing)`);
      break;
    case 'text_delta':
      if (++text === 1) console.log(`[${t()}] FIRST TEXT: "${msg.text.substring(0, 60)}"`);
      break;
    case 'rpc_request':
      ws.send(JSON.stringify({ type: 'rpc_response', id: msg.id, error: { code: 'NA', message: 'test' } }));
      break;
    case 'complete':
      console.log(`\n[${t()}] DONE — Thinking: ${thinking}, Text deltas: ${text}`);
      console.log(thinking === 0 ? '\n⚠️  SDK does NOT forward thinking tokens.' : '\n✓  Thinking tokens flow!');
      clearTimeout(timeout); ws.close();
      break;
    case 'error':
      console.log(`[${t()}] ERROR: ${msg.code}: ${msg.message}`);
      break;
    case 'pong': break;
    default: break;
  }
});
ws.on('error', (e) => { console.error(e.message); process.exit(1); });
ws.on('close', () => process.exit(0));

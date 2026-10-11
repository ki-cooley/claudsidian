/**
 * Quick test to verify if the backend returns thinking tokens.
 * Connects to local backend, sends a simple prompt, logs all events.
 */
import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:3001';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'dev-token';
const TIMEOUT_MS = 120_000;

const wsUrl = `${SERVER_URL}?token=${encodeURIComponent(AUTH_TOKEN)}`;
console.log(`Connecting to ${SERVER_URL}...`);

const ws = new WebSocket(wsUrl);
const startTime = Date.now();
const elapsed = () => `+${((Date.now() - startTime) / 1000).toFixed(1)}s`;

let thinkingCount = 0;
let textCount = 0;
let toolCount = 0;

const timeout = setTimeout(() => {
  console.log(`\n[${elapsed()}] TIMEOUT after ${TIMEOUT_MS / 1000}s`);
  ws.close();
  process.exit(1);
}, TIMEOUT_MS);

ws.on('open', () => {
  console.log(`[${elapsed()}] Connected`);

  const id = randomUUID();
  const msg = {
    type: 'prompt',
    id,
    prompt: 'Say hello in exactly one sentence.',
  };

  console.log(`[${elapsed()}] Sending prompt: "${msg.prompt}"`);
  ws.send(JSON.stringify(msg));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  switch (msg.type) {
    case 'thinking':
      thinkingCount++;
      if (thinkingCount <= 3) {
        console.log(`[${elapsed()}] THINKING #${thinkingCount}: "${msg.text.substring(0, 100)}${msg.text.length > 100 ? '...' : ''}"`);
      } else if (thinkingCount === 4) {
        console.log(`[${elapsed()}] THINKING #${thinkingCount}+ (suppressing further)`);
      }
      break;

    case 'text_delta':
      textCount++;
      if (textCount === 1) {
        console.log(`[${elapsed()}] FIRST TEXT DELTA: "${msg.text}"`);
      }
      process.stdout.write(textCount === 1 ? '' : msg.text);
      break;

    case 'tool_start':
      toolCount++;
      console.log(`[${elapsed()}] TOOL_START: ${msg.toolName}`);
      break;

    case 'tool_end':
      console.log(`[${elapsed()}] TOOL_END: ${msg.toolName}`);
      break;

    case 'rpc_request':
      // Respond to vault RPCs with errors (no real vault)
      console.log(`[${elapsed()}] RPC: ${msg.method}(${JSON.stringify(msg.params).substring(0, 80)})`);
      ws.send(JSON.stringify({
        type: 'rpc_response',
        id: msg.id,
        error: { code: 'NOT_AVAILABLE', message: 'Test mode - no vault' },
      }));
      break;

    case 'complete':
      console.log(`\n\n[${elapsed()}] COMPLETE`);
      console.log(`\nSummary:`);
      console.log(`  Thinking events: ${thinkingCount}`);
      console.log(`  Text deltas:     ${textCount}`);
      console.log(`  Tool calls:      ${toolCount}`);
      console.log(`  Total time:      ${elapsed()}`);

      if (thinkingCount === 0) {
        console.log(`\n⚠️  NO THINKING TOKENS received — the SDK may not forward them.`);
      } else {
        console.log(`\n✓  Thinking tokens ARE flowing.`);
      }

      clearTimeout(timeout);
      ws.close();
      break;

    case 'error':
      console.log(`[${elapsed()}] ERROR: ${msg.code}: ${msg.message}`);
      break;

    case 'pong':
      break;

    default:
      console.log(`[${elapsed()}] ${msg.type}: ${JSON.stringify(msg).substring(0, 100)}`);
  }
});

ws.on('close', () => {
  clearTimeout(timeout);
  process.exit(0);
});

ws.on('error', (err) => {
  console.error(`[${elapsed()}] WS ERROR: ${err.message}`);
  clearTimeout(timeout);
  process.exit(1);
});

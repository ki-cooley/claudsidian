/**
 * Test multi-turn conversation context.
 * Turn 1: Tell the agent a fact.
 * Turn 2: Ask it to recall the fact (proves context is maintained).
 */
import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const AUTH_TOKEN = process.env.AUTH_TOKEN || 'dev-token';
const URL = 'ws://localhost:3001';
const CLIENT_ID = 'test-client';
const CONV_ID = 'test-multiturn-' + randomUUID().substring(0, 8);
const start = Date.now();
const t = () => `+${((Date.now() - start) / 1000).toFixed(1)}s`;

const ws = new WebSocket(`${URL}?token=${AUTH_TOKEN}`);
let turn = 0;
let responseText = '';
const timeout = setTimeout(() => { console.log('TIMEOUT'); ws.close(); process.exit(1); }, 180000);

ws.on('open', () => {
  console.log(`[${t()}] Connected. ConversationId: ${CONV_ID}\n`);
  sendTurn1();
});

function sendTurn1() {
  turn = 1;
  responseText = '';
  console.log(`[${t()}] TURN 1: Telling agent a secret fact...`);
  ws.send(JSON.stringify({
    type: 'prompt',
    id: randomUUID(),
    prompt: 'Remember this secret code: BLUE-WHALE-42. Just acknowledge you have it, nothing else.',
    clientId: CLIENT_ID,
    conversationId: CONV_ID,
  }));
}

function sendTurn2() {
  turn = 2;
  responseText = '';
  console.log(`\n[${t()}] TURN 2: Asking agent to recall the fact...`);
  ws.send(JSON.stringify({
    type: 'prompt',
    id: randomUUID(),
    prompt: 'What was the secret code I told you? Just state it.',
    clientId: CLIENT_ID,
    conversationId: CONV_ID,
  }));
}

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  switch (msg.type) {
    case 'session_created':
      console.log(`[${t()}] Turn ${turn} session: ${msg.sessionId}`);
      break;
    case 'thinking':
      break;
    case 'text_delta':
      responseText += msg.text;
      break;
    case 'rpc_request':
      ws.send(JSON.stringify({
        type: 'rpc_response', id: msg.id,
        error: { code: 'NA', message: 'test mode' },
      }));
      break;
    case 'complete':
      console.log(`[${t()}] Turn ${turn} response: "${responseText.trim()}"`);
      if (turn === 1) {
        // Wait a moment then send turn 2
        setTimeout(sendTurn2, 1000);
      } else {
        // Check if turn 2 recalled the fact
        const hasCode = responseText.includes('BLUE-WHALE-42');
        console.log(`\n[${t()}] ${hasCode ? '✓ SUCCESS' : '✗ FAIL'}: Agent ${hasCode ? 'remembered' : 'forgot'} the secret code`);
        clearTimeout(timeout);
        ws.close();
      }
      break;
    case 'error':
      console.log(`[${t()}] ERROR: ${msg.code}: ${msg.message}`);
      break;
  }
});

ws.on('close', () => process.exit(0));
ws.on('error', (e) => { console.error(e.message); process.exit(1); });

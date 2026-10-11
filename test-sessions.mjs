/**
 * Test session persistence: create a session, disconnect, reconnect, resume.
 */
import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const AUTH_TOKEN = process.env.AUTH_TOKEN || 'dev-token';
const URL = 'ws://localhost:3001';
const CLIENT_ID = 'test-client-' + randomUUID().substring(0, 8);
const CONV_ID = 'test-conv-' + randomUUID().substring(0, 8);
const start = Date.now();
const t = () => `+${((Date.now() - start) / 1000).toFixed(1)}s`;

let sessionId = null;
let eventsBeforeDisconnect = 0;

console.log(`[${t()}] Test: session persistence with disconnect/reconnect`);
console.log(`  clientId: ${CLIENT_ID}`);
console.log(`  conversationId: ${CONV_ID}\n`);

// Phase 1: Connect, send prompt, get session_created, disconnect mid-stream
const ws1 = new WebSocket(`${URL}?token=${AUTH_TOKEN}`);

ws1.on('open', () => {
  console.log(`[${t()}] Phase 1: Connected, sending prompt...`);
  ws1.send(JSON.stringify({
    type: 'prompt',
    id: randomUUID(),
    prompt: 'Write a 3-paragraph essay about the color blue.',
    clientId: CLIENT_ID,
    conversationId: CONV_ID,
  }));
});

ws1.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  switch (msg.type) {
    case 'session_created':
      sessionId = msg.sessionId;
      console.log(`[${t()}] Got session_created: ${sessionId}`);
      break;
    case 'rpc_request':
      // Respond to vault RPCs
      ws1.send(JSON.stringify({ type: 'rpc_response', id: msg.id, error: { code: 'NA', message: 'test' } }));
      break;
    case 'thinking':
      eventsBeforeDisconnect++;
      break;
    case 'text_delta':
      eventsBeforeDisconnect++;
      if (eventsBeforeDisconnect === 3) {
        // Disconnect after 3 text events to simulate closing Obsidian
        console.log(`[${t()}] Got ${eventsBeforeDisconnect} events, disconnecting to simulate Obsidian close...`);
        ws1.close();
      }
      break;
    case 'complete':
      // Shouldn't get here if we disconnect mid-stream
      console.log(`[${t()}] Got complete (no disconnect needed)`);
      break;
  }
});

ws1.on('close', () => {
  console.log(`[${t()}] Phase 1: Disconnected\n`);

  if (!sessionId) {
    console.log('ERROR: No session ID received');
    process.exit(1);
  }

  // Wait 2 seconds then reconnect and resume
  setTimeout(startPhase2, 2000);
});

ws1.on('error', (e) => { console.error(e.message); process.exit(1); });

// Phase 2: Reconnect and resume session
function startPhase2() {
  console.log(`[${t()}] Phase 2: Reconnecting and resuming session ${sessionId}...`);

  const ws2 = new WebSocket(`${URL}?token=${AUTH_TOKEN}`);
  let replayEvents = 0;
  let liveEvents = 0;
  let gotReplay = false;

  const timeout = setTimeout(() => {
    console.log(`[${t()}] TIMEOUT`);
    ws2.close();
    process.exit(1);
  }, 120000);

  ws2.on('open', () => {
    console.log(`[${t()}] Reconnected, sending session_resume...`);
    ws2.send(JSON.stringify({
      type: 'session_resume',
      sessionId,
      clientId: CLIENT_ID,
    }));
  });

  ws2.on('message', (data) => {
    const msg = JSON.parse(data.toString());

    switch (msg.type) {
      case 'session_replay':
        gotReplay = true;
        replayEvents = msg.events.length;
        console.log(`[${t()}] Got session_replay: ${replayEvents} buffered events, isComplete: ${msg.isComplete}`);

        if (msg.isComplete) {
          console.log(`\n[${t()}] SUCCESS: Session completed while disconnected!`);
          console.log(`  Events before disconnect: ${eventsBeforeDisconnect}`);
          console.log(`  Events in replay: ${replayEvents}`);
          clearTimeout(timeout);
          ws2.close();
        }
        break;

      case 'text_delta':
        liveEvents++;
        break;

      case 'rpc_request':
        ws2.send(JSON.stringify({ type: 'rpc_response', id: msg.id, error: { code: 'NA', message: 'test' } }));
        break;

      case 'complete':
        console.log(`\n[${t()}] SUCCESS: Session completed (live after resume)`);
        console.log(`  Events before disconnect: ${eventsBeforeDisconnect}`);
        console.log(`  Events in replay: ${replayEvents}`);
        console.log(`  Live events after resume: ${liveEvents}`);
        clearTimeout(timeout);
        ws2.close();
        break;

      case 'error':
        if (msg.code === 'SESSION_NOT_FOUND') {
          console.log(`[${t()}] Session expired or not found — expected if agent completed quickly`);
        } else {
          console.log(`[${t()}] ERROR: ${msg.code}: ${msg.message}`);
        }
        break;
    }
  });

  ws2.on('close', () => {
    clearTimeout(timeout);
    process.exit(0);
  });

  ws2.on('error', (e) => { console.error(e.message); process.exit(1); });
}

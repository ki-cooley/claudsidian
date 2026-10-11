/**
 * Backend protocol test for interrupt + aside.
 *
 * Connects to a local mock-mode backend and verifies the server handles the
 * new ClientMessage types ('interrupt' and 'aside') without crashing. Reads
 * the backend log to confirm handler-level logging fired ("Injecting aside
 * into session …", "Interrupting session …").
 *
 * This is a protocol/wiring test. The mock agent doesn't read from the
 * input queue (its signature pre-dates the inputQueue parameter), so the
 * full aside-roundtrip behaviour cannot be observed against a mock — that
 * needs a real Anthropic Agent SDK call. We document the gap.
 */
import WebSocket from 'ws';
import fs from 'node:fs';

const URL = process.env.WS_URL || 'ws://127.0.0.1:3099/?token=dev-token';
const LOG = process.env.LOG_PATH || '/tmp/claudsidian-backend.log';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readLog() {
  try { return fs.readFileSync(LOG, 'utf8'); } catch { return ''; }
}

function logTail(beforeBytes) {
  return readLog().slice(beforeBytes);
}

async function withConnection(fn) {
  const ws = new WebSocket(URL);
  const opened = new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  await opened;
  const messages = [];
  ws.on('message', (raw) => {
    try { messages.push(JSON.parse(raw.toString())); } catch {}
  });
  try { return await fn(ws, messages); }
  finally { ws.close(); await sleep(50); }
}

function send(ws, obj) {
  return new Promise((res) => {
    ws.send(JSON.stringify(obj), () => res());
  });
}

async function waitForLog(predicate, { timeoutMs = 4000, fromByte = 0 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tail = logTail(fromByte);
    if (predicate(tail)) return true;
    await sleep(100);
  }
  return false;
}

async function testInterrupt() {
  console.log('--- Test: interrupt ---');
  return withConnection(async (ws, messages) => {
    const before = readLog().length;
    const id = 'test-int-' + Date.now();
    await send(ws, {
      type: 'prompt',
      id,
      prompt: 'show me the moon',
      conversationId: id,
    });

    // Give backend a moment to start the session and stream a chunk
    await sleep(150);

    // Send interrupt
    await send(ws, { type: 'interrupt', id });

    const sawInterrupt = await waitForLog(
      (t) => /Interrupting session/i.test(t),
      { fromByte: before },
    );
    console.log('  saw "Interrupting session" log:', sawInterrupt);

    // Confirm session emits a cancellation/error or just stops cleanly.
    await sleep(500);
    const types = messages.map((m) => m.type);
    console.log('  message types received:', types);
    return sawInterrupt;
  });
}

async function testAside() {
  console.log('\n--- Test: aside ---');
  return withConnection(async (ws, messages) => {
    const before = readLog().length;
    const id = 'test-aside-' + Date.now();
    await send(ws, {
      type: 'prompt',
      id,
      // Default scenario streams a longish help message — gives time for the aside to be pushed.
      prompt: 'hello there friend',
      conversationId: id,
    });

    // Wait briefly so the session is created and the input queue is registered
    await sleep(120);

    const asideText = 'and also include hidden ones if you can';
    await send(ws, { type: 'aside', id, message: asideText });

    const sawAside = await waitForLog(
      (t) => /Injecting aside for requestId/i.test(t),
      { fromByte: before },
    );
    console.log('  saw "Injecting aside" log:', sawAside);

    // Wait for the mock to finish streaming
    await sleep(2500);
    const types = messages.map((m) => m.type);
    console.log('  message types received:', types);

    // The mock now surfaces asides as `[mock saw aside: "..."]` text deltas.
    const allText = messages
      .filter((m) => m.type === 'text_delta')
      .map((m) => m.text)
      .join('');
    const mockReflectedAside = allText.includes(`[mock saw aside: "${asideText}"]`);
    console.log('  mock reflected aside in text:', mockReflectedAside);
    return sawAside && mockReflectedAside;
  });
}

async function testAsideOnUnknownSession() {
  console.log('\n--- Test: aside referencing missing session ---');
  return withConnection(async (ws) => {
    const before = readLog().length;
    await send(ws, {
      type: 'aside',
      id: 'no-such-session',
      message: 'this should be a no-op with a warning',
    });
    const sawWarn = await waitForLog(
      (t) => /no active input queue for requestId/i.test(t),
      { fromByte: before },
    );
    console.log('  saw "no active input queue" warning:', sawWarn);
    return sawWarn;
  });
}

async function testInterruptOnUnknownSession() {
  console.log('\n--- Test: interrupt referencing missing session ---');
  return withConnection(async (ws) => {
    const before = readLog().length;
    await send(ws, { type: 'interrupt', id: 'no-such-session' });
    const sawWarn = await waitForLog(
      (t) => /Interrupt: session for requestId no-such-session not found/i.test(t),
      { fromByte: before },
    );
    console.log('  saw "session ... not found" warning:', sawWarn);
    return sawWarn;
  });
}

async function main() {
  const r1 = await testInterrupt();
  const r2 = await testAside();
  const r3 = await testAsideOnUnknownSession();
  const r4 = await testInterruptOnUnknownSession();
  const allPassed = r1 && r2 && r3 && r4;
  console.log('\n=== Summary ===');
  console.log('interrupt happy path:           ', r1 ? 'PASS' : 'FAIL');
  console.log('aside happy path:               ', r2 ? 'PASS' : 'FAIL');
  console.log('aside missing session warns:    ', r3 ? 'PASS' : 'FAIL');
  console.log('interrupt missing session warns:', r4 ? 'PASS' : 'FAIL');
  process.exit(allPassed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});

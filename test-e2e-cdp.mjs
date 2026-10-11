/**
 * E2E test via Chrome DevTools Protocol.
 * Connects to Obsidian's debug port, sends chat messages via JS evaluation,
 * and verifies multi-turn context + session persistence.
 */
import WebSocket from 'ws';

const DEBUG_URL = process.argv[2];
if (!DEBUG_URL) {
  console.error('Usage: node test-e2e-cdp.mjs <webSocketDebuggerUrl>');
  process.exit(1);
}

const start = Date.now();
const t = () => `+${((Date.now() - start) / 1000).toFixed(1)}s`;
let msgId = 0;

const ws = new WebSocket(DEBUG_URL);

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 30000);
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) {
        clearTimeout(timeout);
        ws.removeListener('message', handler);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'JS error');
  }
  return result.result?.value;
}

async function run() {
  console.log(`[${t()}] Connected to Obsidian via CDP\n`);

  // Step 1: Check if backend is connected
  const connected = await evaluate(`
    (async () => {
      // Access the webSocketClient singleton
      const mod = await import('/src/core/backend/instance.ts');
      return mod.webSocketClient?.isConnected || false;
    })()
  `).catch(() => null);

  // Try alternative: check via the global app object
  const pluginCheck = await evaluate(`
    (() => {
      const app = window.app;
      if (!app) return 'no app';
      const plugin = app.plugins?.plugins?.['claudsidian'];
      if (!plugin) return 'no plugin';
      return 'plugin loaded';
    })()
  `);
  console.log(`[${t()}] Plugin status: ${pluginCheck}`);

  // Step 2: Check console for backend connection messages
  await send('Runtime.enable');
  const consoleMessages = await evaluate(`
    (() => {
      // Check if plugin connected to backend by looking at the DOM
      const statusEl = document.querySelector('.smtcmp-connection-status');
      const chatPanel = document.querySelector('.smtcmp-chat-container');
      return JSON.stringify({
        hasStatusEl: !!statusEl,
        statusText: statusEl?.textContent || '',
        hasChatPanel: !!chatPanel,
      });
    })()
  `);
  console.log(`[${t()}] DOM check: ${consoleMessages}`);

  // Step 3: Find and interact with the chat input
  // The chat input is a ProseMirror editor - we need to find it and programmatically set content
  const inputInfo = await evaluate(`
    (() => {
      const inputs = document.querySelectorAll('.smtcmp-chat-input-container .ProseMirror, .smtcmp-chat-user-input .ProseMirror, [contenteditable="true"]');
      const results = [];
      inputs.forEach((el, i) => {
        results.push({
          i,
          tag: el.tagName,
          class: el.className.substring(0, 60),
          editable: el.contentEditable,
          parent: el.parentElement?.className?.substring(0, 40) || '',
        });
      });
      return JSON.stringify(results, null, 2);
    })()
  `);
  console.log(`[${t()}] Contenteditable elements: ${inputInfo}`);

  // Step 4: Send a message by simulating input into the chat
  console.log(`\n[${t()}] TURN 1: Sending "Remember ALPHA-BRAVO-99"...`);

  const sendResult = await evaluate(`
    (() => {
      // Find the chat input ProseMirror editor
      const chatContainer = document.querySelector('.smtcmp-chat-input-container');
      if (!chatContainer) return 'no chat container found';

      const proseMirror = chatContainer.querySelector('.ProseMirror');
      if (!proseMirror) return 'no ProseMirror found in chat container';

      // Focus and set content
      proseMirror.focus();

      // Use execCommand to insert text (works with ProseMirror)
      document.execCommand('selectAll');
      document.execCommand('insertText', false, 'Remember this secret code: ALPHA-BRAVO-99. Just acknowledge you have it.');

      return 'text inserted';
    })()
  `);
  console.log(`[${t()}] Input result: ${sendResult}`);

  if (sendResult !== 'text inserted') {
    console.log('Failed to insert text, aborting');
    ws.close();
    return;
  }

  // Step 5: Submit the message by pressing Enter
  await evaluate(`
    (() => {
      const chatContainer = document.querySelector('.smtcmp-chat-input-container');
      const proseMirror = chatContainer?.querySelector('.ProseMirror');
      if (!proseMirror) return;

      proseMirror.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
      }));
    })()
  `);
  console.log(`[${t()}] Enter pressed, waiting for response...`);

  // Step 6: Wait for response to complete
  await new Promise(r => setTimeout(r, 20000));

  // Step 7: Read the response
  const response1 = await evaluate(`
    (() => {
      const messages = document.querySelectorAll('.smtcmp-chat-messages-assistant');
      const lastMsg = messages[messages.length - 1];
      return lastMsg?.textContent?.substring(0, 200) || 'no response found';
    })()
  `);
  console.log(`[${t()}] Turn 1 response: "${response1}"\n`);

  // Step 8: Send follow-up
  console.log(`[${t()}] TURN 2: Asking to recall the code...`);

  await evaluate(`
    (() => {
      const chatContainer = document.querySelector('.smtcmp-chat-input-container');
      const proseMirror = chatContainer?.querySelector('.ProseMirror');
      if (!proseMirror) return 'no input';
      proseMirror.focus();
      document.execCommand('selectAll');
      document.execCommand('insertText', false, 'What was the secret code I told you? Just state it.');
      return 'ok';
    })()
  `);

  await evaluate(`
    (() => {
      const chatContainer = document.querySelector('.smtcmp-chat-input-container');
      const proseMirror = chatContainer?.querySelector('.ProseMirror');
      if (!proseMirror) return;
      proseMirror.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true,
      }));
    })()
  `);
  console.log(`[${t()}] Enter pressed, waiting for response...`);

  await new Promise(r => setTimeout(r, 20000));

  const response2 = await evaluate(`
    (() => {
      const messages = document.querySelectorAll('.smtcmp-chat-messages-assistant');
      const lastMsg = messages[messages.length - 1];
      return lastMsg?.textContent?.substring(0, 200) || 'no response found';
    })()
  `);
  console.log(`[${t()}] Turn 2 response: "${response2}"`);

  const hasCode = response2.includes('ALPHA-BRAVO-99');
  console.log(`\n[${t()}] ${hasCode ? '✓ SUCCESS' : '✗ FAIL'}: Agent ${hasCode ? 'remembered' : 'forgot'} the code`);

  // Take a screenshot
  const screenshot = await send('Page.captureScreenshot', { format: 'png' });
  const fs = await import('fs');
  fs.writeFileSync('./test-screenshots/e2e-cdp-final.png', Buffer.from(screenshot.data, 'base64'));
  console.log(`[${t()}] Screenshot saved`);

  ws.close();
}

ws.on('open', () => run().catch(e => { console.error(e); ws.close(); }));
ws.on('error', e => { console.error('WS error:', e.message); process.exit(1); });
ws.on('close', () => process.exit(0));

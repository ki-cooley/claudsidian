/**
 * E2E test for interspersed layout + rendered markdown preview
 * Runs via CDP against Obsidian test vault
 */
const WebSocket = require('ws');

const TARGET_ID = '9BDB6C8C4696B1EEF33FB711BA7FCA20';
const WS_URL = `ws://127.0.0.1:9222/devtools/page/${TARGET_ID}`;

let ws;
let msgId = 1;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = msgId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`Timeout: ${method}`));
      }
    }, 30000);
  });
}

async function evaluate(expression) {
  // Wrap in async IIFE for await support
  const wrapped = `(async () => { ${expression} })()`;
  const result = await send('Runtime.evaluate', {
    expression: wrapped,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.result?.exceptionDetails) {
    const details = result.result.exceptionDetails;
    const msg = details.exception?.description || details.text || JSON.stringify(details);
    console.error('  Eval error:', msg.split('\n')[0]);
    return undefined;
  }
  return result.result?.result?.value;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const results = [];
function log(test, pass, detail = '') {
  const status = pass ? 'PASS' : 'FAIL';
  const msg = `[${status}] ${test}${detail ? ': ' + detail : ''}`;
  console.log(msg);
  results.push({ test, pass, detail });
}

async function waitForCompletion(timeoutMs = 120000) {
  const start = Date.now();
  let lastLen = 0;
  let stableCount = 0;

  while (Date.now() - start < timeoutMs) {
    await sleep(2000);

    const hasStop = await evaluate(`
      return !!document.querySelector('.smtcmp-chat-user-input-submit-button[aria-label="Stop"]');
    `);

    const textLen = await evaluate(`
      const el = document.querySelector('.smtcmp-assistant-tool-message-group:last-child');
      return el ? el.textContent.length : 0;
    `);

    if (!hasStop && textLen > 0) {
      if (textLen === lastLen) {
        stableCount++;
        if (stableCount >= 2) return true;
      } else {
        stableCount = 0;
      }
    }
    lastLen = textLen;
  }
  return false;
}

async function run() {
  ws = new WebSocket(WS_URL);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id).resolve(msg);
      pending.delete(msg.id);
    }
  });

  await send('Runtime.enable');

  console.log('\n=== E2E: Interspersed Layout + Rendered Markdown Preview ===\n');

  // --- Test 0: Ensure backend-agent model is selected ---
  console.log('Setting up backend-agent model...');
  const modelSet = await evaluate(`
    const plugin = app.plugins.plugins['smart-composer'] || app.plugins.plugins.claudsidian;
    if (plugin) {
      plugin.settings.chatModelId = 'backend-agent';
      // Try different save methods
      if (typeof plugin.saveSettings === 'function') await plugin.saveSettings();
      else if (typeof plugin.saveData === 'function') await plugin.saveData(plugin.settings);
      return 'backend-agent set on ' + (plugin.manifest?.id || 'unknown') + ', methods: ' + Object.getOwnPropertyNames(Object.getPrototypeOf(plugin)).filter(m => m.includes('save')).join(',');
    }
    return 'no plugin found';
  `);
  console.log('  Model:', modelSet);
  await sleep(1000);

  // --- Test 1: Open new chat ---
  console.log('Opening new chat...');
  const openResult = await evaluate(`
    // List available commands to find the right one
    const cmds = Object.keys(app.commands.commands).filter(c => c.includes('new-chat') || c.includes('open-new'));
    if (cmds.length > 0) {
      app.commands.executeCommandById(cmds[0]);
      return 'opened via ' + cmds[0];
    }
    return 'no matching command found: ' + Object.keys(app.commands.commands).filter(c => c.includes('smart') || c.includes('claud')).join(', ');
  `);
  console.log('  Open:', openResult);
  await sleep(3000);

  // Debug: check what's in the DOM
  const chatDebug = await evaluate(`
    const selectors = [
      '.smtcmp-chat-user-input',
      '.smtcmp-chat-user-input-submit-button',
      '[contenteditable]',
      '.smtcmp-chat-container',
      '.smtcmp-chat',
    ];
    const found = selectors.filter(s => document.querySelector(s));
    return JSON.stringify({ found, allSmtcmp: document.querySelectorAll('[class*="smtcmp"]').length });
  `);
  console.log('  DOM check:', chatDebug);

  const chatOpen = await evaluate(`
    return !!(document.querySelector('.smtcmp-chat-user-input') || document.querySelector('[contenteditable]'));
  `);
  log('T1: New chat opened', chatOpen);
  if (!chatOpen) {
    console.log('Chat not open, aborting remaining tests');
    ws.close();
    process.exit(1);
  }

  // --- Test 2: Send a query that triggers search + file creation ---
  console.log('Sending test query...');
  const query = 'Search for hollandaise sauce technique, then create a note called test-interspersed-hollandaise.md with what you found. Keep it brief - 3-4 sentences max.';

  await evaluate(`
    const input = document.querySelector('.smtcmp-chat-user-input [contenteditable]');
    if (input) {
      input.focus();
      document.execCommand('insertText', false, ${JSON.stringify(query)});
      return 'typed';
    }
    return 'no input found';
  `);
  await sleep(500);

  const submitResult = await evaluate(`
    const buttons = document.querySelectorAll('.smtcmp-chat-user-input-submit-button');
    const chatBtn = Array.from(buttons).find(b => b.textContent.trim().includes('Chat'));
    if (chatBtn) {
      chatBtn.click();
      return 'clicked Chat button';
    }
    // Try any submit button
    if (buttons.length > 0) {
      buttons[0].click();
      return 'clicked first submit button';
    }
    return 'no submit button found';
  `);
  console.log('  Submit:', submitResult);

  console.log('Waiting for response completion (up to 120s)...');
  const completed = await waitForCompletion(120000);
  log('T2: Response completed', completed);

  if (!completed) {
    console.log('  Response did not complete, checking partial results...');
  }

  await sleep(2000);

  // --- Test 3: Check for interspersed content container ---
  const hasInterspersed = await evaluate(`
    return document.querySelectorAll('.smtcmp-interspersed-content').length;
  `);
  log('T3: Interspersed content rendered', hasInterspersed > 0, `found ${hasInterspersed} container(s)`);

  // --- Test 4: Check content blocks are interleaved ---
  const blockInfo = await evaluate(`
    const container = document.querySelector('.smtcmp-interspersed-content');
    if (!container) return JSON.stringify({ blocks: [], childCount: 0 });
    const children = Array.from(container.children);
    const blocks = children.map((child, i) => {
      const isActivity = child.classList.contains('smtcmp-interspersed-group');
      const isText = child.classList.contains('smtcmp-chat-messages-assistant');
      return { index: i, type: isActivity ? 'activity' : isText ? 'text' : 'unknown:' + child.className };
    });
    return JSON.stringify({ blocks, childCount: children.length });
  `);
  const parsed = JSON.parse(blockInfo || '{"blocks":[],"childCount":0}');
  const blockTypes = parsed.blocks.map(b => b.type);
  const hasMultipleTypes = new Set(blockTypes).size > 1;
  log('T4: Content blocks interleaved', hasMultipleTypes, `types: [${blockTypes.join(', ')}]`);

  // --- Test 5: Check activity accordions exist within interspersed content ---
  const accordionCount = await evaluate(`
    return document.querySelectorAll('.smtcmp-interspersed-content .smtcmp-activity-section').length;
  `);
  log('T5: Activity accordions in interspersed', accordionCount > 0, `found ${accordionCount}`);

  // --- Test 6: Check for edit diff blocks ---
  const diffCount = await evaluate(`
    return document.querySelectorAll('.smtcmp-edit-diff').length;
  `);
  log('T6: Edit diff blocks present', diffCount > 0, `found ${diffCount}`);

  // --- Test 7: Check rendered markdown preview is default ---
  const hasRendered = await evaluate(`
    return document.querySelectorAll('.smtcmp-edit-diff-rendered').length;
  `);
  log('T7: Rendered markdown preview (default)', hasRendered > 0, `found ${hasRendered} rendered preview(s)`);

  // --- Test 8: Check view toggle button exists ---
  const toggleExists = await evaluate(`
    return document.querySelectorAll('.smtcmp-edit-diff-view-toggle').length;
  `);
  log('T8: Raw/Rendered toggle button exists', toggleExists > 0, `found ${toggleExists}`);

  // --- Test 9: Toggle to raw mode and verify diff content appears ---
  if (toggleExists > 0) {
    await evaluate(`
      const toggle = document.querySelector('.smtcmp-edit-diff-view-toggle');
      if (toggle) toggle.click();
    `);
    await sleep(500);

    const hasRawDiff = await evaluate(`
      return document.querySelectorAll('.smtcmp-diff-content').length > 0;
    `);
    log('T9: Toggle to raw shows diff content', hasRawDiff);

    // Toggle back to rendered
    await evaluate(`
      const toggle = document.querySelector('.smtcmp-edit-diff-view-toggle');
      if (toggle) toggle.click();
    `);
    await sleep(500);

    const backToRendered = await evaluate(`
      return document.querySelectorAll('.smtcmp-edit-diff-rendered').length > 0;
    `);
    log('T9b: Toggle back to rendered', backToRendered);
  } else {
    log('T9: Toggle to raw (skipped - no toggle)', false);
    log('T9b: Toggle back (skipped)', false);
  }

  // --- Test 10: Verify NO legacy grouped layout ---
  const legacyLayout = await evaluate(`
    const groups = document.querySelectorAll('.smtcmp-assistant-tool-message-group');
    const lastGroup = groups[groups.length - 1];
    if (!lastGroup) return false;
    // Direct child accordion means legacy layout
    for (const child of lastGroup.children) {
      if (child.classList.contains('smtcmp-activity-section')) return true;
      if (child.classList.contains('smtcmp-edit-blocks')) return true;
    }
    return false;
  `);
  log('T10: No legacy grouped layout', !legacyLayout);

  // --- Test 11: Undo button present on edit diff ---
  const hasUndo = await evaluate(`
    return document.querySelectorAll('.smtcmp-edit-diff-revert').length > 0;
  `);
  log('T11: Undo button present', hasUndo);

  // --- Test 12: Clickable file link ---
  const hasFileLink = await evaluate(`
    return document.querySelectorAll('.smtcmp-edit-diff .smtcmp-activity-file-link').length > 0;
  `);
  log('T12: Clickable file link in diff header', hasFileLink);

  // --- Cleanup: delete the test file ---
  await evaluate(`
    const file = app.vault.getAbstractFileByPath('test-interspersed-hollandaise.md');
    if (file) await app.vault.delete(file);
    return 'cleaned up';
  `);

  // --- Summary ---
  console.log('\n=== RESULTS ===');
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`${passed} passed, ${failed} failed out of ${results.length} tests`);
  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.pass).forEach(r => console.log(`  - ${r.test}: ${r.detail}`));
  }
  console.log('');

  ws.close();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal:', err);
  if (ws) ws.close();
  process.exit(1);
});

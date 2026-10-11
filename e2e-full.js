/**
 * Full E2E test: interspersed layout, rendered preview, undo, file links,
 * backward compat, streaming behavior
 */
const WebSocket = require('ws');

const TARGET_ID = '9BDB6C8C4696B1EEF33FB711BA7FCA20';
const ws = new WebSocket(`ws://127.0.0.1:9222/devtools/page/${TARGET_ID}`);

let id = 1;

function evaluate(expr) {
  return new Promise((resolve, reject) => {
    const myId = id++;
    ws.send(JSON.stringify({ id: myId, method: 'Runtime.evaluate', params: {
      expression: `(async () => { ${expr} })()`,
      awaitPromise: true,
      returnByValue: true,
    }}));
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === myId) {
        ws.off('message', handler);
        if (msg.result?.exceptionDetails) {
          console.error('  eval error:', msg.result.exceptionDetails.exception?.description?.split('\n')[0]);
          resolve(undefined);
        } else {
          resolve(msg.result?.result?.value);
        }
      }
    };
    ws.on('message', handler);
    setTimeout(() => { ws.off('message', handler); resolve(undefined); }, 30000);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const results = [];
function test(name, pass, detail) {
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ': ' + detail : ''}`);
  results.push({ name, pass });
}

async function waitForCompletion(timeoutMs = 120000) {
  const start = Date.now();
  let lastLen = 0;
  let stableCount = 0;
  while (Date.now() - start < timeoutMs) {
    await sleep(2000);
    const state = JSON.parse(await evaluate(`
      const groups = document.querySelectorAll('.smtcmp-assistant-tool-message-group');
      const hasStop = !!document.querySelector('[aria-label="Stop"]');
      const textLen = groups.length > 0 ? groups[groups.length - 1].textContent.length : 0;
      return JSON.stringify({ groups: groups.length, hasStop, textLen });
    `) || '{}');
    const elapsed = Math.round((Date.now() - start) / 1000);
    process.stdout.write(`\r  ${elapsed}s: groups=${state.groups} stop=${state.hasStop} text=${state.textLen}    `);
    if (!state.hasStop && state.textLen > 50) {
      if (state.textLen === lastLen) { stableCount++; if (stableCount >= 6) { console.log(''); return true; } }
      else stableCount = 0;
    }
    lastLen = state.textLen;
  }
  console.log('');
  return false;
}

async function openNewChat() {
  await evaluate(`
    const cmds = Object.keys(app.commands.commands).filter(c => c.includes('new-chat') || c.includes('open-new'));
    if (cmds.length > 0) app.commands.executeCommandById(cmds[0]);
  `);
  await sleep(3000);
}

async function sendMessage(text) {
  await evaluate(`
    const editor = document.querySelector('[contenteditable="true"].smtcmp-lexical-content-editable-root') ||
                   document.querySelector('.smtcmp-chat-user-input-container [contenteditable="true"]');
    if (editor) {
      editor.focus();
      document.execCommand('selectAll');
      document.execCommand('delete');
      document.execCommand('insertText', false, ${JSON.stringify(text)});
    }
  `);
  await sleep(300);
  await evaluate(`
    const buttons = document.querySelectorAll('.smtcmp-chat-user-input-submit-button');
    const chatBtn = Array.from(buttons).find(b => b.textContent.trim() === 'Chat');
    if (chatBtn) chatBtn.click();
    else if (buttons.length > 0) buttons[0].click();
  `);
}

ws.on('open', async () => {
  await evaluate('return "connected"');

  console.log('\n=== FULL E2E: Interspersed Layout on yes-chef-test ===\n');

  // Setup: ensure backend-agent model
  await evaluate(`
    const plugin = app.plugins.plugins['smart-composer'] || app.plugins.plugins.claudsidian;
    if (plugin) {
      plugin.settings.chatModelId = 'backend-agent';
      if (typeof plugin.saveData === 'function') await plugin.saveData(plugin.settings);
    }
  `);
  await sleep(500);

  // ====== TEST SUITE 1: Multi-tool interspersed layout ======
  console.log('--- Suite 1: Multi-tool interspersed ---');
  await openNewChat();

  const chatOpen = await evaluate(`
    return !!(document.querySelector('[contenteditable="true"]'));
  `);
  test('S1-T1: Chat opened', chatOpen);
  if (!chatOpen) { ws.close(); process.exit(1); }

  console.log('  Sending multi-tool query...');
  await sendMessage('Search for braising techniques in the cookbooks, then create a note called e2e-test-braising.md summarizing what you found in 3-4 sentences.');

  console.log('  Waiting for completion...');
  const completed = await waitForCompletion(120000);
  test('S1-T2: Response completed', completed);

  // Interspersed layout checks
  const interspersed = await evaluate(`return document.querySelectorAll('.smtcmp-interspersed-content').length;`);
  test('S1-T3: Interspersed container', interspersed > 0, `${interspersed}`);

  const blockStr = await evaluate(`
    const c = document.querySelector('.smtcmp-interspersed-content');
    if (!c) return '[]';
    return JSON.stringify(Array.from(c.children).map(el =>
      el.classList.contains('smtcmp-interspersed-group') ? 'activity'
      : el.classList.contains('smtcmp-chat-messages-assistant') ? 'text'
      : 'other'
    ));
  `);
  const types = JSON.parse(blockStr || '[]');
  test('S1-T4: Multiple block types', new Set(types).size > 1, `[${types.join(', ')}]`);
  test('S1-T5: Has text blocks', types.includes('text'));
  test('S1-T6: Has activity blocks', types.includes('activity'));

  // Activity accordion inside interspersed
  const accordions = await evaluate(`return document.querySelectorAll('.smtcmp-interspersed-content .smtcmp-activity-section').length;`);
  test('S1-T7: Activity accordion present', accordions > 0, `${accordions}`);

  // Edit diff block
  const diffs = await evaluate(`return document.querySelectorAll('.smtcmp-edit-diff').length;`);
  test('S1-T8: Edit diff block', diffs > 0, `${diffs}`);

  // Rendered markdown preview (default)
  const rendered = await evaluate(`return document.querySelectorAll('.smtcmp-edit-diff-rendered').length;`);
  test('S1-T9: Rendered preview default', rendered > 0, `${rendered}`);

  // Rendered has actual HTML
  const hasHTML = await evaluate(`
    const r = document.querySelector('.smtcmp-edit-diff-rendered');
    if (!r) return false;
    return r.querySelectorAll('p, h1, h2, h3, ul, ol, li, strong, em, a, hr, code').length > 0;
  `);
  test('S1-T10: Rendered has formatted elements', hasHTML);

  // Toggle button
  const toggleCount = await evaluate(`return document.querySelectorAll('.smtcmp-edit-diff-view-toggle').length;`);
  test('S1-T11: Toggle button exists', toggleCount > 0);

  // Toggle to raw
  if (toggleCount > 0) {
    await evaluate(`document.querySelector('.smtcmp-edit-diff-view-toggle').click();`);
    await sleep(500);
    const rawDiff = await evaluate(`return document.querySelectorAll('.smtcmp-diff-content').length > 0;`);
    test('S1-T12: Toggle to raw works', rawDiff);

    const toggleLabel = await evaluate(`return document.querySelector('.smtcmp-edit-diff-view-toggle')?.textContent?.trim();`);
    test('S1-T13: Toggle label says Rendered', toggleLabel === 'Rendered', `"${toggleLabel}"`);

    // Toggle back
    await evaluate(`document.querySelector('.smtcmp-edit-diff-view-toggle').click();`);
    await sleep(500);
    const backRendered = await evaluate(`return document.querySelectorAll('.smtcmp-edit-diff-rendered').length > 0;`);
    test('S1-T14: Toggle back to rendered', backRendered);
  }

  // No legacy layout
  const isLegacy = await evaluate(`
    const groups = document.querySelectorAll('.smtcmp-assistant-tool-message-group');
    const g = groups[groups.length - 1];
    if (!g) return false;
    for (const child of g.children) {
      if (child.classList.contains('smtcmp-activity-section') || child.classList.contains('smtcmp-edit-blocks')) return true;
    }
    return false;
  `);
  test('S1-T15: No legacy layout', isLegacy === false);

  // Undo button
  const undo = await evaluate(`return document.querySelectorAll('.smtcmp-edit-diff-revert').length > 0;`);
  test('S1-T16: Undo button', undo);

  // File link
  const fileLink = await evaluate(`return document.querySelectorAll('.smtcmp-edit-diff .smtcmp-activity-file-link').length > 0;`);
  test('S1-T17: File link clickable', fileLink);

  // ====== TEST SUITE 2: Undo actually works ======
  console.log('\n--- Suite 2: Undo functionality ---');
  const fileExists = await evaluate(`
    return !!app.vault.getAbstractFileByPath('e2e-test-braising.md');
  `);
  test('S2-T1: Test file was created', fileExists);

  if (undo) {
    await evaluate(`document.querySelector('.smtcmp-edit-diff-revert').click();`);
    await sleep(1500);

    const reverted = await evaluate(`return document.querySelectorAll('.smtcmp-edit-diff-reverted').length > 0;`);
    test('S2-T2: Reverted label shown', reverted);

    const fileGone = await evaluate(`
      return !app.vault.getAbstractFileByPath('e2e-test-braising.md');
    `);
    test('S2-T3: File deleted after undo', fileGone);
  } else {
    test('S2-T2: Reverted (skipped)', false);
    test('S2-T3: File deleted (skipped)', false);
  }

  // ====== TEST SUITE 3: File link opens file ======
  console.log('\n--- Suite 3: File link ---');
  // Re-create the file for link test if undo deleted it
  await evaluate(`
    const exists = app.vault.getAbstractFileByPath('e2e-test-braising.md');
    if (!exists) await app.vault.create('e2e-test-braising.md', '# Braising Test\\nTest content');
  `);
  await sleep(500);

  if (fileLink) {
    await evaluate(`
      const link = document.querySelector('.smtcmp-edit-diff .smtcmp-activity-file-link');
      if (link) link.click();
    `);
    await sleep(1000);

    const activeFile = await evaluate(`
      const leaf = app.workspace.activeLeaf;
      return leaf?.view?.file?.path || 'none';
    `);
    test('S3-T1: File link opens file', activeFile === 'e2e-test-braising.md', activeFile);
  } else {
    test('S3-T1: File link (skipped)', false);
  }

  // ====== TEST SUITE 4: Activity accordion expand/collapse ======
  console.log('\n--- Suite 4: Activity accordion ---');
  // Switch back to chat view
  await evaluate(`
    const cmds = Object.keys(app.commands.commands).filter(c => c.includes('open-chat') && !c.includes('new'));
    if (cmds.length > 0) app.commands.executeCommandById(cmds[0]);
  `);
  await sleep(1000);

  const accordionHeader = await evaluate(`
    const h = document.querySelector('.smtcmp-interspersed-content .smtcmp-activity-accordion-header');
    if (!h) return null;
    return h.textContent.trim();
  `);
  test('S4-T1: Accordion has summary label', !!accordionHeader, `"${accordionHeader}"`);

  // Click to collapse
  if (accordionHeader) {
    await evaluate(`document.querySelector('.smtcmp-interspersed-content .smtcmp-activity-accordion-header').click();`);
    await sleep(300);
    const collapsed = await evaluate(`
      return document.querySelectorAll('.smtcmp-interspersed-content .smtcmp-activity-accordion-content').length === 0;
    `);
    test('S4-T2: Accordion collapses', collapsed);

    // Click to expand
    await evaluate(`document.querySelector('.smtcmp-interspersed-content .smtcmp-activity-accordion-header').click();`);
    await sleep(300);
    const expanded = await evaluate(`
      return document.querySelectorAll('.smtcmp-interspersed-content .smtcmp-activity-accordion-content').length > 0;
    `);
    test('S4-T3: Accordion expands', expanded);
  }

  // ====== Cleanup ======
  await evaluate(`
    const file = app.vault.getAbstractFileByPath('e2e-test-braising.md');
    if (file) await app.vault.delete(file);
  `);

  // ====== Summary ======
  console.log('\n=== RESULTS ===');
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`${passed} passed, ${failed} failed out of ${results.length}`);
  if (failed > 0) {
    console.log('\nFailed:');
    results.filter(r => !r.pass).forEach(r => console.log(`  - ${r.name}`));
  }
  console.log('');

  ws.close();
  process.exit(failed > 0 ? 1 : 0);
});

ws.on('error', (err) => {
  console.error('WS error:', err.message);
  process.exit(1);
});

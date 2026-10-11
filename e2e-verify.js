/**
 * E2E verification of interspersed layout + rendered markdown preview
 * Assumes a completed response is already visible in the test vault chat
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
          console.error('  Eval error:', msg.result.exceptionDetails.exception?.description?.split('\n')[0]);
          resolve(undefined);
        } else {
          resolve(msg.result?.result?.value);
        }
      }
    };
    ws.on('message', handler);
    setTimeout(() => { ws.off('message', handler); reject(new Error('timeout')); }, 15000);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const results = [];
function test(name, pass, detail) {
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ': ' + detail : ''}`);
  results.push({ name, pass });
}

ws.on('open', async () => {
  await evaluate('return "connected"');
  console.log('\n=== Interspersed Layout + Rendered Preview Verification ===\n');

  // T1: Interspersed content container
  const interspersed = await evaluate(`return document.querySelectorAll('.smtcmp-interspersed-content').length;`);
  test('T1: Interspersed content rendered', interspersed > 0, `${interspersed} containers`);

  // T2: Content blocks interleaved
  const blockStr = await evaluate(`
    const c = document.querySelector('.smtcmp-interspersed-content');
    if (!c) return '[]';
    return JSON.stringify(Array.from(c.children).map((el, i) => ({
      i,
      type: el.classList.contains('smtcmp-interspersed-group') ? 'activity'
          : el.classList.contains('smtcmp-chat-messages-assistant') ? 'text'
          : 'other'
    })));
  `);
  const blocks = JSON.parse(blockStr || '[]');
  const types = blocks.map(b => b.type);
  const hasMultipleTypes = new Set(types).size > 1;
  test('T2: Blocks interleaved', hasMultipleTypes, `[${types.join(', ')}]`);

  // T3: Activity accordion inside interspersed
  const accordions = await evaluate(`return document.querySelectorAll('.smtcmp-interspersed-content .smtcmp-activity-section').length;`);
  test('T3: Activity accordion in interspersed', accordions > 0, `${accordions} found`);

  // T4: Edit diff block
  const diffs = await evaluate(`return document.querySelectorAll('.smtcmp-edit-diff').length;`);
  test('T4: Edit diff block present', diffs > 0, `${diffs} found`);

  // T5: Rendered markdown preview (default)
  const rendered = await evaluate(`return document.querySelectorAll('.smtcmp-edit-diff-rendered').length;`);
  test('T5: Rendered markdown preview default', rendered > 0, `${rendered} rendered`);

  // T6: Rendered content has actual formatted HTML
  const hasRenderedHTML = await evaluate(`
    const r = document.querySelector('.smtcmp-edit-diff-rendered');
    if (!r) return false;
    return r.querySelectorAll('p, h1, h2, h3, ul, ol, li, strong, em, a, hr').length > 0;
  `);
  test('T6: Rendered preview has formatted HTML', hasRenderedHTML);

  // T7: View toggle button
  const toggleCount = await evaluate(`return document.querySelectorAll('.smtcmp-edit-diff-view-toggle').length;`);
  test('T7: Raw/Rendered toggle exists', toggleCount > 0, `${toggleCount} found`);

  // T8: Toggle to raw
  if (toggleCount > 0) {
    await evaluate(`document.querySelector('.smtcmp-edit-diff-view-toggle').click();`);
    await sleep(500);
    const rawDiff = await evaluate(`return document.querySelectorAll('.smtcmp-diff-content').length > 0;`);
    test('T8: Toggle to raw shows diff', rawDiff);

    // T9: Toggle back
    await evaluate(`document.querySelector('.smtcmp-edit-diff-view-toggle').click();`);
    await sleep(500);
    const backRendered = await evaluate(`return document.querySelectorAll('.smtcmp-edit-diff-rendered').length > 0;`);
    test('T9: Toggle back to rendered', backRendered);
  } else {
    test('T8: Toggle to raw (skipped)', false);
    test('T9: Toggle back (skipped)', false);
  }

  // T10: No legacy grouped layout
  const isLegacy = await evaluate(`
    const groups = document.querySelectorAll('.smtcmp-assistant-tool-message-group');
    const g = groups[groups.length - 1];
    if (!g) return false;
    for (const child of g.children) {
      if (child.classList.contains('smtcmp-activity-section') || child.classList.contains('smtcmp-edit-blocks')) return true;
    }
    return false;
  `);
  test('T10: No legacy grouped layout', isLegacy === false);

  // T11: Undo button
  const undo = await evaluate(`return document.querySelectorAll('.smtcmp-edit-diff-revert').length > 0;`);
  test('T11: Undo button present', undo);

  // T12: Clickable file link
  const fileLink = await evaluate(`return document.querySelectorAll('.smtcmp-edit-diff .smtcmp-activity-file-link').length > 0;`);
  test('T12: Clickable file link', fileLink);

  // Cleanup test file
  await evaluate(`
    const file = app.vault.getAbstractFileByPath('test-interspersed-hollandaise.md');
    if (file) await app.vault.delete(file);
  `);

  // Summary
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

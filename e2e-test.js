const WebSocket = require('ws');
const TARGET_ID = '9A86D67D6776A50299AE5F7148026D9A';
const CDP_URL = `ws://127.0.0.1:9222/devtools/page/${TARGET_ID}`;
let msgId = 1;

async function cdpEval(ws, expr) {
  const id = msgId++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout')), 10000);
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) {
        clearTimeout(timeout);
        ws.removeListener('message', handler);
        if (msg.result?.exceptionDetails) resolve('EVAL_ERROR');
        else resolve(msg.result?.result?.value);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } }));
  });
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('Connecting to CDP...');
  const ws = new WebSocket(CDP_URL);
  await new Promise(r => ws.on('open', r));

  // Open new chat
  console.log('Opening new chat...');
  await cdpEval(ws, `app.commands.executeCommandById('claudsidian:open-new-chat')`);
  await sleep(2000);

  // Type query
  const query = 'what are the five french mother sauces according to The Professional Chef?';
  console.log(`Typing: "${query}"`);
  await cdpEval(ws, `
    const e = document.querySelector('.smtcmp-lexical-content-editable-root');
    if (e) { e.focus(); }
  `);
  await sleep(300);
  await cdpEval(ws, `document.execCommand('insertText', false, ${JSON.stringify(query)})`);
  await sleep(500);

  // Submit
  console.log('Submitting...');
  await cdpEval(ws, `
    const e = document.querySelector('.smtcmp-lexical-content-editable-root');
    if (e) { e.focus(); e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })); }
  `);

  // Wait for completion
  let lastLen = 0, stableCount = 0;
  const start = Date.now();
  while (Date.now() - start < 180000) {
    await sleep(5000);
    const hasStop = await cdpEval(ws, `!!document.querySelector('button[aria-label="Stop Generation"]')`);
    const len = await cdpEval(ws, `
      try {
        const m = Array.from(document.querySelectorAll('.smtcmp-chat-messages-assistant'));
        m[m.length-1] ? m[m.length-1].textContent.length : 0;
      } catch(e) { 0; }
    `) || 0;
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`  ${elapsed}s: len=${len}, stop=${hasStop}, stable=${stableCount}`);
    if (!hasStop && len > 10) {
      if (len === lastLen) { stableCount++; if (stableCount >= 2) break; }
      else stableCount = 0;
    }
    lastLen = len;
  }

  // Check results
  console.log('\n--- Activity Accordion ---');
  const activities = await cdpEval(ws, `
    try {
      const header = document.querySelector('.smtcmp-activity-accordion-header');
      const items = Array.from(document.querySelectorAll('.smtcmp-activity-item'));
      JSON.stringify({
        header: header ? header.textContent.trim() : 'none',
        items: items.map(i => (i.textContent || '').substring(0, 120))
      }, null, 2);
    } catch(e) { e.message; }
  `);
  console.log(activities);

  console.log('\n--- Response (first 800 chars) ---');
  const response = await cdpEval(ws, `
    try {
      const m = Array.from(document.querySelectorAll('.smtcmp-chat-messages-assistant'));
      m[m.length-1] ? m[m.length-1].textContent.substring(0, 800) : 'NO RESPONSE';
    } catch(e) { e.message; }
  `);
  console.log(response);

  // Verify
  const hasSauces = response && (response.includes('béchamel') || response.includes('Béchamel') || response.includes('bechamel') || response.includes('velouté') || response.includes('Velouté'));
  const hasCIA = response && (response.includes('Professional Chef') || response.includes('CIA'));
  const hasPageRef = response && (response.match(/pp?\.\s*\d+/) || response.includes('page'));
  const hasWikilink = response && response.includes('[[');
  const hasToolInput = activities && !activities.includes('""');
  const noAccess = response && (response.includes("can't access") || response.includes("not available"));

  console.log('\n--- Test Results ---');
  console.log(`Mother sauces mentioned: ${hasSauces}`);
  console.log(`CIA/Professional Chef cited: ${hasCIA}`);
  console.log(`Page references: ${!!hasPageRef}`);
  console.log(`PDF wikilinks: ${hasWikilink}`);
  console.log(`Tool input displayed (not empty): ${hasToolInput}`);
  console.log(`Says no access: ${noAccess}`);

  if (hasSauces && hasCIA && hasToolInput && !noAccess) {
    console.log('\n✅ ALL PASS');
  } else {
    console.log('\n⚠️  Some checks failed');
  }

  ws.close();
}
main().catch(console.error);

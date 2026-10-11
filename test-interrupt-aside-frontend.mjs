/**
 * Frontend wiring test: interrupt + aside.
 *
 * Hooks WebSocketClient.send via CDP, exercises the chat UI in
 * yes-chef-test, and verifies the plugin emits the right WS frames:
 *   - Stop button   → { type: 'interrupt', id: <requestId> }
 *   - Send-while-pending → { type: 'aside', id: <requestId>, message }
 *
 * The same `id` must match the original prompt's `id` — that's the bug
 * we just fixed on the server side, but it has to be paired with the
 * client sending the right id.
 *
 * This test does NOT require a working backend for the interrupt/aside
 * to round-trip; it only checks that the plugin's outbound protocol is
 * correct. Round-trip behaviour is verified by test-interrupt-aside.mjs
 * against a local mock backend.
 */
import WebSocket from 'ws';

const PORT = process.env.CDP_PORT || 9223;

async function listPages() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return await res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const pages = await listPages();
  const target = pages.find((p) => p.title.includes('yes-chef-test') && p.type === 'page');
  if (!target) {
    console.error('No yes-chef-test page found via CDP. Make sure Obsidian is running with --remote-debugging-port=' + PORT);
    process.exit(1);
  }
  console.log('Target:', target.title);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });

  function send(method, params = {}) {
    const myId = ++id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('CDP timeout: ' + method)), 60000);
      const handler = (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.id === myId) {
          clearTimeout(t);
          ws.off('message', handler);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      };
      ws.on('message', handler);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  }
  async function evaluate(expr) {
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { ${expr} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description?.split('\n')[0] || 'JS error');
    }
    return r.result?.value;
  }

  // Confirm the plugin is loaded
  const pluginInfo = await evaluate(`
    const p = app.plugins.plugins['claudsidian'] || app.plugins.plugins['smart-composer'];
    if (!p) return { found: false };
    return {
      found: true,
      chatModelId: p.settings?.chatModelId,
    };
  `);
  console.log('Plugin info:', pluginInfo);
  if (!pluginInfo.found) { ws.close(); process.exit(2); }

  // Hook the websocket client's send method so we can record all outbound frames.
  // Always reset the capture buffer; only patch send once per page lifetime.
  const hookResult = await evaluate(`
    const client = window.__claudsidianWsClient;
    if (!client) return 'no global wsClient';
    window.__sentFrames = [];
    if (!client.__sendHooked) {
      const origSend = client.send.bind(client);
      client.send = function (msg) {
        try { window.__sentFrames.push(JSON.parse(JSON.stringify(msg))); } catch {}
        return origSend(msg);
      };
      client.__sendHooked = true;
      return 'hooked fresh';
    }
    return 'reused existing hook, capture cleared';
  `);
  console.log('Hook:', hookResult);

  // If a prior aborted run left an in-flight session pending, click stop to clear it
  await evaluate(`
    const btn = document.querySelector('.smtcmp-stop-gen-btn');
    if (btn) btn.click();
    return btn ? 'cleared prior pending' : 'idle';
  `).then((r) => console.log('Pre-clean:', r));
  await sleep(800);
  await evaluate(`window.__sentFrames = []; return 'cleared';`);

  // Open a fresh chat
  await evaluate(`
    const cmds = Object.keys(app.commands.commands).filter(c => c.includes('open-new-chat'));
    if (cmds.length > 0) app.commands.executeCommandById(cmds[0]);
  `);
  await sleep(1500);

  // Make sure we'll have an in-flight turn long enough to interrupt — type
  // a prompt that triggers tool work
  console.log('\n--- Test 1: interrupt ---');
  await evaluate(`
    window.__sentFrames = [];
    // Pick the chat NEW-message input, not the inline-edit of a previous user message
    const editor = Array.from(document.querySelectorAll('.smtcmp-lexical-content-editable-root'))
      .find(e => !e.closest('.smtcmp-chat-messages-user'));
    if (!editor) return JSON.stringify({status: 'no editor'});
    editor.focus();
    await new Promise(r => setTimeout(r, 200));
    document.execCommand('selectAll');
    document.execCommand('delete');
    document.execCommand('insertText', false, 'Search the vault for the word braising and tell me five things.');
    await new Promise(r => setTimeout(r, 200));
    return JSON.stringify({status: 'typed', editorText: (editor.textContent || '').slice(0, 50)});
  `).then((r) => console.log('  typed:', r));
  await sleep(200);
  await evaluate(`
    const newInputContainer = Array.from(document.querySelectorAll('.smtcmp-chat-user-input-container'))
      .find(c => !c.closest('.smtcmp-chat-messages-user'));
    const chatBtn = Array.from(newInputContainer?.querySelectorAll('.smtcmp-chat-user-input-submit-button') || [])
      .find(b => b.textContent.trim() === 'Chat');
    if (chatBtn) chatBtn.click();
  `);

  // Give the prompt a moment to leave, then click Stop
  await sleep(800);
  let frames = await evaluate(`return window.__sentFrames || [];`);
  const promptFrame = frames.find((f) => f && f.type === 'prompt');
  console.log('  prompt frame seen:', !!promptFrame, promptFrame ? `id=${promptFrame.id}` : '');

  // Click the stop button
  const stopRes = await evaluate(`
    const btn = document.querySelector('.smtcmp-stop-gen-btn');
    if (!btn) return 'no stop button';
    btn.click();
    return 'clicked';
  `);
  console.log('  stop button:', stopRes);

  await sleep(400);
  frames = await evaluate(`return window.__sentFrames || [];`);
  const interruptFrame = frames.find((f) => f && f.type === 'interrupt');
  console.log('  interrupt frame:', interruptFrame || 'NOT SENT');
  const interruptOk = !!interruptFrame &&
                      !!promptFrame &&
                      interruptFrame.id === promptFrame.id;
  console.log('  interrupt id matches prompt id:', interruptOk);

  // Wait for the in-flight turn to settle (the abort controller should clean up)
  await sleep(2000);

  // ------- Test 2: aside while pending -------
  console.log('\n--- Test 2: aside while pending ---');
  // Open a fresh chat to avoid leftover state from test 1
  await evaluate(`
    const cmds = Object.keys(app.commands.commands).filter(c => c.includes('open-new-chat'));
    if (cmds.length > 0) app.commands.executeCommandById(cmds[0]);
    return cmds[0] || 'no command';
  `);
  await sleep(1500);
  // Reset capture
  await evaluate(`window.__sentFrames = []; return 'cleared';`);

  // Send first prompt — make it a vault search so it takes a while
  const firstSubmit = await evaluate(`
    const editor = Array.from(document.querySelectorAll('.smtcmp-lexical-content-editable-root'))
      .find(e => !e.closest('.smtcmp-chat-messages-user'));
    if (!editor) return 'no editor';
    // Click into the editor first to give it real focus, then a tick for Lexical to settle
    editor.click();
    editor.focus();
    await new Promise(r => setTimeout(r, 250));
    document.execCommand('selectAll');
    document.execCommand('delete');
    document.execCommand('insertText', false, 'Search the vault for markdown files matching pattern *braising* and list five of them with full paths.');
    await new Promise(r => setTimeout(r, 250));
    const editorText = editor.textContent || '';
    const newInputContainer = Array.from(document.querySelectorAll('.smtcmp-chat-user-input-container'))
      .find(c => !c.closest('.smtcmp-chat-messages-user'));
    const chatBtn = Array.from(newInputContainer?.querySelectorAll('.smtcmp-chat-user-input-submit-button') || [])
      .find(b => b.textContent.trim() === 'Chat');
    if (!chatBtn) return JSON.stringify({ status: 'no submit', editorText });
    chatBtn.click();
    return JSON.stringify({ status: 'clicked', editorText: editorText.slice(0, 60) });
  `);
  console.log('  first submit:', firstSubmit);
  await sleep(1200);

  // Now while the turn is pending, type something else and press Send
  // The Chat.tsx logic should route this through sendAside instead of new prompt.
  const asideRes = await evaluate(`
    // Pick the chat NEW-message input, not the inline-edit of a previous user message
    const editor = Array.from(document.querySelectorAll('.smtcmp-lexical-content-editable-root'))
      .find(e => !e.closest('.smtcmp-chat-messages-user'));
    if (!editor) return JSON.stringify({ status: 'no editor' });
    const stopBtnVisible = !!document.querySelector('.smtcmp-stop-gen-btn');
    // Click into the editor to give it real focus (Lexical needs this), then settle
    editor.click();
    editor.focus();
    await new Promise(r => setTimeout(r, 250));
    document.execCommand('selectAll');
    document.execCommand('delete');
    document.execCommand('insertText', false, 'Actually, focus on dish files only.');
    await new Promise(r => setTimeout(r, 250));
    const editorText = (editor.textContent || '').slice(0, 80);
    const newInputContainer = Array.from(document.querySelectorAll('.smtcmp-chat-user-input-container'))
      .find(c => !c.closest('.smtcmp-chat-messages-user'));
    const chatBtn = Array.from(newInputContainer?.querySelectorAll('.smtcmp-chat-user-input-submit-button') || [])
      .find(b => b.textContent.trim() === 'Chat');
    if (!chatBtn) return JSON.stringify({ status: 'no submit', stopBtnVisible, editorText });
    if (chatBtn.classList.contains('smtcmp-stop-gen-btn')) return JSON.stringify({ status: 'wrong button', stopBtnVisible, editorText });
    chatBtn.click();
    return JSON.stringify({ status: 'clicked', stopBtnVisible, editorText });
  `);
  console.log('  send-while-pending:', asideRes);

  await sleep(500);
  frames = await evaluate(`return window.__sentFrames || [];`);
  console.log('  all captured frame types:', frames.map((f) => f && f.type));
  const promptFrames = frames.filter((f) => f && f.type === 'prompt');
  const promptFrame2 = promptFrames[0];
  const promptFrame2Second = promptFrames[1];
  if (promptFrame2Second) console.log('  WARN: a SECOND prompt frame was sent — onSubmit took the else branch:', promptFrame2Second.id);
  const asideFrame = frames.find((f) => f && f.type === 'aside');
  const interruptFrame2 = frames.find((f) => f && f.type === 'interrupt');
  console.log('  prompt frame:   ', promptFrame2 ? `id=${promptFrame2.id}` : 'NONE');
  console.log('  aside frame:    ', asideFrame || 'NOT SENT');
  console.log('  interrupt frame (should NOT be present):', interruptFrame2 || 'absent');

  const asideOk = !!asideFrame &&
                  !!promptFrame2 &&
                  asideFrame.id === promptFrame2.id &&
                  typeof asideFrame.message === 'string' &&
                  asideFrame.message.length > 0;
  console.log('  aside id matches prompt id:', asideOk);

  // Verify the aside UI label rendered
  const asideLabelInfo = await evaluate(`
    const labels = document.querySelectorAll('.smtcmp-chat-message-aside-label');
    const wrappers = document.querySelectorAll('.smtcmp-chat-messages-user-aside');
    return JSON.stringify({
      labelCount: labels.length,
      wrapperCount: wrappers.length,
      labelText: labels.length > 0 ? labels[labels.length - 1].textContent : null,
    });
  `);
  console.log('  aside UI label state:', asideLabelInfo);
  const asideLabelOk = JSON.parse(asideLabelInfo).labelCount > 0 && JSON.parse(asideLabelInfo).wrapperCount > 0;

  // Cleanup: stop the in-flight turn so we don't leave the chat hanging
  await evaluate(`
    const btn = document.querySelector('.smtcmp-stop-gen-btn');
    if (btn) btn.click();
  `);

  ws.close();

  console.log('\n=== Summary ===');
  console.log('Stop button sends interrupt with matching id:', interruptOk ? 'PASS' : 'FAIL');
  console.log('Send-while-pending sends aside with matching id:', asideOk ? 'PASS' : 'FAIL');
  console.log('No interrupt is sent on aside path:', !interruptFrame2 ? 'PASS' : 'FAIL');
  console.log('Aside UI badge renders:', asideLabelOk ? 'PASS' : 'FAIL');
  process.exit(interruptOk && asideOk && !interruptFrame2 && asideLabelOk ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});

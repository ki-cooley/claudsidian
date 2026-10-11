/**
 * Smoke test against the deployed prod backend (Railway), driven through
 * the yes-chef-test vault via CDP. This is the only way to verify what the
 * Claude Agent SDK actually does with mid-stream user-message injection,
 * since mock-agent only proves wiring.
 *
 * Two scenarios:
 *
 *   1. Interrupt: send a slow prompt, click Stop, verify the response
 *      stopped early (didn't run to completion).
 *   2. Aside: send a slow prompt, send a redirecting message via the chat
 *      input while pending, verify the agent responded to the aside.
 *
 * This costs real Anthropic tokens — kept short on purpose. Uses a cheap
 * model when configurable; otherwise relies on whichever model the test
 * vault has selected. Every prompt is short enough that even worst-case
 * spend is sub-cent.
 */
import WebSocket from 'ws';

const PORT = process.env.CDP_PORT || 9223;

async function listPages() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return await res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const pages = await listPages();
  const target = pages.find((p) => p.title.includes('yes-chef-test') && p.type === 'page');
  if (!target) {
    console.error('No yes-chef-test page; ensure Obsidian is running with --remote-debugging-port=' + PORT);
    process.exit(1);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
  let id = 0;
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
  return { ws, send, evaluate };
}

async function clickIfPending(evaluate) {
  return await evaluate(`
    const btn = document.querySelector('.smtcmp-stop-gen-btn');
    if (btn) btn.click();
    return btn ? 'clicked' : 'idle';
  `);
}

async function openNewChat(evaluate) {
  await evaluate(`
    const cmds = Object.keys(app.commands.commands).filter(c => c.includes('open-new-chat'));
    if (cmds.length > 0) app.commands.executeCommandById(cmds[0]);
  `);
  await sleep(1500);
}

async function typeAndSend(evaluate, text) {
  return await evaluate(`
    const editor = Array.from(document.querySelectorAll('.smtcmp-lexical-content-editable-root'))
      .find(e => !e.closest('.smtcmp-chat-messages-user'));
    if (!editor) return JSON.stringify({status: 'no editor'});
    editor.click();
    editor.focus();
    await new Promise(r => setTimeout(r, 250));
    document.execCommand('selectAll');
    document.execCommand('delete');
    document.execCommand('insertText', false, ${JSON.stringify(text)});
    await new Promise(r => setTimeout(r, 250));
    const editorText = (editor.textContent || '').slice(0, 80);
    const newInputContainer = Array.from(document.querySelectorAll('.smtcmp-chat-user-input-container'))
      .find(c => !c.closest('.smtcmp-chat-messages-user'));
    const chatBtn = Array.from(newInputContainer?.querySelectorAll('.smtcmp-chat-user-input-submit-button') || [])
      .find(b => b.textContent.trim() === 'Chat');
    if (!chatBtn) return JSON.stringify({status: 'no submit', editorText});
    chatBtn.click();
    return JSON.stringify({status: 'sent', editorText});
  `);
}

async function lastAssistantText(evaluate) {
  return await evaluate(`
    // Use the tool-message-group wrapper, which contains the streaming text
    // plus any activity blocks. Falls back to the messages-assistant text.
    const groups = document.querySelectorAll('.smtcmp-assistant-tool-message-group');
    const last = groups[groups.length - 1];
    if (last) return last.textContent || '';
    const msgs = document.querySelectorAll('.smtcmp-chat-messages-assistant');
    return msgs[msgs.length - 1]?.textContent || '';
  `);
}

async function waitForComplete(evaluate, timeoutMs = 90000) {
  const start = Date.now();
  let stable = 0;
  let last = -1;
  while (Date.now() - start < timeoutMs) {
    await sleep(1500);
    const stopVisible = await evaluate(`return !!document.querySelector('.smtcmp-stop-gen-btn');`);
    if (!stopVisible) {
      // Confirm by waiting one more tick to make sure nothing new arrives
      await sleep(800);
      const stillNo = await evaluate(`return !!document.querySelector('.smtcmp-stop-gen-btn');`);
      if (!stillNo) return true;
    }
    const text = await lastAssistantText(evaluate);
    if (text.length === last) { stable++; if (stable >= 6) return true; }
    else stable = 0;
    last = text.length;
  }
  return false;
}

async function main() {
  const { ws, evaluate } = await connect();

  // Make sure we start clean: stop any in-flight turn from prior runs
  await clickIfPending(evaluate);
  await sleep(500);

  // ===== Test 1: Interrupt =====
  console.log('\n--- Smoke 1: interrupt against prod ---');
  await openNewChat(evaluate);
  // Long prompt: writing a substantive paragraph takes the agent ~10s+ on
  // streaming, giving us time to interrupt or aside before it finishes.
  const COUNT_PROMPT = "Write a 400-word essay about how braising works at a chemical level. Be detailed and use technical terms. Then list 10 cuts of meat that braise well, one per line, with a one-sentence reason each.";
  const send1 = await typeAndSend(evaluate, COUNT_PROMPT);
  console.log('  send:', send1);
  // Wait long enough for the agent to start producing tokens
  await sleep(6000);
  const before = await lastAssistantText(evaluate);
  console.log('  text before stop (chars):', before.length);
  const stopBtnBefore = await evaluate(`return !!document.querySelector('.smtcmp-stop-gen-btn');`);
  console.log('  stop button visible before click:', stopBtnBefore);

  // Click Stop
  await clickIfPending(evaluate);
  const stopClickAt = Date.now();

  // Poll until stop button disappears (signals stream ended)
  let stopBtnGoneAt = null;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const visible = await evaluate(`return !!document.querySelector('.smtcmp-stop-gen-btn');`);
    if (!visible) { stopBtnGoneAt = Date.now(); break; }
  }
  const stopLatencyMs = stopBtnGoneAt ? stopBtnGoneAt - stopClickAt : null;
  console.log('  stop button gone after (ms):', stopLatencyMs);
  await sleep(1500);
  const after = await lastAssistantText(evaluate);
  console.log('  text after stop (chars):', after.length);
  // Interrupt success: stream stopped within a few seconds, and response is
  // far shorter than a 400-word essay would have been.
  const interruptStopped = stopBtnGoneAt !== null && stopLatencyMs < 8000;
  const responseShort = after.length < 800;
  const interruptOk = interruptStopped && responseShort;
  console.log('  interrupt stopped within 8s:', interruptStopped);
  console.log('  response substantially shorter than full essay:', responseShort);

  // Wait for any straggling state to settle before the aside test
  await sleep(2000);

  // ===== Test 2: Aside =====
  console.log('\n--- Smoke 2: aside against prod ---');
  await openNewChat(evaluate);
  const send2 = await typeAndSend(evaluate, COUNT_PROMPT);
  console.log('  initial send:', send2);
  // Wait until it's clearly streaming
  await sleep(4500);
  const beforeAside = await lastAssistantText(evaluate);
  console.log('  text before aside (chars):', beforeAside.length);

  // Aside: redirect mid-stream
  const ASIDE_TEXT = 'Actually, skip the rest of the essay and just write the literal word DONE_TOKEN_42 and nothing else.';
  const asideRes = await typeAndSend(evaluate, ASIDE_TEXT);
  console.log('  aside send:', asideRes);

  // Wait for completion
  const completed = await waitForComplete(evaluate, 60000);
  console.log('  completed:', completed);
  const final = await lastAssistantText(evaluate);
  console.log('  final text (chars):', final.length);
  console.log('  final text (last 200 chars): ...' + final.slice(-200));

  const sawDoneToken = final.includes('DONE_TOKEN_42');
  console.log('  saw "DONE_TOKEN_42":', sawDoneToken);

  // Check aside UI badge rendered
  const labelInfo = await evaluate(`
    const labels = document.querySelectorAll('.smtcmp-chat-message-aside-label');
    return labels.length;
  `);
  console.log('  aside UI badges in chat:', labelInfo);

  // Cleanup
  await clickIfPending(evaluate);
  ws.close();

  console.log('\n=== Smoke results ===');
  console.log('Interrupt stopped stream within 8s and kept response short:', interruptOk ? 'PASS' : 'FAIL');
  console.log('Aside saw DONE_TOKEN_42 in response:                       ', sawDoneToken ? 'PASS' : 'FAIL');
  console.log('Aside UI badge present:                                    ', labelInfo > 0 ? 'PASS' : 'FAIL');
  process.exit(interruptOk && sawDoneToken && labelInfo > 0 ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});

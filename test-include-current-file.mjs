/**
 * Verify the "include current file" fix works on yes-chef-test.
 *
 * Strategy:
 * 1. Connect to the yes-chef-test page via CDP.
 * 2. Hook into the plugin's BackendProvider.extractPromptAndImages by
 *    monkey-patching wsClient.sendPrompt to capture the `prompt` arg.
 * 3. Switch to the test vault tab, ensure includeCurrentFileContent = true,
 *    open a known-content file, open the chat, send a message.
 * 4. Read the captured prompt and assert it contains the current-file
 *    content marker (`# Inputs\n## Current File`).
 */
import WebSocket from 'ws';

const PAGE_URL_PREFIX = 'ws://127.0.0.1:9223/devtools/page/';

async function listPages() {
  const res = await fetch('http://127.0.0.1:9223/json/list');
  return await res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const pages = await listPages();
  const target = pages.find((p) => p.title.includes('yes-chef-test') && p.type === 'page');
  if (!target) {
    console.error('Could not find yes-chef-test page. Pages:', pages.map((p) => p.title));
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

  // Sanity
  const banner = await evaluate(`return document.title;`);
  console.log('Page title:', banner);

  // Plugin lookup
  const pluginInfo = await evaluate(`
    const p = app.plugins.plugins['claudsidian'] || app.plugins.plugins['smart-composer'];
    if (!p) return { found: false };
    return {
      found: true,
      includeCurrentFileContent: p.settings?.chatOptions?.includeCurrentFileContent,
      chatModelId: p.settings?.chatModelId,
      providerType: p.settings?.chatModels?.find(m => m.id === p.settings.chatModelId)?.providerType,
    };
  `);
  console.log('Plugin info:', pluginInfo);
  if (!pluginInfo.found) {
    console.error('Plugin not loaded');
    process.exit(2);
  }

  // Force settings: include current file ON, model = backend-agent
  await evaluate(`
    const p = app.plugins.plugins['claudsidian'] || app.plugins.plugins['smart-composer'];
    p.settings.chatOptions.includeCurrentFileContent = true;
    p.settings.chatModelId = 'backend-agent';
    if (typeof p.saveData === 'function') await p.saveData(p.settings);
    return 'settings updated';
  `);

  // Create a known marker file in the test vault
  const MARKER = 'INCLUDE_CURRENT_FILE_TEST_MARKER_' + Date.now();
  const FILE_PATH = 'INCLUDE_CURRENT_FILE_TEST.md';
  const FILE_BODY = `# Test File\n\nUNIQUE MARKER: ${MARKER}\n\nThe quick brown fox jumps over the lazy dog. This file exists only to test the include-current-file feature.`;
  await evaluate(`
    const existing = app.vault.getAbstractFileByPath(${JSON.stringify(FILE_PATH)});
    if (existing) await app.vault.delete(existing);
    await app.vault.create(${JSON.stringify(FILE_PATH)}, ${JSON.stringify(FILE_BODY)});
    return 'created';
  `);

  // Open the file in active leaf
  await evaluate(`
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(FILE_PATH)});
    await app.workspace.getLeaf(false).openFile(f);
    return app.workspace.activeLeaf?.view?.file?.path;
  `);
  await sleep(500);

  // Hook the WebSocketClient to capture outgoing prompts
  await evaluate(`
    const p = app.plugins.plugins['claudsidian'] || app.plugins.plugins['smart-composer'];
    const wsClient = p?.wsClient || p?.backendProvider?.wsClient;
    // Plugin may keep wsClient in different places; search via backendProvider
    const backendProvider = (p?.providerClients ? Object.values(p.providerClients).find(c => c.constructor?.name === 'BackendProvider') : null) || p?.backendProvider;
    const wsClientFound = backendProvider?.wsClient;
    window.__captures = [];
    if (wsClientFound) {
      const orig = wsClientFound.sendPrompt.bind(wsClientFound);
      wsClientFound.sendPrompt = async function(prompt, ...rest) {
        try { window.__captures.push({ prompt: String(prompt), at: Date.now() }); } catch {}
        return orig(prompt, ...rest);
      };
      return 'hooked via providerClients backendProvider';
    }
    // Fallback: try import path used in instance.ts
    return 'NOT HOOKED — backendProvider not located';
  `).then((r) => console.log('Hook:', r));

  // Try a more robust hook: find the WebSocket the plugin uses
  await evaluate(`
    // Walk the plugin to find any object with a sendPrompt method
    const p = app.plugins.plugins['claudsidian'] || app.plugins.plugins['smart-composer'];
    function findSendPrompt(root, depth = 0, seen = new WeakSet()) {
      if (!root || typeof root !== 'object' || seen.has(root) || depth > 4) return null;
      seen.add(root);
      for (const key of Object.keys(root)) {
        try {
          const v = root[key];
          if (v && typeof v.sendPrompt === 'function') return { obj: v, path: key };
          const nested = findSendPrompt(v, depth + 1, seen);
          if (nested) return { obj: nested.obj, path: key + '.' + nested.path };
        } catch {}
      }
      return null;
    }
    const found = findSendPrompt(p);
    if (!found) return 'no sendPrompt anywhere';
    if (found.obj.__hooked) return 'already hooked at ' + found.path;
    const orig = found.obj.sendPrompt.bind(found.obj);
    found.obj.sendPrompt = async function(prompt, ...rest) {
      try { window.__captures = window.__captures || []; window.__captures.push({ prompt: String(prompt), at: Date.now() }); } catch {}
      return orig(prompt, ...rest);
    };
    found.obj.__hooked = true;
    return 'hooked at ' + found.path;
  `).then((r) => console.log('Robust hook:', r));

  // Open chat view via command
  await evaluate(`
    const cmds = Object.keys(app.commands.commands).filter(c => c.includes('open-new-chat') || c.includes('new-chat') || (c.includes('open') && c.includes('chat')));
    if (cmds.length > 0) app.commands.executeCommandById(cmds[0]);
    return cmds.slice(0, 5);
  `).then((r) => console.log('Chat commands:', r));
  await sleep(2000);

  // Send a message
  const sendInput = await evaluate(`
    const editor = document.querySelector('[contenteditable="true"].smtcmp-lexical-content-editable-root') ||
                   document.querySelector('.smtcmp-chat-user-input-container [contenteditable="true"]') ||
                   document.querySelector('.smtcmp-chat-input-container .ProseMirror') ||
                   document.querySelector('[contenteditable="true"]');
    if (!editor) return 'no editor';
    editor.focus();
    document.execCommand('selectAll');
    document.execCommand('delete');
    document.execCommand('insertText', false, 'In one sentence, what unique marker string is in the file I am currently viewing?');
    return 'inserted';
  `);
  console.log('Send input:', sendInput);
  await sleep(500);

  // Submit by clicking the chat button (more reliable than Enter)
  await evaluate(`
    const buttons = document.querySelectorAll('.smtcmp-chat-user-input-submit-button');
    const chatBtn = Array.from(buttons).find(b => b.textContent.trim() === 'Chat') || buttons[0];
    if (chatBtn) chatBtn.click();
    return chatBtn ? 'clicked' : 'no submit button';
  `).then((r) => console.log('Submit:', r));

  // Poll for capture
  let captures = [];
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    captures = await evaluate(`return window.__captures || [];`);
    if (captures.length > 0) break;
  }
  console.log('Captures count:', captures.length);

  if (captures.length === 0) {
    console.error('FAIL: no prompt was captured. The hook may not have caught the right object.');
    process.exit(3);
  }

  const last = captures[captures.length - 1];
  const promptText = last.prompt;
  console.log('--- Captured prompt (first 600 chars) ---');
  console.log(promptText.slice(0, 600));
  console.log('--- end snippet ---');

  const hasCurrentFileMarker = promptText.includes('# Inputs') && promptText.includes('## Current File');
  const hasFileContentMarker = promptText.includes(MARKER);
  console.log('contains "# Inputs" + "## Current File":', hasCurrentFileMarker);
  console.log('contains UNIQUE MARKER:', hasFileContentMarker);

  // Cleanup the test file
  await evaluate(`
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(FILE_PATH)});
    if (f) await app.vault.delete(f);
    return 'cleaned';
  `).catch(() => {});

  ws.close();
  if (hasCurrentFileMarker && hasFileContentMarker) {
    console.log('\nPASS: current-file content was bundled into the backend prompt.');
    process.exit(0);
  }
  console.log('\nFAIL: current-file content was NOT in the backend prompt.');
  process.exit(1);
}

main().catch((e) => {
  console.error('Test crashed:', e);
  process.exit(99);
});

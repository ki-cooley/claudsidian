import WebSocket from 'ws';

const PORT = process.env.CDP_PORT || 9223;
const pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = pages.find((p) => p.title.includes('yes-chef-test') && p.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
async function ev(expr) {
  const myId = ++id;
  return new Promise((resolve, reject) => {
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === myId) {
        ws.off('message', handler);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result?.result?.value);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id: myId, method: 'Runtime.evaluate', params: { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true } }));
  });
}

const state = await ev(`
  const wsClient = window.__claudsidianWsClient;
  return JSON.stringify({
    isConnected: wsClient?.isConnected,
    readyState: wsClient?.ws?.readyState,
    activeHandlers: wsClient?.activeHandlers?.size,
  });
`);
console.log('plugin ws state:', state);

// Force a reconnect
const reconnect = await ev(`
  const p = app.plugins.plugins['claudsidian'] || app.plugins.plugins['smart-composer'];
  const wsClient = window.__claudsidianWsClient;
  if (wsClient && wsClient.ws) {
    try { wsClient.ws.close(); } catch {}
  }
  if (typeof p.connectBackend === 'function') {
    await p.connectBackend();
    return 'reconnected';
  }
  return 'no connectBackend method';
`);
console.log('reconnect:', reconnect);

await new Promise(r => setTimeout(r, 2000));

const state2 = await ev(`
  const wsClient = window.__claudsidianWsClient;
  return JSON.stringify({
    isConnected: wsClient?.isConnected,
    readyState: wsClient?.ws?.readyState,
  });
`);
console.log('after reconnect:', state2);
ws.close();

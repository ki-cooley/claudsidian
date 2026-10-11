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

const r = await ev(`
  // Search for assistant-related class names in the chat
  const all = document.querySelectorAll('[class*="assistant"], [class*="message"]');
  const seen = new Set();
  const results = [];
  all.forEach(el => {
    el.classList.forEach(c => { if (c.includes('smtcmp')) seen.add(c); });
  });
  return JSON.stringify(Array.from(seen).sort());
`);
console.log('smtcmp classes:', r);

const sample = await ev(`
  const groups = document.querySelectorAll('.smtcmp-chat-messages, .smtcmp-chat-container');
  const out = {};
  groups.forEach((g, i) => {
    out['group_' + i] = {
      class: (g.className || '').slice(0, 80),
      childClasses: Array.from(g.children).map(c => (c.className || '').slice(0, 50)),
    };
  });
  return JSON.stringify(out, null, 2);
`);
console.log('chat groups:', sample);
ws.close();

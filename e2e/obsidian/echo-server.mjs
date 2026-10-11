// Minimal echo server for transport probes: answers every request with the method, url, and
// headers it received, as JSON. Usage: node e2e/obsidian/echo-server.mjs [port]
import http from 'node:http';

const port = Number(process.argv[2] ?? 9876);
http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const out = JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body });
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      res.end(out);
    });
  })
  .listen(port, '127.0.0.1', () => console.log(`echo listening on http://127.0.0.1:${port}`));

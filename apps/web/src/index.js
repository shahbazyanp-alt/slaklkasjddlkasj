import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const port = process.env.PORT || 3000;
const html = readFileSync(join(import.meta.dirname, 'index.html'), 'utf8');

http
  .createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'tracker-web' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  })
  .listen(port, () => {
    console.log(`tracker-web listening on ${port}`);
  });

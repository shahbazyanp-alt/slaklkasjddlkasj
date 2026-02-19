const port = process.env.PORT || 3000;

import http from 'node:http';

http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'sports-news-agent' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Sports News Agent is running');
}).listen(port, () => {
  console.log(`sports-news-agent listening on ${port}`);
});

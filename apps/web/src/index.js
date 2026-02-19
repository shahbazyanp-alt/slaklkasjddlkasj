import http from 'node:http';

const port = process.env.PORT || 3000;

http
  .createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'tracker-web' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        service: 'tracker-web',
        message: 'MVP scaffold is ready',
      }),
    );
  })
  .listen(port, () => {
    console.log(`tracker-web listening on ${port}`);
  });

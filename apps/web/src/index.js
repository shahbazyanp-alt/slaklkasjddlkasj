import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../../../packages/db/src/index.js';

const port = process.env.PORT || 3000;
const html = readFileSync(join(import.meta.dirname, 'index.html'), 'utf8');

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function parseDate(value) {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

async function handleApi(req, res) {
  const url = new URL(req.url, 'http://localhost');

  // wallets
  if (req.method === 'GET' && url.pathname === '/api/wallets') {
    const items = await prisma.wallet.findMany({ include: { tags: true }, orderBy: { createdAt: 'desc' } });
    return sendJson(res, 200, items);
  }

  if (req.method === 'POST' && url.pathname === '/api/wallets') {
    const body = await readJsonBody(req);
    const address = String(body.address || '').trim();
    const label = body.label ? String(body.label).trim() : null;
    const tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t).trim()).filter(Boolean) : [];
    if (!address) return sendJson(res, 400, { error: 'address is required' });

    const created = await prisma.wallet.create({
      data: {
        address,
        label,
        tags: tags.length ? { create: tags.map((tag) => ({ tag })) } : undefined,
      },
      include: { tags: true },
    });
    return sendJson(res, 201, created);
  }

  // whitelist
  if (req.method === 'GET' && url.pathname === '/api/whitelist') {
    const items = await prisma.tokenWhitelist.findMany({ orderBy: { createdAt: 'desc' } });
    return sendJson(res, 200, items);
  }

  if (req.method === 'POST' && url.pathname === '/api/whitelist') {
    const body = await readJsonBody(req);
    const contractAddress = String(body.contractAddress || '').trim();
    const tokenName = String(body.tokenName || '').trim();
    if (!contractAddress || !tokenName) {
      return sendJson(res, 400, { error: 'contractAddress and tokenName are required' });
    }

    const created = await prisma.tokenWhitelist.create({
      data: { contractAddress, tokenName, chain: 'ethereum' },
    });
    return sendJson(res, 201, created);
  }

  // transfers
  if (req.method === 'GET' && url.pathname === '/api/transfers') {
    const start = parseDate(url.searchParams.get('start'));
    const end = parseDate(url.searchParams.get('end'));
    const direction = url.searchParams.get('direction');
    const tokenContract = url.searchParams.get('tokenContract');
    const walletAddress = url.searchParams.get('walletAddress');

    const items = await prisma.erc20Transfer.findMany({
      where: {
        isConfirmed: true,
        direction: direction === 'incoming' || direction === 'outgoing' ? direction : undefined,
        tokenContract: tokenContract || undefined,
        wallet: walletAddress ? { address: walletAddress } : undefined,
        blockTimestamp: start || end ? { gte: start, lte: end } : undefined,
      },
      include: { wallet: { include: { tags: true } } },
      orderBy: { blockTimestamp: 'desc' },
      take: 1000,
    });

    return sendJson(res, 200, items);
  }

  // summary
  if (req.method === 'GET' && url.pathname === '/api/summary') {
    const mode = url.searchParams.get('mode') === 'wallet' ? 'wallet' : 'token';
    const start = parseDate(url.searchParams.get('start'));
    const end = parseDate(url.searchParams.get('end'));
    const direction = url.searchParams.get('direction');
    const tokenContract = url.searchParams.get('tokenContract');
    const walletAddress = url.searchParams.get('walletAddress');

    const transfers = await prisma.erc20Transfer.findMany({
      where: {
        isConfirmed: true,
        direction: direction === 'incoming' || direction === 'outgoing' ? direction : undefined,
        tokenContract: tokenContract || undefined,
        wallet: walletAddress ? { address: walletAddress } : undefined,
        blockTimestamp: start || end ? { gte: start, lte: end } : undefined,
      },
      include: { wallet: { include: { tags: true } } },
      orderBy: { blockTimestamp: 'desc' },
      take: 5000,
    });

    const map = new Map();
    for (const t of transfers) {
      const amount = Number(t.amountNormalized || 0);
      const key = mode === 'wallet' ? t.wallet.address : t.tokenName;
      const prev = map.get(key) || { incoming: 0, outgoing: 0, walletTags: mode === 'wallet' ? t.wallet.tags.map((x) => x.tag) : undefined };
      if (t.direction === 'incoming') prev.incoming += amount;
      if (t.direction === 'outgoing') prev.outgoing += amount;
      map.set(key, prev);
    }

    return sendJson(
      res,
      200,
      Array.from(map.entries()).map(([key, value]) => ({ key, ...value })),
    );
  }

  return false;
}

http
  .createServer(async (req, res) => {
    try {
      if (req.url === '/health') {
        return sendJson(res, 200, { ok: true, service: 'tracker-web' });
      }

      if (req.url.startsWith('/api/')) {
        const handled = await handleApi(req, res);
        if (handled !== false) return;
        return sendJson(res, 404, { error: 'Not found' });
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (error) {
      console.error(error);
      sendJson(res, 500, { error: String(error?.message || error) });
    }
  })
  .listen(port, () => {
    console.log(`tracker-web listening on ${port}`);
  });

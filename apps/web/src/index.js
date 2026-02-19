import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../../../packages/db/src/index.js';
import { makeEtherscanClient } from '../../../packages/etherscan-client/src/index.js';

const port = process.env.PORT || 3000;
const html = readFileSync(join(import.meta.dirname, 'index.html'), 'utf8');

const syncState = {
  running: false,
  totalWallets: 0,
  processedWallets: 0,
  inserted: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
};

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
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

function normalizeAddress(v) {
  return String(v || '').toLowerCase();
}

function normalizeAmount(raw, decimals) {
  const d = Number(decimals || 0);
  const n = Number(raw || 0);
  if (!Number.isFinite(n)) return 0;
  return n / 10 ** d;
}

const ETHERSCAN_RPS = Math.max(1, Number(process.env.ETHERSCAN_RPS || 5));
const ETHERSCAN_MIN_INTERVAL_MS = Math.ceil(1000 / ETHERSCAN_RPS);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runManualSync() {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) throw new Error('ETHERSCAN_API_KEY is not set');
  const client = makeEtherscanClient({ apiKey });

  const wallets = await prisma.wallet.findMany();
  const whitelist = await prisma.tokenWhitelist.findMany({ where: { chain: 'ethereum' } });
  const whitelistMap = new Map(whitelist.map((x) => [normalizeAddress(x.contractAddress), x]));

  syncState.running = true;
  syncState.startedAt = new Date().toISOString();
  syncState.finishedAt = null;
  syncState.error = null;
  syncState.totalWallets = wallets.length;
  syncState.processedWallets = 0;
  syncState.inserted = 0;

  try {
    let lastCallAt = 0;
    for (const wallet of wallets) {
      const now = Date.now();
      const wait = Math.max(0, ETHERSCAN_MIN_INTERVAL_MS - (now - lastCallAt));
      if (wait > 0) await sleep(wait);

      let response;
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        try {
          response = await client.fetchErc20Transfers(wallet.address, 1, 200);
          break;
        } catch (e) {
          const msg = String(e?.message || e).toLowerCase();
          const rateLimited = msg.includes('rate limit') || msg.includes('max calls per sec');
          if (!rateLimited || attempt === 5) throw e;
          await sleep(attempt * 500);
        }
      }
      lastCallAt = Date.now();
      const result = Array.isArray(response?.result) ? response.result : [];

      for (const tx of result) {
        const contract = normalizeAddress(tx.contractAddress);
        const wl = whitelistMap.get(contract);
        if (!wl) continue;

        const confirmations = Number(tx.confirmations || 0);
        if (!Number.isFinite(confirmations) || confirmations <= 0) continue;

        const from = normalizeAddress(tx.from);
        const to = normalizeAddress(tx.to);
        const walletAddr = normalizeAddress(wallet.address);
        const direction = to === walletAddr ? 'incoming' : from === walletAddr ? 'outgoing' : null;
        if (!direction) continue;

        try {
          await prisma.erc20Transfer.create({
            data: {
              walletId: wallet.id,
              chain: 'ethereum',
              txHash: String(tx.hash),
              logIndex: Number(tx.logIndex || 0),
              blockNumber: BigInt(tx.blockNumber || 0),
              blockTimestamp: new Date(Number(tx.timeStamp || 0) * 1000),
              direction,
              tokenContract: String(tx.contractAddress),
              tokenName: wl.tokenName,
              tokenSymbol: tx.tokenSymbol ? String(tx.tokenSymbol) : null,
              tokenDecimals: tx.tokenDecimal ? Number(tx.tokenDecimal) : null,
              amountRaw: String(tx.value || '0'),
              amountNormalized: normalizeAmount(tx.value, tx.tokenDecimal),
              fromAddress: String(tx.from || ''),
              toAddress: String(tx.to || ''),
              confirmations,
              isConfirmed: true,
            },
          });
          syncState.inserted += 1;
        } catch (e) {
          if (!String(e?.message || e).includes('Unique constraint')) throw e;
        }
      }

      await prisma.walletSyncState.upsert({
        where: { walletId: wallet.id },
        create: { walletId: wallet.id, backfillCompleted: true, lastSyncedAt: new Date() },
        update: { backfillCompleted: true, lastSyncedAt: new Date() },
      });

      syncState.processedWallets += 1;
    }

    syncState.finishedAt = new Date().toISOString();
    return { wallets: wallets.length, inserted: syncState.inserted };
  } catch (error) {
    syncState.error = String(error?.message || error);
    syncState.finishedAt = new Date().toISOString();
    throw error;
  } finally {
    syncState.running = false;
  }
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

  if (req.method === 'DELETE' && url.pathname === '/api/wallets') {
    const id = String(url.searchParams.get('id') || '').trim();
    if (!id) return sendJson(res, 400, { error: 'id is required' });
    await prisma.wallet.delete({ where: { id } });
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/wallets/bulk') {
    const body = await readJsonBody(req);
    const raw = String(body.addresses || '');
    const addresses = raw
      .split(/[\n,;\s]+/g)
      .map((x) => x.trim())
      .filter(Boolean);

    if (!addresses.length) return sendJson(res, 400, { error: 'addresses is required' });

    const unique = [...new Set(addresses)];
    const valid = unique.filter((a) => /^0x[a-fA-F0-9]{40}$/.test(a));
    const invalid = unique.filter((a) => !/^0x[a-fA-F0-9]{40}$/.test(a));

    if (!valid.length) {
      return sendJson(res, 400, { error: 'no valid ethereum addresses found', invalid });
    }

    const existing = await prisma.wallet.findMany({
      where: { address: { in: valid } },
      select: { address: true },
    });
    const existingSet = new Set(existing.map((x) => x.address.toLowerCase()));
    const toCreate = valid.filter((a) => !existingSet.has(a.toLowerCase()));

    if (toCreate.length) {
      await prisma.wallet.createMany({
        data: toCreate.map((address) => ({ address })),
      });
    }

    return sendJson(res, 200, {
      ok: true,
      input: addresses.length,
      unique: unique.length,
      created: toCreate.length,
      skippedExisting: valid.length - toCreate.length,
      invalid,
    });
  }

  // tag admin
  if (req.method === 'GET' && url.pathname === '/api/tags') {
    const rows = await prisma.walletTag.groupBy({
      by: ['tag'],
      _count: { walletId: true },
      orderBy: { tag: 'asc' },
    });
    return sendJson(res, 200, rows.map((r) => ({ tag: r.tag, walletCount: r._count.walletId })));
  }

  if (req.method === 'POST' && url.pathname === '/api/tags/assign') {
    const body = await readJsonBody(req);
    const tag = String(body.tag || '').trim();
    const walletIds = Array.isArray(body.walletIds) ? body.walletIds.map((x) => String(x).trim()).filter(Boolean) : [];
    if (!tag) return sendJson(res, 400, { error: 'tag is required' });
    if (!walletIds.length) return sendJson(res, 400, { error: 'walletIds is required' });

    let assigned = 0;
    for (const walletId of walletIds) {
      try {
        await prisma.walletTag.create({ data: { walletId, tag } });
        assigned += 1;
      } catch (e) {
        if (!String(e?.message || e).includes('Unique constraint')) throw e;
      }
    }

    return sendJson(res, 200, { ok: true, tag, assigned, wallets: walletIds.length });
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
    const walletTag = url.searchParams.get('walletTag');

    const items = await prisma.erc20Transfer.findMany({
      where: {
        isConfirmed: true,
        direction: direction === 'incoming' || direction === 'outgoing' ? direction : undefined,
        tokenContract: tokenContract || undefined,
        wallet: {
          ...(walletAddress ? { address: walletAddress } : {}),
          ...(walletTag ? { tags: { some: { tag: walletTag } } } : {}),
        },
        blockTimestamp: start || end ? { gte: start, lte: end } : undefined,
      },
      include: { wallet: { include: { tags: true } } },
      orderBy: { blockTimestamp: 'desc' },
      take: 1000,
    });

    return sendJson(res, 200, items);
  }

  if (req.method === 'POST' && url.pathname === '/api/sync/trigger') {
    if (syncState.running) {
      return sendJson(res, 200, { ok: true, started: false, message: 'sync already running' });
    }
    runManualSync().catch((e) => {
      console.error('sync failed', e);
    });
    return sendJson(res, 202, { ok: true, started: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/sync/status') {
    const progress = syncState.totalWallets > 0
      ? Math.round((syncState.processedWallets / syncState.totalWallets) * 100)
      : 0;
    return sendJson(res, 200, { ...syncState, progress });
  }

  // summary
  if (req.method === 'GET' && url.pathname === '/api/summary') {
    const mode = url.searchParams.get('mode') === 'wallet' ? 'wallet' : 'token';
    const start = parseDate(url.searchParams.get('start'));
    const end = parseDate(url.searchParams.get('end'));
    const direction = url.searchParams.get('direction');
    const tokenContract = url.searchParams.get('tokenContract');
    const walletAddress = url.searchParams.get('walletAddress');
    const walletTag = url.searchParams.get('walletTag');

    const transfers = await prisma.erc20Transfer.findMany({
      where: {
        isConfirmed: true,
        direction: direction === 'incoming' || direction === 'outgoing' ? direction : undefined,
        tokenContract: tokenContract || undefined,
        wallet: {
          ...(walletAddress ? { address: walletAddress } : {}),
          ...(walletTag ? { tags: { some: { tag: walletTag } } } : {}),
        },
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

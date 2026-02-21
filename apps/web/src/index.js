import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { prisma } from '../../../packages/db/src/index.js';
import { makeEtherscanClient } from '../../../packages/etherscan-client/src/index.js';
import { normalizeAddress, syncWalletTransfers } from '../../../packages/sync-engine/src/index.js';
import { createSyncState, pushStateLog } from './lib/sync-state.js';
import {
  badRequest,
  requireString,
  optionalString,
  stringArray,
  unique,
  assertEthereumAddress,
  asTrimmedString,
} from './lib/validate.js';

const port = process.env.PORT || 3000;
const html = readFileSync(join(import.meta.dirname, 'index.html'), 'utf8');

function cleanEnv(value) {
  const v = String(value || '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1).trim();
  }
  return v;
}

const APP_URL = cleanEnv(process.env.APP_URL);
const GOOGLE_CLIENT_ID = cleanEnv(process.env.GOOGLE_CLIENT_ID);
const GOOGLE_CLIENT_SECRET = cleanEnv(process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET_V2);
const GOOGLE_REDIRECT_URI = cleanEnv(process.env.GOOGLE_REDIRECT_URI);
const SESSION_SECRET = cleanEnv(process.env.SESSION_SECRET);
const SESSION_COOKIE = 'tracker_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const oauthStateStore = new Map();
const ADMIN_EMAILS = new Set(
  String(process.env.ADMIN_EMAILS || 'prepregardo@gmail.com')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean),
);

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  for (const pair of raw.split(';')) {
    const [k, ...rest] = pair.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join('='));
  }
  return out;
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signSession(payload) {
  const encoded = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifySession(token) {
  if (!token || !SESSION_SECRET) return null;
  const [encoded, sig] = String(token).split('.');
  if (!encoded || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(encoded).digest('base64url');
  if (sig !== expected) return null;
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (!payload?.exp || Date.now() > payload.exp) return null;
  return payload;
}

function requestBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

function buildGoogleRedirectUri(req) {
  if (GOOGLE_REDIRECT_URI) return GOOGLE_REDIRECT_URI;
  if (APP_URL) return `${APP_URL.replace(/\/$/, '')}/auth/google/callback`;
  return `${requestBaseUrl(req)}/auth/google/callback`;
}

function makeLoginHtml(reason = '') {
  const note = reason ? `<p style="color:#ffb3b3">${reason}</p>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Login</title></head><body style="font-family:Inter,system-ui,sans-serif;background:#0b1020;color:#e9efff;display:grid;place-items:center;min-height:100vh;margin:0"><div style="background:#121a30;border:1px solid #233052;border-radius:14px;padding:24px;max-width:420px"><h2 style="margin-top:0">Crypto Tracker</h2>${note}<a href="/auth/google" style="display:inline-block;padding:10px 14px;border-radius:10px;background:#5aa9ff;color:#04122b;text-decoration:none;font-weight:700">Войти через Google</a></div></body></html>`;
}

function cleanupOauthState() {
  const now = Date.now();
  for (const [k, exp] of oauthStateStore.entries()) {
    if (exp < now) oauthStateStore.delete(k);
  }
}

function tryServeStaticModule(urlPath, res) {
  if (!urlPath.startsWith('/ui/') || !urlPath.endsWith('.js')) return false;
  const baseDir = resolve(import.meta.dirname, 'ui');
  const filePath = resolve(import.meta.dirname, `.${urlPath}`);
  if (!filePath.startsWith(baseDir)) return false;

  try {
    const content = readFileSync(filePath, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

const syncState = createSyncState({
  totalWallets: 0,
  processedWallets: 0,
  inserted: 0,
});

const balanceSyncState = createSyncState({
  total: 0,
  processed: 0,
});


function pushBalanceLog(message, level = 'info') {
  pushStateLog(balanceSyncState, message, level);
}

function pushSyncLog(message, level = 'info') {
  pushStateLog(syncState, message, level);
}

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

function isSelfTransferForWallet(t) {
  const walletAddr = normalizeAddress(t?.wallet?.address);
  if (!walletAddr) return false;
  const from = normalizeAddress(t?.fromAddress);
  const to = normalizeAddress(t?.toAddress);
  return from === walletAddr && to === walletAddr;
}

// normalizeAddress/normalizeAmount moved to @tracker/sync-engine

const ETHERSCAN_RPS = Math.max(1, Number(process.env.ETHERSCAN_RPS || 5));
const ETHERSCAN_MIN_INTERVAL_MS = Math.ceil(1000 / ETHERSCAN_RPS);
const GLOBAL_ETHERSCAN_LOCK_ID = 88442211;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function acquireGlobalEtherscanSlot() {
  const delaySec = ETHERSCAN_MIN_INTERVAL_MS / 1000;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${GLOBAL_ETHERSCAN_LOCK_ID})`);
    await tx.$executeRawUnsafe(`SELECT pg_sleep(${delaySec})`);
  });
}


async function runBalancesEtherscanSync({ tokenContract, walletTag } = {}) {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) throw new Error('ETHERSCAN_API_KEY is not set');
  const client = makeEtherscanClient({
    apiKey,
    beforeRequest: acquireGlobalEtherscanSlot,
    onRetry: ({ attempt, reason }) => pushBalanceLog(`Etherscan retry #${attempt}: ${reason}`, 'warn'),
  });

  const wallets = await prisma.wallet.findMany({
    where: walletTag ? { tags: { some: { tag: walletTag } } } : undefined,
    orderBy: { createdAt: 'asc' },
  });
  const whitelist = await prisma.tokenWhitelist.findMany({
    where: { chain: 'ethereum', ...(tokenContract ? { contractAddress: tokenContract } : {}) },
    orderBy: { createdAt: 'asc' },
  });

  balanceSyncState.running = true;
  balanceSyncState.startedAt = new Date().toISOString();
  balanceSyncState.finishedAt = null;
  balanceSyncState.error = null;
  balanceSyncState.logs = [];
  balanceSyncState.processed = 0;
  balanceSyncState.total = wallets.length * whitelist.length;
  pushBalanceLog(`Balance sync started. Tasks: ${balanceSyncState.total}`);

  let upserted = 0;
  let lastCallAt = 0;
  try {
    for (const w of wallets) {
      for (const t of whitelist) {
        const now = Date.now();
        const wait = Math.max(0, ETHERSCAN_MIN_INTERVAL_MS - (now - lastCallAt));
        if (wait > 0) await sleep(wait);

        const raw = await client.fetchTokenBalance(w.address, t.contractAddress);
        lastCallAt = Date.now();

        const balance = Number(raw || '0') / 1e6; // TODO: per-token decimals
        await prisma.etherscanTokenBalance.upsert({
          where: {
            walletId_tokenContract: {
              walletId: w.id,
              tokenContract: normalizeAddress(t.contractAddress),
            },
          },
          update: {
            tokenName: t.tokenName,
            balance,
            fetchedAt: new Date(),
          },
          create: {
            walletId: w.id,
            tokenContract: normalizeAddress(t.contractAddress),
            tokenName: t.tokenName,
            balance,
            fetchedAt: new Date(),
          },
        });
        upserted += 1;

        balanceSyncState.processed += 1;
      }
      pushBalanceLog(`Wallet done: ${w.address} (${balanceSyncState.processed}/${balanceSyncState.total})`);
    }

    balanceSyncState.finishedAt = new Date().toISOString();
    pushBalanceLog(`Balance sync finished. Upserted rows: ${upserted}`);
  } catch (error) {
    balanceSyncState.error = String(error?.message || error);
    balanceSyncState.finishedAt = new Date().toISOString();
    pushBalanceLog(`Balance sync failed: ${balanceSyncState.error}`, 'error');
    throw error;
  } finally {
    balanceSyncState.running = false;
  }
}

async function runManualSync() {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) throw new Error('ETHERSCAN_API_KEY is not set');
  const client = makeEtherscanClient({
    apiKey,
    beforeRequest: acquireGlobalEtherscanSlot,
    onRetry: ({ attempt, reason }) => pushSyncLog(`Etherscan retry #${attempt}: ${reason}`, 'warn'),
  });

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
  syncState.logs = [];
  pushSyncLog(`Sync started. Wallets in queue: ${wallets.length}`);

  try {
    let lastCallAt = 0;
    for (const wallet of wallets) {
      pushSyncLog(`Processing wallet ${wallet.address}`);
      const now = Date.now();
      const wait = Math.max(0, ETHERSCAN_MIN_INTERVAL_MS - (now - lastCallAt));
      if (wait > 0) await sleep(wait);

      const result = await syncWalletTransfers({
        prisma,
        client,
        wallet,
        whitelistMap,
        onPage: ({ page, walletEvents }) => {
          pushSyncLog(`Wallet ${wallet.address}: scanned page ${page}, events so far ${walletEvents}`);
        },
      });

      lastCallAt = Date.now();
      syncState.inserted += result.inserted;
      syncState.processedWallets += 1;
      pushSyncLog(`Wallet done ${wallet.address}. Progress ${syncState.processedWallets}/${syncState.totalWallets}, inserted +${syncState.inserted}`);
    }

    syncState.finishedAt = new Date().toISOString();
    pushSyncLog(`Sync finished successfully. Total inserted: ${syncState.inserted}`);
    return { wallets: wallets.length, inserted: syncState.inserted };
  } catch (error) {
    syncState.error = String(error?.message || error);
    syncState.finishedAt = new Date().toISOString();
    pushSyncLog(`Sync failed: ${syncState.error}`, 'error');
    throw error;
  } finally {
    syncState.running = false;
  }
}

function getAuthUser(req) {
  const cookies = parseCookies(req);
  return verifySession(cookies[SESSION_COOKIE]);
}

function setSessionCookie(req, res, payload) {
  const token = signSession({ ...payload, exp: Date.now() + SESSION_TTL_SECONDS * 1000 });
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https') || (req.headers.host || '').includes('onrender.com');
  const cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure ? '; Secure' : ''}`;
  res.setHeader('Set-Cookie', cookie);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function requireApiAuth(req, res) {
  const user = getAuthUser(req);
  if (!user) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return null;
  }
  return user;
}

function parseUserRole(value) {
  const role = String(value || '').trim();
  if (role !== 'admin' && role !== 'read_only') throw badRequest('role must be admin or read_only');
  return role;
}

async function ensureAdminOrThrow(authUser) {
  const me = await prisma.user.findUnique({ where: { id: authUser.uid }, select: { id: true, role: true } });
  if (!me || me.role !== 'admin') {
    const err = new Error('Forbidden: admin only');
    err.status = 403;
    throw err;
  }
  return me;
}

async function ensureNotLastAdminRemoval(targetUserId, nextRole) {
  const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, role: true } });
  if (!target) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const willLoseAdmin = target.role === 'admin' && nextRole !== 'admin';
  if (!willLoseAdmin) return target;

  const adminCount = await prisma.user.count({ where: { role: 'admin' } });
  if (adminCount <= 1) {
    const err = new Error('Cannot remove role from the last admin');
    err.status = 409;
    throw err;
  }
  return target;
}

async function handleGoogleAuthStart(req, res) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !SESSION_SECRET) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Google auth is not configured');
    return;
  }

  cleanupOauthState();
  const state = crypto.randomBytes(24).toString('hex');
  oauthStateStore.set(state, Date.now() + 10 * 60 * 1000);

  const redirectUri = buildGoogleRedirectUri(req);
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });

  res.writeHead(302, { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
  res.end();
}

async function handleGoogleAuthCallback(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const code = String(url.searchParams.get('code') || '');
    const state = String(url.searchParams.get('state') || '');
    const err = String(url.searchParams.get('error') || '');

    if (err) {
      res.writeHead(302, { Location: '/?auth_error=google_denied' });
      return res.end();
    }

    cleanupOauthState();
    const exp = oauthStateStore.get(state);
    if (!state || !exp || exp < Date.now()) {
      res.writeHead(302, { Location: '/?auth_error=bad_state' });
      return res.end();
    }
    oauthStateStore.delete(state);

    if (!code) {
      res.writeHead(302, { Location: '/?auth_error=no_code' });
      return res.end();
    }

    const redirectUri = buildGoogleRedirectUri(req);
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenRes.ok) {
      const details = await tokenRes.text().catch(() => '');
      console.error(`Google token exchange failed: ${tokenRes.status} ${details}`);
      res.writeHead(302, { Location: '/?auth_error=oauth_token' });
      return res.end();
    }

    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson?.access_token;
    if (!accessToken) {
      res.writeHead(302, { Location: '/?auth_error=no_access_token' });
      return res.end();
    }

    const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userRes.ok) {
      console.error(`Google userinfo failed: ${userRes.status}`);
      res.writeHead(302, { Location: '/?auth_error=oauth_userinfo' });
      return res.end();
    }
    const profile = await userRes.json();

    if (!profile?.email || !profile?.email_verified) {
      res.writeHead(302, { Location: '/?auth_error=unverified_email' });
      return res.end();
    }

    const normalizedEmail = String(profile.email).toLowerCase();

    let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      const grantedRole = ADMIN_EMAILS.has(normalizedEmail) ? 'admin' : 'read_only';
      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          passwordHash: 'oauth_google',
          role: grantedRole,
        },
      });
    }

    setSessionCookie(req, res, { uid: user.id, email: user.email, role: user.role });
    res.writeHead(302, { Location: '/' });
    res.end();
  } catch (error) {
    console.error('OAuth callback failed', error);
    if (!res.headersSent) {
      res.writeHead(302, { Location: '/?auth_error=oauth_exception' });
      return res.end();
    }
  }
}

async function handleApi(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    const me = getAuthUser(req);
    if (!me) return sendJson(res, 401, { error: 'Unauthorized' });
    return sendJson(res, 200, { user: { id: me.uid, email: me.email, role: me.role } });
  }

  const authUser = requireApiAuth(req, res);
  if (!authUser) return true;

  if (req.method === 'GET' && url.pathname === '/api/access/users') {
    await ensureAdminOrThrow(authUser);
    const users = await prisma.user.findMany({
      orderBy: [{ role: 'asc' }, { updatedAt: 'desc' }],
      select: { id: true, email: true, role: true, createdAt: true, updatedAt: true },
    });
    return sendJson(res, 200, users.map((u) => ({ ...u, status: 'active' })));
  }

  if (req.method === 'POST' && url.pathname === '/api/access/users') {
    await ensureAdminOrThrow(authUser);
    const body = await readJsonBody(req);
    const email = requireString(body.email, 'email').toLowerCase();
    const role = parseUserRole(body.role);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      await ensureNotLastAdminRemoval(existing.id, role);
    }

    const user = await prisma.user.upsert({
      where: { email },
      update: { role },
      create: { email, role, passwordHash: 'oauth_google' },
      select: { id: true, email: true, role: true, createdAt: true, updatedAt: true },
    });
    return sendJson(res, 200, { ...user, status: 'active' });
  }

  if (req.method === 'PUT' && url.pathname === '/api/access/users/role') {
    await ensureAdminOrThrow(authUser);
    const body = await readJsonBody(req);
    const id = requireString(body.id, 'id');
    const role = parseUserRole(body.role);

    await ensureNotLastAdminRemoval(id, role);

    const user = await prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, email: true, role: true, createdAt: true, updatedAt: true },
    });

    return sendJson(res, 200, { ...user, status: 'active' });
  }

  if (req.method === 'POST' && url.pathname === '/api/access/users/disable') {
    await ensureAdminOrThrow(authUser);
    const body = await readJsonBody(req);
    const id = requireString(body.id, 'id');

    if (id === authUser.uid) {
      const err = new Error('You cannot disable your own account');
      err.status = 409;
      throw err;
    }

    await ensureNotLastAdminRemoval(id, 'read_only');
    await prisma.user.delete({ where: { id } });
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/access/audit') {
    await ensureAdminOrThrow(authUser);
    const users = await prisma.user.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: { email: true, role: true, updatedAt: true },
    });
    const events = users.map((u) => ({
      ts: u.updatedAt,
      message: `Роль ${u.email}: ${u.role}`,
    }));
    return sendJson(res, 200, events);
  }

  if (!authUser) return true;
  const isReadOnly = authUser.role === 'read_only';
  const isWriteMethod = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
  if (isReadOnly && isWriteMethod) {
    return sendJson(res, 403, { error: 'Forbidden: read_only role' });
  }

  // wallets
  if (req.method === 'GET' && url.pathname === '/api/wallets') {
    const items = await prisma.wallet.findMany({ include: { tags: true }, orderBy: { createdAt: 'desc' } });
    return sendJson(res, 200, items);
  }

  if (req.method === 'POST' && url.pathname === '/api/wallets') {
    const body = await readJsonBody(req);
    const address = assertEthereumAddress(requireString(body.address, 'address'));
    const label = optionalString(body.label);
    const walletNumber = optionalString(body.walletNumber);
    const tags = unique(stringArray(body.tags));

    const created = await prisma.wallet.create({
      data: {
        address,
        label,
        walletNumber,
        tags: tags.length ? { create: tags.map((tag) => ({ tag })) } : undefined,
      },
      include: { tags: true },
    });
    return sendJson(res, 201, created);
  }

  if (req.method === 'DELETE' && url.pathname === '/api/wallets') {
    const id = requireString(url.searchParams.get('id'), 'id');
    await prisma.wallet.delete({ where: { id } });
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'PUT' && url.pathname === '/api/wallets/number') {
    const body = await readJsonBody(req);
    const id = requireString(body.id, 'id');
    const walletNumber = optionalString(body.walletNumber);
    const updated = await prisma.wallet.update({
      where: { id },
      data: { walletNumber },
      include: { tags: true },
    });
    return sendJson(res, 200, updated);
  }

  if (req.method === 'POST' && url.pathname === '/api/wallets/bulk') {
    const body = await readJsonBody(req);
    const raw = asTrimmedString(body.addresses);
    if (!raw) throw badRequest('addresses is required');

    const addresses = raw
      .split(/[\n,;\s]+/g)
      .map((x) => x.trim())
      .filter(Boolean);

    const deduped = unique(addresses);
    const valid = deduped.filter((a) => /^0x[a-fA-F0-9]{40}$/.test(a));
    const invalid = deduped.filter((a) => !/^0x[a-fA-F0-9]{40}$/.test(a));

    if (!valid.length) {
      throw badRequest('no valid ethereum addresses found', { invalid });
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
      unique: deduped.length,
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
    const tag = requireString(body.tag, 'tag');
    const walletIds = unique(stringArray(body.walletIds));
    if (!walletIds.length) throw badRequest('walletIds is required');

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
    const contractAddress = assertEthereumAddress(requireString(body.contractAddress, 'contractAddress'), 'contractAddress');
    const tokenName = requireString(body.tokenName, 'tokenName');

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
    const includeSpam = url.searchParams.get('includeSpam') === '1';

    const items = await prisma.erc20Transfer.findMany({
      where: {
        isConfirmed: true,
        ...(includeSpam ? {} : { amountRaw: { not: '0' } }),
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
      pushSyncLog('Sync trigger ignored: already running', 'warn');
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

  // balances (ledger)
  if (req.method === 'GET' && url.pathname === '/api/balances') {
    const tokenContract = url.searchParams.get('tokenContract');
    const walletTag = url.searchParams.get('walletTag');

    const transfers = await prisma.erc20Transfer.findMany({
      where: {
        isConfirmed: true,
        amountRaw: { not: '0' },
        tokenContract: tokenContract || undefined,
        wallet: walletTag ? { tags: { some: { tag: walletTag } } } : undefined,
      },
      include: { wallet: true },
      orderBy: { blockTimestamp: 'desc' },
      take: 50000,
    });

    const map = new Map();
    for (const t of transfers) {
      if (isSelfTransferForWallet(t)) continue;
      const key = `${t.wallet.address}:${t.tokenContract.toLowerCase()}`;
      const prev = map.get(key) || {
        walletAddress: t.wallet.address,
        walletNumber: t.wallet.walletNumber,
        tokenContract: t.tokenContract,
        tokenName: t.tokenName,
        tokenSymbol: t.tokenSymbol,
        balance: 0,
      };
      const amount = Number(t.amountNormalized || 0);
      if (t.direction === 'incoming') prev.balance += amount;
      if (t.direction === 'outgoing') prev.balance -= amount;
      map.set(key, prev);
    }

    const rows = Array.from(map.values())
      .map((r) => ({ ...r, balance: Math.abs(r.balance) < 1e-9 ? 0 : r.balance }))
      .sort((a, b) => a.balance - b.balance);
    return sendJson(res, 200, rows);
  }

  // balances (etherscan)
  if (req.method === 'POST' && url.pathname === '/api/balances/etherscan/sync') {
    if (balanceSyncState.running) return sendJson(res, 200, { ok: true, started: false, message: 'already running' });
    const body = await readJsonBody(req);
    const tokenContract = optionalString(body.tokenContract) || '';
    const walletTag = optionalString(body.walletTag) || '';
    if (tokenContract) assertEthereumAddress(tokenContract, 'tokenContract');

    runBalancesEtherscanSync({ tokenContract, walletTag }).catch((e) => {
      console.error('balance sync failed', e);
    });
    return sendJson(res, 202, { ok: true, started: true });
  }

  if (req.method === 'GET' && url.pathname === '/api/balances/etherscan/status') {
    const progress = balanceSyncState.total > 0 ? Math.round((balanceSyncState.processed / balanceSyncState.total) * 100) : 0;
    return sendJson(res, 200, { ...balanceSyncState, progress });
  }

  if (req.method === 'GET' && url.pathname === '/api/balances/etherscan') {
    const tokenContract = (url.searchParams.get('tokenContract') || '').toLowerCase();
    const walletTag = url.searchParams.get('walletTag') || '';

    const rows = await prisma.etherscanTokenBalance.findMany({
      where: {
        ...(tokenContract ? { tokenContract } : {}),
        wallet: {
          ...(walletTag ? { tags: { some: { tag: walletTag } } } : {}),
        },
      },
      include: {
        wallet: true,
      },
      orderBy: { balance: 'asc' },
    });

    return sendJson(res, 200, rows.map((r) => ({
      walletAddress: r.wallet.address,
      walletNumber: r.wallet.walletNumber,
      tokenContract: r.tokenContract,
      tokenName: r.tokenName,
      balance: Number(r.balance || 0),
      fetchedAt: r.fetchedAt,
    })));
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
    const includeSpam = url.searchParams.get('includeSpam') === '1';

    const transfers = await prisma.erc20Transfer.findMany({
      where: {
        isConfirmed: true,
        ...(includeSpam ? {} : { amountRaw: { not: '0' } }),
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
      if (isSelfTransferForWallet(t)) continue;
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

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection in web process', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in web process', error);
});

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');

      if (url.pathname === '/health') {
        return sendJson(res, 200, { ok: true, service: 'tracker-web' });
      }

      if (tryServeStaticModule(url.pathname, res)) {
        return;
      }

      if (url.pathname === '/auth/google') {
        return await handleGoogleAuthStart(req, res);
      }

      if (url.pathname === '/auth/google/callback') {
        return await handleGoogleAuthCallback(req, res);
      }

      if (url.pathname === '/auth/logout') {
        clearSessionCookie(res);
        res.writeHead(302, { Location: '/' });
        return res.end();
      }

      if (url.pathname.startsWith('/api/')) {
        const handled = await handleApi(req, res);
        if (handled !== false) return;
        return sendJson(res, 404, { error: 'Not found' });
      }

      const authError = url.searchParams.get('auth_error');
      const authUser = getAuthUser(req);
      if (!authUser) {
        const reason = authError ? `Ошибка входа: ${authError}` : '';
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
        });
        return res.end(makeLoginHtml(reason));
      }

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      });
      res.end(html);
    } catch (error) {
      if (error?.status && Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
        return sendJson(res, error.status, { error: String(error?.message || error), details: error?.details });
      }
      console.error(error);
      sendJson(res, 500, { error: String(error?.message || error) });
    }
  })
  .listen(port, () => {
    console.log(`tracker-web listening on ${port}`);
  });

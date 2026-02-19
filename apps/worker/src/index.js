import { prisma } from '../../../packages/db/src/index.js';
import { makeEtherscanClient } from '../../../packages/etherscan-client/src/index.js';

const intervalMs = Number(process.env.SYNC_INTERVAL_MS || 60_000);
const etherscanApiKey = process.env.ETHERSCAN_API_KEY;
const ETHERSCAN_RPS = Math.max(1, Number(process.env.ETHERSCAN_RPS || 5));
const ETHERSCAN_MIN_INTERVAL_MS = Math.ceil(1000 / ETHERSCAN_RPS);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!etherscanApiKey) {
  console.error('ETHERSCAN_API_KEY is required for worker sync');
  process.exit(1);
}

const client = makeEtherscanClient({ apiKey: etherscanApiKey });

function normalizeAddress(v) {
  return String(v || '').toLowerCase();
}

function normalizeAmount(raw, decimals) {
  const d = Number(decimals || 0);
  const n = Number(raw || 0);
  if (!Number.isFinite(n)) return 0;
  return n / 10 ** d;
}

async function syncWallet(wallet, whitelistMap) {
  const PAGE_SIZE = 100;
  let page = 1;
  let saved = 0;

  while (true) {
    let response;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        response = await client.fetchErc20Transfers(wallet.address, page, PAGE_SIZE);
        break;
      } catch (e) {
        const msg = String(e?.message || e).toLowerCase();
        const rateLimited = msg.includes('rate limit') || msg.includes('max calls per sec');
        if (!rateLimited || attempt === 5) throw e;
        await sleep(attempt * 500);
      }
    }

    const result = Array.isArray(response?.result) ? response.result : [];
    if (!result.length) break;

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
        saved += 1;
      } catch (e) {
        if (!String(e?.message || e).includes('Unique constraint')) {
          console.error('save transfer error', e);
        }
      }
    }

    if (result.length < PAGE_SIZE) break;
    page += 1;
    await sleep(ETHERSCAN_MIN_INTERVAL_MS);
  }

  await prisma.walletSyncState.upsert({
    where: { walletId: wallet.id },
    create: { walletId: wallet.id, backfillCompleted: true, lastSyncedAt: new Date() },
    update: { backfillCompleted: true, lastSyncedAt: new Date() },
  });

  return saved;
}

async function runSyncTick() {
  const wallets = await prisma.wallet.findMany();
  const whitelist = await prisma.tokenWhitelist.findMany({ where: { chain: 'ethereum' } });
  const whitelistMap = new Map(whitelist.map((x) => [normalizeAddress(x.contractAddress), x]));

  let total = 0;
  let lastCallAt = 0;
  for (const wallet of wallets) {
    const now = Date.now();
    const wait = Math.max(0, ETHERSCAN_MIN_INTERVAL_MS - (now - lastCallAt));
    if (wait > 0) await sleep(wait);

    const saved = await syncWallet(wallet, whitelistMap);
    lastCallAt = Date.now();
    total += saved;
  }

  console.log(`[worker] synced wallets=${wallets.length}, inserted=${total}`);
}

async function main() {
  console.log(`[worker] started, interval=${intervalMs}ms`);
  await runSyncTick();
  setInterval(() => {
    runSyncTick().catch((err) => console.error('[worker] tick failed', err));
  }, intervalMs);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

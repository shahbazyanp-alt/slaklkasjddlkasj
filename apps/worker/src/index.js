import { prisma } from '../../../packages/db/src/index.js';
import { makeEtherscanClient } from '../../../packages/etherscan-client/src/index.js';
import { normalizeAddress, syncWalletTransfers } from '../../../packages/sync-engine/src/index.js';

const etherscanApiKey = process.env.ETHERSCAN_API_KEY;
const ETHERSCAN_RPS = Math.max(1, Number(process.env.ETHERSCAN_RPS || 5));
const ETHERSCAN_MIN_INTERVAL_MS = Math.ceil(1000 / ETHERSCAN_RPS);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!etherscanApiKey) {
  console.error('ETHERSCAN_API_KEY is required for worker sync');
  process.exit(1);
}

const GLOBAL_ETHERSCAN_LOCK_ID = 88442211;

async function acquireGlobalEtherscanSlot() {
  const delaySec = ETHERSCAN_MIN_INTERVAL_MS / 1000;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${GLOBAL_ETHERSCAN_LOCK_ID})`);
    await tx.$executeRawUnsafe(`SELECT pg_sleep(${delaySec})`);
  });
}

const client = makeEtherscanClient({
  apiKey: etherscanApiKey,
  beforeRequest: acquireGlobalEtherscanSlot,
  onRetry: ({ attempt, reason }) => {
    console.warn(`[worker] etherscan retry #${attempt}: ${reason}`);
  },
});

// syncWallet removed: moved to @tracker/sync-engine

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

    const result = await syncWalletTransfers({
      prisma,
      client,
      wallet,
      whitelistMap,
    });
    lastCallAt = Date.now();
    total += result.inserted;
  }

  console.log(`[worker] synced wallets=${wallets.length}, inserted=${total}`);
}

async function main() {
  console.log('[worker] started in manual-only mode (auto refresh disabled)');
  // Keep worker process alive, but do not run automatic sync ticks.
  setInterval(() => {
    // noop heartbeat
  }, 60 * 60 * 1000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

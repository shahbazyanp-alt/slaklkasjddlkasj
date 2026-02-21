import { prisma } from '../../../packages/db/src/index.js';

async function main() {
  console.log('[worker] started in disabled sync mode (no scan function)');
  // Keep process alive for future background jobs not related to transfer scan.
  setInterval(async () => {
    try {
      await prisma.$queryRawUnsafe('SELECT 1');
    } catch (e) {
      console.warn('[worker] heartbeat failed:', String(e?.message || e));
    }
  }, 60 * 60 * 1000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

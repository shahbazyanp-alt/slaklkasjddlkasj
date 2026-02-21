export function normalizeAddress(v) {
  return String(v || '').toLowerCase();
}

export function normalizeAmount(raw, decimals) {
  const d = Number(decimals || 0);
  const n = Number(raw || 0);
  if (!Number.isFinite(n)) return 0;
  return n / 10 ** d;
}

function isUniqueConstraintError(error) {
  return String(error?.message || error).includes('Unique constraint');
}

export async function syncWalletTransfers({
  prisma,
  client,
  wallet,
  whitelistMap,
  pageSize = 100,
  onPage = null,
  onWalletDone = null,
  onTransferInserted = null,
}) {
  let page = 1;
  let inserted = 0;
  let walletEvents = 0;

  while (true) {
    const response = await client.fetchErc20Transfers(wallet.address, page, pageSize);
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
      if (from === walletAddr && to === walletAddr) continue;

      const direction = to === walletAddr ? 'incoming' : from === walletAddr ? 'outgoing' : null;
      if (!direction) continue;

      walletEvents += 1;

      try {
        await prisma.erc20Transfer.create({
          data: {
            walletId: wallet.id,
            network: 'ERC20',
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
        inserted += 1;
        if (onTransferInserted) onTransferInserted({ wallet, tx, inserted, walletEvents });
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
      }
    }

    if (onPage) onPage({ wallet, page, walletEvents, inserted });
    if (result.length < pageSize) break;
    page += 1;
  }

  await prisma.walletSyncState.upsert({
    where: { walletId: wallet.id },
    create: { walletId: wallet.id, backfillCompleted: true, lastSyncedAt: new Date() },
    update: { backfillCompleted: true, lastSyncedAt: new Date() },
  });

  if (onWalletDone) onWalletDone({ wallet, inserted, walletEvents, pagesScanned: page });

  return { inserted, walletEvents, pagesScanned: page };
}

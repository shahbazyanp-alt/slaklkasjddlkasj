export function pivotStableRows(rows, sort = 'asc') {
  const byWallet = new Map();

  for (const r of rows || []) {
    const key = String(r.walletAddress || '');
    if (!key) continue;

    const prev = byWallet.get(key) || {
      walletAddress: key,
      walletNumber: r.walletNumber || '',
      usdt: 0,
      usdc: 0,
    };

    const token = `${String(r.tokenSymbol || '').toUpperCase()} ${String(r.tokenName || '').toUpperCase()}`;
    if (token.includes('USDT')) prev.usdt += Number(r.balance || 0);
    if (token.includes('USDC')) prev.usdc += Number(r.balance || 0);

    byWallet.set(key, prev);
  }

  const list = Array.from(byWallet.values());
  list.sort((a, b) => {
    const ta = a.usdt + a.usdc;
    const tb = b.usdt + b.usdc;
    return sort === 'asc' ? ta - tb : tb - ta;
  });

  return list;
}

export function sumStableTotals(rows) {
  return {
    totalUsdt: rows.reduce((s, r) => s + Number(r.usdt || 0), 0),
    totalUsdc: rows.reduce((s, r) => s + Number(r.usdc || 0), 0),
  };
}

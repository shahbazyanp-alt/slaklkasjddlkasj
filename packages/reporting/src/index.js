export function summarizeByToken(transfers) {
  return transfers.reduce((acc, t) => {
    const key = t.tokenSymbol || t.tokenName || t.contractAddress;
    const prev = acc.get(key) || { incoming: 0, outgoing: 0 };
    if (t.direction === 'incoming') prev.incoming += Number(t.amount || 0);
    if (t.direction === 'outgoing') prev.outgoing += Number(t.amount || 0);
    acc.set(key, prev);
    return acc;
  }, new Map());
}

export function summarizeByWallet(transfers) {
  return transfers.reduce((acc, t) => {
    const key = t.walletAddress;
    const prev = acc.get(key) || { incoming: 0, outgoing: 0 };
    if (t.direction === 'incoming') prev.incoming += Number(t.amount || 0);
    if (t.direction === 'outgoing') prev.outgoing += Number(t.amount || 0);
    acc.set(key, prev);
    return acc;
  }, new Map());
}

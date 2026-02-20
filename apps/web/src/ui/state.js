export function createInitialState() {
  return {
    wallets: [],
    whitelist: [],
    transfers: [],
    tags: [],
    balances: [],
    balancesEtherscan: [],
    summaryMode: 'token',
    filters: { start: '', end: '', direction: '', tokenContract: '', walletAddress: '', walletTag: '', includeSpam: false },
    balanceFilters: { tokenContract: '', walletTag: '' },
    balanceSort: 'asc',
  };
}

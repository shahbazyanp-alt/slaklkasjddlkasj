export function makeEtherscanClient({ apiKey, baseUrl = 'https://api.etherscan.io/v2/api', chainId = 1, beforeRequest = null }) {
  if (!apiKey) throw new Error('ETHERSCAN_API_KEY is required');

  async function call(params) {
    if (beforeRequest) await beforeRequest();
    const url = new URL(baseUrl);
    url.searchParams.set('chainid', String(chainId));
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    url.searchParams.set('apikey', apiKey);

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Etherscan HTTP ${res.status}`);
    return res.json();
  }

  return {
    async fetchErc20Transfers(address, page = 1, offset = 100) {
      const json = await call({ module: 'account', action: 'tokentx', address, sort: 'asc', page, offset });
      if (!Array.isArray(json?.result)) {
        const msg = typeof json?.result === 'string' ? json.result : (json?.message || 'Unknown Etherscan response');
        throw new Error(`Etherscan API error: ${msg}`);
      }
      return json;
    },

    async fetchTokenBalance(address, contractAddress) {
      const json = await call({ module: 'account', action: 'tokenbalance', address, contractaddress: contractAddress, tag: 'latest' });
      if (typeof json?.result !== 'string') {
        const msg = typeof json?.result === 'string' ? json.result : (json?.message || 'Unknown Etherscan response');
        throw new Error(`Etherscan API error: ${msg}`);
      }
      return json.result;
    },
  };
}

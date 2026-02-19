export function makeEtherscanClient({ apiKey, baseUrl = 'https://api.etherscan.io/v2/api', chainId = 1 }) {
  if (!apiKey) throw new Error('ETHERSCAN_API_KEY is required');

  return {
    async fetchErc20Transfers(address, page = 1, offset = 100) {
      const url = new URL(baseUrl);
      url.searchParams.set('chainid', String(chainId));
      url.searchParams.set('module', 'account');
      url.searchParams.set('action', 'tokentx');
      url.searchParams.set('address', address);
      url.searchParams.set('sort', 'asc');
      url.searchParams.set('page', String(page));
      url.searchParams.set('offset', String(offset));
      url.searchParams.set('apikey', apiKey);

      const res = await fetch(url);
      if (!res.ok) throw new Error(`Etherscan HTTP ${res.status}`);
      const json = await res.json();

      if (!Array.isArray(json?.result)) {
        const msg = typeof json?.result === 'string' ? json.result : (json?.message || 'Unknown Etherscan response');
        throw new Error(`Etherscan API error: ${msg}`);
      }

      return json;
    },
  };
}

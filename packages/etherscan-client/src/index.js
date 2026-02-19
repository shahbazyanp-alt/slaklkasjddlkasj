export function makeEtherscanClient({ apiKey, baseUrl = 'https://api.etherscan.io/api' }) {
  if (!apiKey) throw new Error('ETHERSCAN_API_KEY is required');

  return {
    async fetchErc20Transfers(address, page = 1, offset = 100) {
      const url = new URL(baseUrl);
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
      return json;
    },
  };
}

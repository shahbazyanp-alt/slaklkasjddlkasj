const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function asText(value) {
  return String(value || '').toLowerCase();
}

function isRateLimitedPayload(json) {
  const msg = `${asText(json?.message)} ${asText(json?.result)} ${asText(json?.error)} ${asText(json?.error?.message)}`;
  return msg.includes('rate limit') || msg.includes('max calls per sec') || msg.includes('too many requests');
}

function isTemporaryPayloadFailure(json) {
  const msg = `${asText(json?.message)} ${asText(json?.result)} ${asText(json?.error)} ${asText(json?.error?.message)}`;
  return msg.includes('temporarily unavailable') || msg.includes('timeout') || msg.includes('gateway') || msg.includes('service unavailable');
}

export function makeEtherscanClient({
  apiKey,
  baseUrl = 'https://api.etherscan.io/v2/api',
  chainId = 1,
  beforeRequest = null,
  onRetry = null,
}) {
  if (!apiKey) throw new Error('ETHERSCAN_API_KEY is required');

  async function call(params) {
    let attempt = 0;

    while (true) {
      attempt += 1;
      if (beforeRequest) await beforeRequest();

      try {
        const url = new URL(baseUrl);
        url.searchParams.set('chainid', String(chainId));
        Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
        url.searchParams.set('apikey', apiKey);

        const res = await fetch(url);
        const json = await res.json().catch(() => null);

        const shouldRetry =
          res.status === 429
          || res.status >= 500
          || isRateLimitedPayload(json)
          || isTemporaryPayloadFailure(json);

        if (shouldRetry) {
          if (onRetry) onRetry({ attempt, reason: `etherscan temporary failure status=${res.status}` });
          await sleep(1000);
          continue;
        }

        if (!res.ok) {
          throw new Error(`Etherscan HTTP ${res.status}`);
        }

        return json;
      } catch (error) {
        if (onRetry) onRetry({ attempt, reason: String(error?.message || error) });
        await sleep(1000);
      }
    }
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

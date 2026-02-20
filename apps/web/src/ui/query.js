export function buildTransfersQuery(filters) {
  const q = new URLSearchParams();
  if (filters.start) q.set('start', filters.start);
  if (filters.end) q.set('end', filters.end);
  if (filters.direction) q.set('direction', filters.direction);
  if (filters.tokenContract) q.set('tokenContract', filters.tokenContract);
  if (filters.walletAddress) q.set('walletAddress', filters.walletAddress);
  if (filters.walletTag) q.set('walletTag', filters.walletTag);
  if (filters.includeSpam) q.set('includeSpam', '1');
  return q.toString();
}

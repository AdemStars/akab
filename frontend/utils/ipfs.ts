export const DEFAULT_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
];

/**
 * Checks if a string looks like a standard IPFS CID (CIDv0 Qm... or CIDv1 bafy...)
 */
export function isIpfsCid(str: string): boolean {
  if (!str || typeof str !== 'string') return false;
  const clean = str.replace(/^ipfs:\/\//, '').trim();
  // CIDv0 starts with Qm and is 46 chars base58
  // CIDv1 starts with bafy... or other multibase prefixes
  return (
    (clean.startsWith('Qm') && clean.length === 46) ||
    clean.startsWith('bafy') ||
    clean.startsWith('bafk')
  );
}

export const isValidIpfsCid = isIpfsCid;

/**
 * Formats an IPFS reference into a clickable HTTP gateway URL
 */
export function formatIpfsGatewayUrl(cidOrUrl: string, gatewayIndex = 0): string {
  if (!cidOrUrl) return '';

  const cleanCid = cidOrUrl.replace(/^ipfs:\/\//, '').trim();

  // If running in browser and local fallback gateway is used, point to backend route
  if (typeof window !== 'undefined' && window.location && (window.location.port === '3000' || window.location.port === '4000')) {
    return `/api/ipfs/${cleanCid}`;
  }

  const gateway = DEFAULT_GATEWAYS[gatewayIndex] || DEFAULT_GATEWAYS[0];
  return `${gateway}${cleanCid}`;
}

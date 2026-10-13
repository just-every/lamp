import { isPublicAddress } from './public-address.ts';
export { isPublicAddress } from './public-address.ts';

export function validateDestination(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid destination'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') || value.length > 8192) throw new Error('Destination must be public HTTPS without credentials, fragment or nonstandard port');
  const host = url.hostname.toLowerCase();
  if (!host || host.endsWith('.') || host === 'localhost' || /\.(localhost|local|internal|invalid|test)$/.test(host)) throw new Error('Destination hostname is not public');
  if (host.includes(':') || /^[\d.]+$/.test(host)) { if (!isPublicAddress(host)) throw new Error('Destination address is not public'); }
  else if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)) throw new Error('Invalid destination hostname');
  return url;
}

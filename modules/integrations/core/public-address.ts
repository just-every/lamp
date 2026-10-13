/** Maintained conservative routing policy for both saved literals and every DNS answer.
 * Special-purpose allocations reject even when some are globally reachable. */
const nonPublicRanges = {
  ipv4: [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['168.63.129.16', 32], // Azure platform virtual address
    ['169.254.0.0', 16], ['172.16.0.0', 12],
    ['192.0.0.0', 16], // Preserve Base's broader exclusion, including 192.0.2.0/24.
    ['192.31.196.0', 24], ['192.52.193.0', 24], ['192.88.99.0', 24],
    ['192.168.0.0', 16], ['192.175.48.0', 24], ['198.18.0.0', 15],
    ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
  ],
  ipv6: [
    ['::', 3], ['4000::', 2], ['8000::', 1], // Only ordinary 2000::/3 unicast is eligible.
    ['2001::', 23], ['2001:db8::', 32], ['2002::', 16],
    ['2620:4f:8000::', 48], ['3ffe::', 16],
    ['3fff::', 16], // Preserve Base's broader exclusion than the 3fff::/20 allocation.
  ],
} as const;

function ipv4(address: string): number | null {
  const octets = address.split('.');
  if (octets.length !== 4 || octets.some(octet => !/^(0|[1-9]\d{0,2})$/.test(octet))) return null;
  const bytes = octets.map(Number);
  if (bytes.some(byte => byte > 255)) return null;
  return bytes.reduce((value, byte) => value * 256 + byte, 0);
}

function ipv6(address: string): bigint | null {
  if (!/^[0-9a-f:]+$/.test(address) || !address.includes(':')) return null;
  const pieces = address.split('::');
  if (pieces.length > 2) return null;
  const left = pieces[0] ? pieces[0].split(':') : [];
  const right = pieces[1] ? pieces[1].split(':') : [];
  if ([...left, ...right].some(word => !/^[0-9a-f]{1,4}$/.test(word))) return null;
  const missing = 8 - left.length - right.length;
  if ((pieces.length === 1 && missing !== 0) || (pieces.length === 2 && missing < 1)) return null;
  return [...left, ...Array(pieces.length === 2 ? missing : 0).fill('0'), ...right]
    .reduce((value: bigint, word: string) => (value << 16n) | BigInt(parseInt(word, 16)), 0n);
}

const ipv4Ranges = nonPublicRanges.ipv4.map(([base, bits]) => ({ base: ipv4(base)!, divisor: 2 ** (32 - bits) }));
const ipv6Ranges = nonPublicRanges.ipv6.map(([base, bits]) => ({ base: ipv6(base)!, shift: BigInt(128 - bits) }));

/** Portable Worker/Node guard; DNS and URL callers share this exact policy. */
export function isPublicAddress(raw: string): boolean {
  if (typeof raw !== 'string') return false;
  const address = (raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw).toLowerCase();
  const v4 = ipv4(address);
  if (v4 !== null) return !ipv4Ranges.some(({ base, divisor }) => Math.floor(v4 / divisor) === Math.floor(base / divisor));
  const v6 = ipv6(address);
  if (v6 === null) return false;
  // ISATAP embeds IPv4 in an interface identifier under otherwise-public prefixes.
  const interfacePrefix = (v6 >> 32n) & 0xffffffffn;
  if (interfacePrefix === 0x00005efen || interfacePrefix === 0x02005efen) return false;
  return !ipv6Ranges.some(({ base, shift }) => v6 >> shift === base >> shift);
}

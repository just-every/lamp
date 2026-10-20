/** True only for a globally routable unicast address. Private, loopback,
 * link-local, carrier-grade NAT, documentation, multicast and reserved
 * ranges (IPv4, IPv6 and IPv4 embedded in IPv6) are refused. */
export function isPublicAddress(address: string): boolean {
  const v4 = parseIpv4(address);
  if (v4) return isPublicIpv4(v4);
  const v6 = parseIpv6(address);
  return v6 ? isPublicIpv6(v6) : false;
}

export function isIpLiteral(host: string) {
  const bare = host.replace(/^\[|\]$/g, "");
  return Boolean(parseIpv4(bare) || parseIpv6(bare));
}

function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const octets = parts.map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

function isPublicIpv4([a, b, c]: number[]) {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function parseIpv6(value: string): number[] | null {
  let text = value.replace(/^\[|\]$/g, "").toLowerCase();
  if (text.includes("%") || !text.includes(":")) return null;
  const tail = text.match(/:(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const v4 = parseIpv4(tail[1]);
    if (!v4) return null;
    text = `${text.slice(0, -tail[1].length)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}

function embeddedIpv4(high: number, low: number) {
  return [high >> 8, high & 255, low >> 8, low & 255];
}

function isPublicIpv6(groups: number[]) {
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) carry an IPv4 destination.
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) return isPublicIpv4(embeddedIpv4(groups[6], groups[7]));
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((group) => group === 0)) return isPublicIpv4(embeddedIpv4(groups[6], groups[7]));
  // Only global unicast (2000::/3) is public.
  if (groups[0] < 0x2000 || groups[0] > 0x3fff) return false;
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return false; // documentation
  if (groups[0] === 0x2001 && groups[1] === 0) return false; // Teredo
  if (groups[0] === 0x2002) return isPublicIpv4(embeddedIpv4(groups[1], groups[2])); // 6to4
  return true;
}

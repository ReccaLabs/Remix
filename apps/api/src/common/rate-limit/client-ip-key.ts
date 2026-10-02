import { isIPv4, isIPv6 } from 'node:net';

/** The eight 16-bit groups of a valid IPv6 address (`::` expanded, embedded IPv4 converted). */
function expandIPv6(address: string): number[] {
  const bare = address.split('%')[0] ?? address; // drop a zone id (`fe80::1%eth0`)
  let text = bare;
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const [a = 0, b = 0, c = 0, d = 0] = tail.split('.').map(Number);
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', rest] = text.split('::');
  const first = head ? head.split(':') : [];
  const last = rest === undefined ? [] : rest ? rest.split(':') : [];
  const zeros = rest === undefined ? [] : Array<string>(8 - first.length - last.length).fill('0');
  return [...first, ...zeros, ...last].map((g) => Number.parseInt(g, 16));
}

/**
 * The address a client is rate limited as. An IPv6 subscriber gets a whole /64 (one LAN, and what
 * providers hand out per customer), so rotating through the addresses of its own prefix cannot
 * mint fresh budgets; IPv4-mapped IPv6 (`::ffff:203.0.113.7`, also in hex form) is the same
 * client as its IPv4 address. Anything that is not an IP address is returned unchanged.
 */
export function clientIpKey(address: string): string {
  if (isIPv4(address)) return address;
  if (!isIPv6(address)) return address;

  const groups = expandIPv6(address);
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = groups;
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
  }
  return `${[g0, g1, g2, g3].map((g) => g.toString(16)).join(':')}::/64`;
}

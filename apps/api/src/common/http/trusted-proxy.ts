import { BlockList, isIP } from 'node:net';

/** Named ranges accepted in `TRUST_PROXY` (same names as Express / proxy-addr). */
const NAMED_RANGES: Record<string, readonly string[]> = {
  loopback: ['127.0.0.1/8', '::1/128'],
  linklocal: ['169.254.0.0/16', 'fe80::/10'],
  uniquelocal: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7'],
};

export interface TrustedProxies {
  /** The entries as configured (for logs / diagnostics; never contains secrets). */
  readonly entries: readonly string[];
  /** True when `address` (the TCP peer) is a trusted proxy. */
  isTrusted(address: string | undefined): boolean;
}

/**
 * Parse `TRUST_PROXY` — a comma-separated list of IPs, CIDRs or the keywords `loopback`,
 * `linklocal`, `uniquelocal`. `none` (or an empty value) trusts nobody. Throws on bad input so
 * the process fails fast instead of silently trusting the wrong peers.
 */
export function parseTrustedProxies(value: string): TrustedProxies {
  const entries = value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const blockList = new BlockList();
  const expanded = entries.includes('none') ? [] : entries.flatMap((e) => NAMED_RANGES[e] ?? [e]);

  for (const entry of expanded) {
    const [address = '', prefix] = entry.split('/');
    const family = isIP(address);
    if (family === 0) throw new Error(`"${entry}" is not an IP address, CIDR or known keyword`);
    const type = family === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) {
      blockList.addAddress(address, type);
      continue;
    }
    const bits = Number(prefix);
    if (!/^\d{1,3}$/.test(prefix) || bits > (family === 4 ? 32 : 128)) {
      throw new Error(`"${entry}" has an invalid prefix length`);
    }
    blockList.addSubnet(address, bits, type);
  }

  return {
    entries,
    isTrusted(address) {
      if (!address) return false;
      const ip = unmapIPv4(address);
      const family = isIP(ip);
      if (family === 0) return false;
      return blockList.check(ip, family === 4 ? 'ipv4' : 'ipv6');
    },
  };
}

/** `::ffff:127.0.0.1` (IPv4-mapped IPv6, as Node reports dual-stack peers) → `127.0.0.1`. */
export function unmapIPv4(address: string): string {
  const match = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  return match?.[1] ?? address;
}

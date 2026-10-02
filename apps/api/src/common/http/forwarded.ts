import type { IncomingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';
import { unmapIPv4, type TrustedProxies } from './trusted-proxy';

/** DNS host name: dot-separated labels of letters, digits and inner hyphens (ASCII / punycode). */
const HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

export interface HostAndPort {
  hostname: string;
  port: number | null;
}

/**
 * Parse a `Host`-style value (`Kamal.remix.lk.:3001`) into a lower-case host name without a
 * trailing dot, plus the port. Returns null for anything that is not a plain DNS name (IP
 * literals, userinfo, paths, lists, non-ASCII, empty) — such hosts never belong to a tenant.
 */
export function parseHost(value: string | undefined | null): HostAndPort | null {
  if (!value) return null;
  const match = /^([^:]*)(?::(\d{1,5}))?$/.exec(value.trim().toLowerCase());
  if (!match) return null;
  const hostname = (match[1] ?? '').replace(/\.$/, '');
  const port = match[2] === undefined ? null : Number(match[2]);
  if (!HOSTNAME.test(hostname) || (port !== null && (port < 1 || port > 65535))) return null;
  // An all-numeric last label is an IPv4 literal (or nonsense), never a tenant host.
  if (/^\d+$/.test(hostname.slice(hostname.lastIndexOf('.') + 1))) return null;
  return { hostname, port };
}

/** Just the normalised host name of a `Host`-style value, or null (see {@link parseHost}). */
export function normaliseHost(value: string | undefined | null): string | null {
  return parseHost(value)?.hostname ?? null;
}

export interface ForwardedSource {
  headers: IncomingHttpHeaders;
  /** TCP peer address (`req.socket.remoteAddress`). */
  remoteAddress: string | undefined;
  /** True when the TCP connection itself is TLS. */
  encrypted: boolean;
}

export interface ForwardedInfo {
  /** Host name the browser asked for; null when missing, malformed or a forwarded list. */
  host: string | null;
  protocol: 'http' | 'https';
  /** `scheme://host[:port]` the browser used (default port omitted); null when host is null. */
  origin: string | null;
  /** Closest untrusted address in the chain — the real client as far as we can tell. */
  clientIp: string | null;
  /** True when the TCP peer is a trusted proxy (its forwarding headers were believed). */
  viaTrustedProxy: boolean;
}

/**
 * Derive host, scheme, origin and client IP for a request (ADR 0003). `X-Forwarded-Host`,
 * `-Proto` and `-For` are honoured **only** when the TCP peer is in `TRUST_PROXY`; from anyone
 * else all three are ignored, so a client talking to the API directly can't choose its tenant,
 * fake its scheme or spoof its IP. A forwarded host containing a comma (a list) is rejected —
 * the edge proxy overwrites the header, so a list means someone tried to smuggle a value.
 */
export function resolveForwarded(source: ForwardedSource, trust: TrustedProxies): ForwardedInfo {
  const peer = source.remoteAddress ? unmapIPv4(source.remoteAddress) : undefined;
  const ownProtocol = source.encrypted ? 'https' : 'http';
  const trusted = trust.isTrusted(peer);

  let hostValue = source.headers.host;
  let protocol: 'http' | 'https' = ownProtocol;
  let clientIp = peer ?? null;

  if (trusted) {
    const fwdHost = single(source.headers['x-forwarded-host']);
    if (fwdHost !== undefined) hostValue = fwdHost.includes(',') ? undefined : fwdHost;
    const fwdProto = single(source.headers['x-forwarded-proto'])?.trim().toLowerCase();
    if (fwdProto === 'http' || fwdProto === 'https') protocol = fwdProto;
    clientIp = clientIpFromChain(peer, headerList(source.headers['x-forwarded-for']), trust);
  }

  const parsed = parseHost(hostValue);
  return {
    host: parsed?.hostname ?? null,
    protocol,
    origin: parsed ? originOf(protocol, parsed) : null,
    clientIp,
    viaTrustedProxy: trusted,
  };
}

function originOf(protocol: 'http' | 'https', { hostname, port }: HostAndPort): string {
  const defaultPort = protocol === 'https' ? 443 : 80;
  return `${protocol}://${hostname}${port === null || port === defaultPort ? '' : `:${port}`}`;
}

/**
 * Walk `X-Forwarded-For` from the right (closest hop first), skipping trusted proxies; the first
 * untrusted address is the client. Same algorithm as Express / proxy-addr.
 */
export function clientIpFromChain(
  peer: string | undefined,
  forwardedFor: readonly string[],
  trust: TrustedProxies,
): string | null {
  const chain = [peer, ...[...forwardedFor].reverse()];
  let candidate: string | null = null;
  for (const raw of chain) {
    const address = raw ? unmapIPv4(raw) : undefined;
    if (!address || isIP(address) === 0) return candidate;
    candidate = address;
    if (!trust.isTrusted(address)) return address;
  }
  return candidate;
}

/** Headers Node joins with `, ` arrive as a string; guard against the array form anyway. */
function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(',') : value;
}

function headerList(value: string | string[] | undefined): string[] {
  const joined = single(value);
  if (joined === undefined) return [];
  return joined
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

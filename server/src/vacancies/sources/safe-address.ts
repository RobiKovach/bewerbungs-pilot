import dns from 'node:dns';
import net from 'node:net';

/** [first address, prefix length] — IPv4 ranges a pasted link must never reach (spec, section 6a). */
const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);
}

function isPublicV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return !BLOCKED_V4.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    const start = v4ToInt(base);
    return n >= start && n < start + size;
  });
}

/** The eight 16-bit groups of an IPv6 address (a dotted IPv4 tail is folded into the last two). */
function v6Groups(ip: string): number[] {
  let s = ip.toLowerCase().split('%')[0];
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (tail) {
    const n = v4ToInt(tail[1]);
    s = s.slice(0, -tail[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, rest] = s.split('::') as [string, string | undefined];
  const parse = (p: string) => (p ? p.split(':').map((g) => parseInt(g, 16)) : []);
  const a = parse(head);
  const b = parse(rest ?? '');
  return rest === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill(0), ...b];
}

const v4From = (hi: number, lo: number) => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');

function isPublicV6(ip: string): boolean {
  const g = v6Groups(ip);
  if (g.length !== 8 || g.some((x) => Number.isNaN(x))) return false;
  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d): judged by the IPv4 address inside.
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isPublicV4(v4From(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPublicV4(v4From(g[6], g[7]));
  // 6to4 (2002::/16) carries an IPv4 address in groups 1–2.
  if (g[0] === 0x2002) return isPublicV4(v4From(g[1], g[2]));
  // Only global unicast (2000::/3) is public; that excludes ::, ::1, fe80::/10, fc00::/7, ff00::/8 and the rest.
  if ((g[0] & 0xe000) !== 0x2000) return false;
  // Documentation (2001:db8::/32) and Teredo (2001::/32, tunnels to anywhere).
  if (g[0] === 0x2001 && (g[1] === 0x0db8 || g[1] === 0)) return false;
  return true;
}

/** True only for an address on the public internet — never loopback, private, link-local, CGNAT, multicast, reserved. */
export function isPublicAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isPublicV4(ip);
  if (net.isIPv6(ip)) return isPublicV6(ip);
  return false;
}

export type UrlCheck = { ok: true } | { ok: false; why: 'scheme' | 'port' | 'credentials' | 'host' | 'private' | 'dns' };
export type Lookup = (host: string) => Promise<string[]>;

const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);
const defaultLookup: Lookup = async (host) => (await dns.promises.lookup(host, { all: true })).map((a) => a.address);

/**
 * May the app's browser fetch this URL? Only http(s) on a usual port, no credentials, a dotted public name
 * (not localhost / *.local), and every address the name resolves to must be public (spec, section 6a).
 */
export async function checkPublicUrl(url: string, lookup: Lookup = defaultLookup): Promise<UrlCheck> {
  let u: URL;
  try { u = new URL(url); } catch { return { ok: false, why: 'scheme' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, why: 'scheme' };
  if (u.username || u.password) return { ok: false, why: 'credentials' };
  if (!ALLOWED_PORTS.has(u.port)) return { ok: false, why: 'port' };
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (net.isIP(host)) return isPublicAddress(host) ? { ok: true } : { ok: false, why: 'private' };
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return { ok: false, why: 'host' };
  let addresses: string[];
  try { addresses = await lookup(host); } catch { return { ok: false, why: 'dns' }; }
  if (addresses.length === 0) return { ok: false, why: 'dns' };
  return addresses.every(isPublicAddress) ? { ok: true } : { ok: false, why: 'private' };
}

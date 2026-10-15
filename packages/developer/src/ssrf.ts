import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Resolves a hostname to all of its addresses (injectable for tests). */
export type HostResolver = (hostname: string) => Promise<string[]>;

export const defaultResolver: HostResolver = async (hostname) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

const V4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata (169.254.169.254)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

function isPrivateV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true;
  return V4_BLOCKED.some(([base, bits]) => {
    const b = ipv4ToInt(base)!;
    const size = 2 ** (32 - bits);
    return n >= b && n < b + size;
  });
}

/** Expands an IPv6 address to 8 16-bit groups (handles `::` and a trailing dotted IPv4). */
function expandV6(ip: string): number[] | null {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf("%");
  if (zone >= 0) addr = addr.slice(0, zone);
  const lastColon = addr.lastIndexOf(":");
  const maybeV4 = addr.slice(lastColon + 1);
  if (maybeV4.includes(".")) {
    const n = ipv4ToInt(maybeV4);
    if (n === null) return null;
    addr = `${addr.slice(0, lastColon + 1)}${Math.floor(n / 65536).toString(16)}:${(n % 65536).toString(16)}`;
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string) => (s === "" ? [] : s.split(":").map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)));
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  if ([...head, ...rest].some((g) => Number.isNaN(g))) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - rest.length;
  if (fill < 1) return null;
  return [...head, ...new Array<number>(fill).fill(0), ...rest];
}

function isPrivateV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true;
  const allZeroUpTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (allZeroUpTo(8)) return true; // ::
  if (allZeroUpTo(7) && g[7] === 1) return true; // ::1
  const embeddedV4 = () => `${g[6]! >> 8}.${g[6]! & 255}.${g[7]! >> 8}.${g[7]! & 255}`;
  if (allZeroUpTo(5) && g[5] === 0xffff) return isPrivateV4(embeddedV4()); // ::ffff:a.b.c.d
  if (allZeroUpTo(6)) return true; // deprecated IPv4-compatible
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateV4(embeddedV4()); // NAT64
  const first = g[0]!;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (first === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (first === 0x2002) return isPrivateV4(`${g[1]! >> 8}.${g[1]! & 255}.${g[2]! >> 8}.${g[2]! & 255}`); // 6to4
  return false;
}

/** True for loopback, private, link-local, CGNAT, multicast, reserved and unparseable addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) return isPrivateV6(ip);
  return true;
}

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"];

export interface UrlPolicy {
  /** Allow `http:` (development only). */
  allowHttp: boolean;
  /** Allow localhost and private/reserved addresses (development only). */
  allowPrivate: boolean;
  resolve?: HostResolver;
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/**
 * Decides whether a webhook URL may be called. In production: https only, no credentials in the URL, no
 * localhost/internal names, and every address the hostname resolves to must be public (SSRF guard). Run it when the
 * endpoint is saved and again before every delivery (DNS can change).
 */
export async function checkWebhookUrl(raw: string, policy: UrlPolicy): Promise<UrlCheck> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Enter a full URL starting with https://" };
  }
  if (url.protocol !== "https:" && !(policy.allowHttp && url.protocol === "http:"))
    return { ok: false, reason: policy.allowHttp ? "Use an http:// or https:// URL" : "Webhook URLs must use https://" };
  if (url.username || url.password) return { ok: false, reason: "Don't put a username or password in the URL" };
  if (url.port && !policy.allowPrivate && !["443", "8443", "80", "8080"].includes(url.port))
    return { ok: false, reason: "Use the standard port (443) or 8443" };
  if (policy.allowPrivate) return { ok: true, url };

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s)) || !host.includes(".") && isIP(host) === 0)
    return { ok: false, reason: "Webhook URLs must point to a public internet address" };
  if (isIP(host)) return isPrivateAddress(host) ? { ok: false, reason: "Webhook URLs can't point to private or local addresses" } : { ok: true, url };

  let addresses: string[];
  try {
    addresses = await (policy.resolve ?? defaultResolver)(host);
  } catch {
    return { ok: false, reason: `Couldn't find the server ${host}` };
  }
  if (addresses.length === 0) return { ok: false, reason: `Couldn't find the server ${host}` };
  if (addresses.some(isPrivateAddress)) return { ok: false, reason: "Webhook URLs can't point to private or local addresses" };
  return { ok: true, url };
}

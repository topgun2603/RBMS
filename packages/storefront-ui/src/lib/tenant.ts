/**
 * Which shop a request is for, from its host. Pure (shared by the server pages, the API proxy and tests).
 *
 * - `<slug>.<root>` (anbu.localhost:3003, anbu.srikit.in) → the shop slug, sent to the API as `x-tenant`.
 * - Any other host (a shop's verified custom domain, e.g. www.anbufashions.in) → no slug; the original host is sent as
 *   `x-forwarded-host`. The API runs Fastify with `trustProxy`, so `req.hostname` becomes that host and the tenancy hook
 *   resolves the verified custom domain — no API change needed.
 */

export const ROOT_DOMAIN = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost").toLowerCase().replace(/^\.+|\.+$/g, "");

/** Server-side API origin (falls back to the public one). */
export const API_ORIGIN = (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");

/** Browser-facing API origin, used to absolutise upload URLs the API returns as paths. */
export const PUBLIC_API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const RESERVED = new Set(["www", "api", "app", "admin", "store", "stores"]);

/** "Anbu.LocalHost:3003" → "anbu.localhost". */
export function hostName(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

/** The shop slug for `<slug>.<root>`, else null. Dev: `DEFAULT_TENANT` (or `NEXT_PUBLIC_DEFAULT_TENANT`) on the bare root. */
export function tenantFromHost(host: string | null | undefined, root = ROOT_DOMAIN): string | null {
  const name = hostName(host);
  if (!name) return null;
  if (name.endsWith(`.${root}`)) {
    const label = name.slice(0, -(root.length + 1));
    if (!label.includes(".") && SLUG_RE.test(label) && !RESERVED.has(label)) return label;
    return null;
  }
  if (name === root || name === "127.0.0.1") return process.env.DEFAULT_TENANT || process.env.NEXT_PUBLIC_DEFAULT_TENANT || null;
  return null;
}

/** Headers that make the API resolve the same shop as the incoming request. */
export function upstreamTenantHeaders(host: string | null | undefined): Record<string, string> {
  const slug = tenantFromHost(host);
  const out: Record<string, string> = {};
  if (slug) out["x-tenant"] = slug;
  else if (host) out["x-forwarded-host"] = host;
  return out;
}

/** True when the host is a platform host without a shop (bare root) — the API would answer 404 for the store. */
export function isCustomDomain(host: string | null | undefined, root = ROOT_DOMAIN): boolean {
  const name = hostName(host);
  return !!name && name !== root && !name.endsWith(`.${root}`) && name !== "127.0.0.1";
}

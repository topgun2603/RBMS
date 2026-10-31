import { API_ORIGIN } from "@/lib/site";

/**
 * Same-origin API proxy for the browser: `/api/v1/*` → `${API}/v1/*` (pattern from the storefront proxy, copied).
 * Only the public sign-up surface is reachable from the marketing site.
 */
export const dynamic = "force-dynamic";

const PASS_REQUEST = ["accept", "accept-language", "authorization", "content-type", "user-agent", "referer", "x-tenant", "x-auth-audience"];
const PASS_RESPONSE = ["content-type", "cache-control", "retry-after"];
const ALLOWED = /^\/v1\/(plans|auth\/(otp\/(request|verify)|demo|firebase|config|me|logout|handoff|store\/(context|handoff))|tenancy\/(slug-available|mine)|signup)(\/|$)/;

/** Pure: may the browser reach this API path through the proxy? */
function allowed(path: string, method: string): boolean {
  if (!ALLOWED.test(path)) return false;
  // Plans are read-only from here; the handoff redeem belongs to the shop apps.
  if (path.startsWith("/v1/plans") && method !== "GET") return false;
  if (path.startsWith("/v1/auth/handoff/")) return false;
  return true;
}

/** Load balancers in front of this app (`TRUST_PROXY_HOPS`, default 1), like the API's setting of the same name. */
const PROXY_HOPS = (() => {
  const n = Number(process.env.TRUST_PROXY_HOPS ?? 1);
  return Number.isInteger(n) && n >= 1 && n <= 10 ? n : 1;
})();

/** The X-Forwarded-For entry `hops` from the right (what the nearest trusted proxy saw); never a client-written one. */
function forwardedClientIp(header: string | null, hops: number): string | null {
  const parts = (header ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ip = parts.length >= hops ? parts[parts.length - hops] : undefined;
  return ip && /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : null;
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "");
  const method = req.method.toUpperCase();
  if (!allowed(path, method)) return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });

  const headers = new Headers();
  for (const k of PASS_REQUEST) {
    const v = req.headers.get(k);
    if (v) headers.set(k, v);
  }
  // Only the visitor's real address goes on (one entry): anything further left in the header was written by the client.
  const client = forwardedClientIp(req.headers.get("x-forwarded-for"), PROXY_HOPS);
  if (client) headers.set("x-forwarded-for", client);

  const body = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();
  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}${path}${url.search}`, { method, headers, body, cache: "no-store", redirect: "manual", signal: req.signal });
  } catch {
    return Response.json({ error: { code: "network_error", message: "API unreachable" } }, { status: 502 });
  }
  const out = new Headers();
  for (const k of PASS_RESPONSE) {
    const v = res.headers.get(k);
    if (v) out.set(k, v);
  }
  out.set("cache-control", "no-store");
  return new Response(res.status === 204 ? null : await res.arrayBuffer(), { status: res.status, headers: out });
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };

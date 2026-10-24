import { API_ORIGIN } from "@/lib/site";

/**
 * Same-origin API proxy for the browser: `/api/v1/*` → `${API}/v1/*` (pattern from the storefront proxy, copied).
 * Only the public sign-up surface is reachable from the marketing site.
 */
export const dynamic = "force-dynamic";

const PASS_REQUEST = ["accept", "accept-language", "authorization", "content-type", "user-agent", "referer"];
const PASS_RESPONSE = ["content-type", "cache-control", "retry-after"];
const ALLOWED = /^\/v1\/(plans|auth\/(otp\/(request|verify)|firebase|config|me|logout|handoff|store\/(context|handoff))|tenancy\/(slug-available|mine)|signup)(\/|$)/;

/** Pure: may the browser reach this API path through the proxy? */
function allowed(path: string, method: string): boolean {
  if (!ALLOWED.test(path)) return false;
  // Plans are read-only from here; the handoff redeem belongs to the shop apps.
  if (path.startsWith("/v1/plans") && method !== "GET") return false;
  if (path.startsWith("/v1/auth/handoff/")) return false;
  return true;
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
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) headers.set("x-forwarded-for", fwd);

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

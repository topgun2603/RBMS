import { API_ORIGIN, upstreamTenantHeaders } from "../lib/tenant";

/**
 * Same-origin API proxy for the browser: `/api/v1/*` on the store host → `${API}/v1/*` with the shop resolved from the
 * store host (x-tenant for subdomains, x-forwarded-host for custom domains). Keeps the store working on custom domains
 * without CORS entries, and lets the shopper's IP / user agent reach analytics + rate limits.
 *
 * Mount in the app as `app/api/v1/[...path]/route.ts`:
 *   export { proxyHandler as GET, proxyHandler as POST, proxyHandler as PUT, proxyHandler as PATCH, proxyHandler as DELETE } from "@srirealtime/storefront-ui";
 */
const PASS_REQUEST = ["accept", "accept-language", "authorization", "content-type", "user-agent", "referer", "origin"];
const PASS_RESPONSE = ["content-type", "cache-control", "retry-after", "content-disposition", "location"];
/** Only these API areas are reachable from the store (no staff/admin surfaces through the shop's domain). */
const ALLOWED = /^\/v1\/(store|catalog\/public|cms\/public|reviews\/public|delivery\/public|inventory\/public|analytics\/public|payments\/(checkout|verify|mock\/complete)|auth\/(otp|me|logout)|branding)(\/|$|\?)/;

export async function proxyHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "");
  if (!ALLOWED.test(path)) return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const headers = new Headers(upstreamTenantHeaders(host));
  for (const k of PASS_REQUEST) {
    const v = req.headers.get(k);
    if (v) headers.set(k, v);
  }
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) headers.set("x-forwarded-for", fwd);
  if (!headers.has("x-forwarded-host")) headers.set("x-forwarded-host", host);

  const method = req.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();
  let res: Response;
  try {
    res = await fetch(`${API_ORIGIN}${path}${url.search}`, { method, headers, body, cache: "no-store", redirect: "manual" });
  } catch {
    return Response.json({ error: { code: "network_error", message: "Store API unreachable" } }, { status: 502 });
  }
  const out = new Headers();
  for (const k of PASS_RESPONSE) {
    const v = res.headers.get(k);
    if (v) out.set(k, v);
  }
  out.set("cache-control", res.headers.get("cache-control") ?? "no-store");
  return new Response(res.status === 204 ? null : await res.arrayBuffer(), { status: res.status, headers: out });
}

/** `app/sitemap.xml/route.ts` and `app/robots.txt/route.ts`: the API's SEO files for the shop on this host. */
export function seoFileHandler(file: "sitemap.xml" | "robots.txt") {
  return async (req: Request): Promise<Response> => {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
    const headers = new Headers(upstreamTenantHeaders(host));
    if (!headers.has("x-forwarded-host")) headers.set("x-forwarded-host", host);
    try {
      const res = await fetch(`${API_ORIGIN}/v1/cms/public/seo/${file}`, { headers, next: { revalidate: 600 } });
      if (!res.ok) {
        if (file === "robots.txt") return new Response("User-agent: *\nDisallow: /\n", { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
        return new Response("Not found", { status: 404 });
      }
      return new Response(await res.text(), {
        status: 200,
        headers: {
          "content-type": file === "robots.txt" ? "text/plain; charset=utf-8" : "application/xml; charset=utf-8",
          "cache-control": "public, max-age=600",
        },
      });
    } catch {
      return new Response("Unavailable", { status: 503 });
    }
  };
}

/**
 * `app/favicon.svg/route.ts` (and /favicon.ico): the shop's initial on its brand colour, for shops without an
 * uploaded favicon. Branding favicons win in the root metadata.
 */
export async function faviconHandler(req: Request): Promise<Response> {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const headers = new Headers(upstreamTenantHeaders(host));
  let name = "S";
  let color = "#7c3aed";
  try {
    const res = await fetch(`${API_ORIGIN}/v1/branding`, { headers, next: { revalidate: 600 } });
    if (res.ok) {
      const b = (await res.json()) as { appName?: string; tokens?: { colors?: { primary?: string } } };
      name = b.appName?.trim() || name;
      const c = b.tokens?.colors?.primary;
      if (c && /^#[0-9a-f]{3,8}$/i.test(c)) color = c;
    }
  } catch {
    /* default icon */
  }
  const letter = (Array.from(name)[0] ?? "S").toUpperCase().replace(/[<&>"']/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${color}"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="system-ui,Segoe UI,Arial,sans-serif" font-size="38" font-weight="700" fill="#fff">${letter}</text></svg>`;
  return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=3600" } });
}

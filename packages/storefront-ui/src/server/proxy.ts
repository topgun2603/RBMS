import { API_ORIGIN, tenantFromHost, upstreamTenantHeaders } from "../lib/tenant";
import { cacheTags } from "../lib/cache-tags";

/**
 * Same-origin API proxy for the browser: `/api/v1/*` on the store host → `${API}/v1/*` with the shop resolved from the
 * store host (x-tenant for subdomains, x-forwarded-host for custom domains). Keeps the store working on custom domains
 * without CORS entries, and lets the shopper's IP / user agent reach analytics + rate limits.
 *
 * Mount in the app as `app/api/v1/[...path]/route.ts`:
 *   export { proxyHandler as GET, proxyHandler as POST, proxyHandler as PUT, proxyHandler as PATCH, proxyHandler as DELETE } from "@rbms/storefront-ui";
 */
const PASS_REQUEST = ["accept", "accept-language", "authorization", "content-type", "user-agent", "referer", "origin", "x-guest-token", "last-event-id"];
const PASS_RESPONSE = ["content-type", "cache-control", "retry-after", "content-disposition", "location"];
/**
 * Only these API areas are reachable from the store (no staff/admin surfaces through the shop's domain). Batch 4 adds
 * shopper chat (every /chat route is scoped to the signed-in viewer by the chat service), the public help desk + FAQ,
 * the shopper's own loyalty (`/loyalty/me`, `/loyalty/quote`), public seller pages and cards, guest OTP verification,
 * the read-only feature list (`GET /features` itself — never the toggles or registry), and the restaurant QR table menu
 * (`/dining/public/*`: a table by its QR code, the menu, guests' orders), online booking (`/bookings/public/*`) and job
 * tracking (`/jobcards/public/*`), and website enquiry forms (`POST /enquiries/public`).
 */
const ALLOWED =
  /^\/v1\/(store|catalog\/public|cms\/public|reviews\/public|delivery\/public|inventory\/public|analytics\/public|payments\/(checkout|verify|mock\/complete)|auth\/(otp|me|logout|guest|config|handoff\/redeem)|branding|chat|support\/public|loyalty\/(me|quote)|marketplace\/public\/(vendors\/(?!apply(\/|$))[^/]+|sellers)|dining\/public|bookings\/public|jobcards\/public|serials\/public|enquiries\/public|features(?=$))(\/|$|\?)/;

/**
 * "Try it on" (docs/ai.md "Phase 4 part C"), read-only: the product's try-on setup, and the shop's own public image files so the
 * browser can draw them on a canvas without a cross-origin taint (works on custom domains with no CORS entries).
 */
const TRYON_READS = [/^\/v1\/ai\/imaging\/public\/tryon\/[0-9a-f-]{36}$/, /^\/v1\/uploads\/files\/t\/[0-9a-f-]{36}\/(?!.*\.\.)[\w./%+-]+$/];

/** Pure: may the browser reach this API path (`/v1/...`, without the query) through the store proxy? */
/** Shopper chat (docs/ai.md "Phase 4 part B"): whether the AI mode is offered (GET) and one question (POST); nothing else under /v1/ai. */
const AI_CHAT = [
  { re: /^\/v1\/ai\/store\/public\/chat\/status$/, methods: ["GET"] },
  { re: /^\/v1\/ai\/store\/public\/chat$/, methods: ["POST"] },
  { re: /^\/v1\/ai\/store\/public\/together$/, methods: ["GET"] },
];

/**
 * Data privacy (DPDP, docs/privacy-dpdp.md): the shop's privacy notice (public), recording a consent decision, and the shopper's own rights
 * requests. The staff routes of the same module (the request queue, retention, breaches) are not reachable from the store.
 */
const PRIVACY_STORE = [
  { re: /^\/v1\/consent\/notice$/, methods: ["GET"] },
  { re: /^\/v1\/consent$/, methods: ["POST"] },
  { re: /^\/v1\/consent\/me$/, methods: ["GET"] },
  { re: /^\/v1\/consent\/rights$/, methods: ["POST"] },
  { re: /^\/v1\/consent\/rights\/mine$/, methods: ["GET"] },
  { re: /^\/v1\/consent\/rights\/mine\/[0-9a-f-]{36}\/(cancel|data)$/, methods: ["GET", "POST"] },
];

export function isProxyAllowed(path: string, method = "GET"): boolean {
  const privacy = PRIVACY_STORE.find((r) => r.re.test(path));
  if (privacy) return privacy.methods.includes(method.toUpperCase());
  const aiChat = AI_CHAT.find((r) => r.re.test(path));
  if (aiChat) return aiChat.methods.includes(method.toUpperCase());
  if (TRYON_READS.some((r) => r.test(path))) return ["GET", "HEAD"].includes(method.toUpperCase());
  if (!ALLOWED.test(path)) return false;
  // The feature list and the seller pages/cards are read-only.
  if ((path === "/v1/features" || path.startsWith("/v1/marketplace/")) && method.toUpperCase() !== "GET") return false;
  return true;
}

/**
 * How many times a request is retried when the API can't be reached (connection refused / reset: the API restarting
 * or a pooled connection closed under load). Reads (GET / HEAD: availability, cards, search) twice; writes never, since
 * the API may already have done them (a failed analytics beacon is answered 204 instead, see proxyHandler).
 */
export function proxyRetries(method: string): number {
  const m = method.toUpperCase();
  return m === "GET" || m === "HEAD" ? 2 : 0;
}

async function fetchWithRetry(input: string, init: RequestInit, retries: number): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(input, init);
    } catch (err) {
      if (attempt >= retries || init.signal?.aborted) throw err;
      await new Promise((r) => setTimeout(r, 150 * (attempt + 1)));
    }
  }
}

export async function proxyHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "");
  if (!isProxyAllowed(path, req.method)) return Response.json({ error: { code: "not_found", message: "Not found" } }, { status: 404 });

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const headers = new Headers(upstreamTenantHeaders(host));
  for (const k of PASS_REQUEST) {
    const v = req.headers.get(k);
    if (v) headers.set(k, v);
  }
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) headers.set("x-forwarded-for", fwd);
  if (!headers.has("x-forwarded-host")) headers.set("x-forwarded-host", host);
  // Everything arriving through the shop domain is a shopper: the shop's customer sign-in options apply (never passed from the browser).
  headers.set("x-auth-audience", "customer");

  const method = req.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer();
  let res: Response;
  try {
    res = await fetchWithRetry(`${API_ORIGIN}${path}${url.search}`, { method, headers, body, cache: "no-store", redirect: "manual", signal: req.signal }, proxyRetries(method));
  } catch {
    // Page-view / event beacons are best effort: a busy or restarting API never shows up as a failed request.
    if (path.startsWith("/v1/analytics/public/")) return new Response(null, { status: 204 });
    return Response.json({ error: { code: "network_error", message: "Store API unreachable" } }, { status: 502 });
  }
  const out = new Headers();
  for (const k of PASS_RESPONSE) {
    const v = res.headers.get(k);
    if (v) out.set(k, v);
  }
  // Server-Sent Events (chat): stream the body through unbuffered; aborting the browser request aborts the upstream.
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream") && res.body) {
    out.set("cache-control", "no-cache, no-transform");
    out.set("x-accel-buffering", "no");
    return new Response(res.body, { status: res.status, headers: out });
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
      const res = await fetch(`${API_ORIGIN}/v1/cms/public/seo/${file}`, { headers, next: { revalidate: 600, tags: cacheTags(tenantFromHost(host) ?? host, "/cms/public/seo") } });
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
    const res = await fetch(`${API_ORIGIN}/v1/branding`, { headers, next: { revalidate: 600, tags: cacheTags(tenantFromHost(host) ?? host, "/branding") } });
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

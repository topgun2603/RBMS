import type { FastifyReply, FastifyRequest } from "fastify";

/*
 * On-demand store revalidation. The online store (apps/store) caches each shop's data in Next's data cache with tags
 * per shop and resource (storefront-ui lib/cache-tags). After a staff write that shoppers can see — publishing the
 * home page, saving branding/theme, products, categories, collections, stock, menus, pages, posts, offers, store
 * settings — this asks the store to drop those tags (`POST <store>/api/revalidate`), so the next page view is fresh.
 *
 * Wired as one host `onResponse` hook (next to the audit log): it looks at the route of every successful mutating
 * request, so no module needs to know about the store. Fire-and-forget with a short timeout; calls for one shop within
 * a short window are merged. The store's time-based revalidate stays as the fallback.
 *
 * Config (read here so env.ts stays untouched): STORE_REVALIDATE_URL (default http://127.0.0.1:3003/api/revalidate
 * outside production; unset in production = off) and STORE_REVALIDATE_SECRET (shared with the store; outside
 * production both apps default to the same dev secret).
 */

/** Mirrors storefront-ui STORE_CACHE_RESOURCES. */
export type StoreResource = "home" | "menus" | "pages" | "posts" | "seo" | "branding" | "config" | "features" | "catalog" | "offers" | "reviews" | "bookings";

const DEV_SECRET = "dev-store-revalidate-secret";
const DEV_URL = "http://127.0.0.1:3003/api/revalidate";

type Rule = [RegExp, StoreResource[] | ((params: Record<string, string>) => StoreResource[])];

/** Route (Fastify pattern, e.g. "/v1/cms/pages/:id") → store data it changes. First match wins; [] = nothing public. */
const RULES: Rule[] = [
  [/^\/v1\/cms\/home\/publish$/, ["home"]],
  [/^\/v1\/cms\/home(\/|$)/, []], // the draft: not public until published
  [/^\/v1\/cms\/menus(\/|$)/, ["menus"]],
  [/^\/v1\/cms\/pages(\/|$)/, ["pages", "seo"]],
  [/^\/v1\/cms\/posts(\/|$)/, ["posts", "seo"]],
  [/^\/v1\/cms\/(preview|public)(\/|$)/, []],
  [/^\/v1\/cms\//, ["seo"]],
  [/^\/v1\/branding\/preview$/, []],
  [/^\/v1\/branding(\/|$)/, ["branding", "config"]],
  [/^\/v1\/(catalog|importexport)\/(public)(\/|$)/, []],
  // Products, variants, categories, collections, media: listings, product pages, bundles (names / prices), sitemap,
  // and the booking page (service names and prices come from the catalogue).
  [/^\/v1\/catalog(\/|$)/, ["catalog", "offers", "seo", "bookings"]],
  // Studio assistant: applying or undoing a change can restyle the store, its home, menus, pages, settings and features.
  [/^\/v1\/ai\/studio\/changes\/:id\/(apply|undo)$/, ["home", "menus", "pages", "seo", "branding", "config", "features"]],
  // Approving, rejecting, editing or re-drafting a Tamil product translation changes the Tamil product text the store shows.
  [/^\/v1\/ai\/assist\/translat(e$|ions(\/|$))/, ["catalog", "offers", "seo", "bookings"]],
  // Approving AI photo tags writes tags and attributes to a product, which the store searches and filters on.
  [/^\/v1\/ai\/trade\/product-tags(\/|$)/, ["catalog", "seo"]],
  [/^\/v1\/importexport(\/|$)/, ["catalog", "offers", "seo", "bookings"]],
  [/^\/v1\/inventory\/public(\/|$)/, []],
  [/^\/v1\/inventory(\/|$)/, ["catalog"]],
  [/^\/v1\/coupons\/offers\/preview$/, []],
  [/^\/v1\/coupons\/offers(\/|$)/, ["offers"]],
  [/^\/v1\/settings\/:namespace\/tenant$/, (p) => (p.namespace === "store" ? ["config"] : [])],
  // Switches also decide what product pages offer (e.g. online booking → "Book now" vs "Enquire").
  [/^\/v1\/features(\/|$)/, ["features", "config", "catalog", "bookings"]],
  // Booking page (/book): services and staff; product pages say which items are bookable (catalog). Hours, time off and
  // appointments only change the free slots, which the page fetches live.
  [/^\/v1\/bookings\/public(\/|$)/, []],
  [/^\/v1\/bookings\/(services|staff)(\/|$)/, ["bookings", "catalog"]],
  [/^\/v1\/reviews\/public(\/|$)/, []],
  [/^\/v1\/reviews(\/|$)/, ["reviews"]],
];

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** The store resources a successful request changes (empty = none). */
export function storeResourcesFor(method: string, routeUrl: string | undefined, params: Record<string, string> = {}): StoreResource[] {
  if (!routeUrl || !MUTATING.has(method.toUpperCase())) return [];
  for (const [re, out] of RULES) if (re.test(routeUrl)) return typeof out === "function" ? out(params) : out;
  return [];
}

export interface StoreRevalidateConfig {
  url: string | null;
  secret: string | null;
}

export function storeRevalidateConfig(env: Record<string, string | undefined> = process.env): StoreRevalidateConfig {
  const prod = env.NODE_ENV === "production";
  const url = env.STORE_REVALIDATE_URL?.trim() || (prod ? null : DEV_URL);
  const secret = env.STORE_REVALIDATE_SECRET?.trim() || (prod ? null : DEV_SECRET);
  return { url: url && url !== "off" ? url : null, secret };
}

interface Log {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  debug?(obj: unknown, msg?: string): void;
}

export interface StoreRevalidatorDeps {
  config: StoreRevalidateConfig;
  /** The shop's verified custom domains (the store keys custom-domain hosts by domain). */
  domains: (tenantId: string) => Promise<string[]>;
  log: Log;
  fetch?: typeof fetch;
  /** Merge window per shop (ms). */
  debounceMs?: number;
  timeoutMs?: number;
}

export function createStoreRevalidator(deps: StoreRevalidatorDeps) {
  const { config, log } = deps;
  const doFetch = deps.fetch ?? fetch;
  const debounceMs = deps.debounceMs ?? 150;
  const timeoutMs = deps.timeoutMs ?? 2_500;
  const pending = new Map<string, { slug: string; resources: Set<StoreResource>; timer: ReturnType<typeof setTimeout> }>();
  let warned = false;

  const send = async (tenantId: string, slug: string, resources: StoreResource[]): Promise<void> => {
    if (!config.url || !config.secret) return;
    const keys = [slug, ...(await deps.domains(tenantId).catch(() => [] as string[]))].filter(Boolean);
    if (!keys.length) return;
    const started = Date.now();
    try {
      const res = await doFetch(config.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-revalidate-secret": config.secret },
        body: JSON.stringify({ keys, resources }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) log.info({ tenantId, keys, resources, ms: Date.now() - started }, "store revalidated");
      else log.warn({ tenantId, status: res.status, resources }, "store revalidate refused");
    } catch (err) {
      // The store may simply not be running (dev) — its time-based revalidate still applies.
      log.warn({ tenantId, resources, err: err instanceof Error ? err.message : String(err) }, "store revalidate failed");
    }
  };

  /** Queues a refresh of `resources` for the shop (merged with others within the debounce window). */
  const notify = (tenantId: string, slug: string, resources: readonly StoreResource[]): void => {
    if (!resources.length) return;
    if (!config.url || !config.secret) {
      if (!warned) log.info({}, "store revalidate off (STORE_REVALIDATE_URL / STORE_REVALIDATE_SECRET unset)");
      warned = true;
      return;
    }
    const cur = pending.get(tenantId);
    if (cur) {
      resources.forEach((r) => cur.resources.add(r));
      return;
    }
    const entry = {
      slug,
      resources: new Set(resources),
      timer: setTimeout(() => {
        pending.delete(tenantId);
        void send(tenantId, entry.slug, [...entry.resources]);
      }, debounceMs),
    };
    entry.timer.unref?.();
    pending.set(tenantId, entry);
  };

  /** Host onResponse hook: successful mutating requests of a shop → the store data they change. Never throws. */
  const onResponse = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    try {
      if (reply.statusCode < 200 || reply.statusCode >= 300) return;
      const tenant = (req as { ctx?: { tenant?: { id: string; slug: string } | null } }).ctx?.tenant;
      if (!tenant?.id || !tenant.slug) return;
      const resources = storeResourcesFor(req.method, req.routeOptions?.url, (req.params ?? {}) as Record<string, string>);
      notify(tenant.id, tenant.slug, resources);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "store revalidate hook failed");
    }
  };

  /** Waits for queued calls (tests, shutdown). */
  const flush = async (): Promise<void> => {
    const all = [...pending.entries()];
    pending.clear();
    await Promise.all(
      all.map(([tenantId, e]) => {
        clearTimeout(e.timer);
        return send(tenantId, e.slug, [...e.resources]);
      }),
    );
  };

  return { notify, onResponse, flush };
}

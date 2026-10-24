/*
 * Next data-cache tags for the store's server fetches, so the API can refresh one shop's cached data right after staff
 * change it (on-demand revalidation, server/revalidate.ts) instead of waiting for the time-based `revalidate`.
 *
 * Every cached fetch carries two tags: `store:<key>` (the whole shop) and `store:<key>:<resource>` (one kind of data).
 * `<key>` is what the store knows about the shop before any fetch: its subdomain slug, or the custom-domain host.
 * Pure (no Next imports): the API mirrors RESOURCES when it asks for a refresh.
 */

/** The kinds of shop data the store caches (the API names these when it asks for a refresh). */
export const STORE_CACHE_RESOURCES = ["home", "menus", "pages", "posts", "seo", "branding", "config", "features", "catalog", "offers", "reviews", "bookings", "other"] as const;
export type StoreCacheResource = (typeof STORE_CACHE_RESOURCES)[number];

const KNOWN = new Set<string>(STORE_CACHE_RESOURCES);

/** Which resource an API path (relative to /v1) reads, e.g. "/cms/public/home" → "home", "/catalog/public/products" → "catalog". */
export function cacheResource(path: string): StoreCacheResource {
  const seg = path.replace(/^\/+/, "").split(/[/?#]/);
  const [a = "", b = "", c = ""] = seg;
  let r: string;
  if (a === "cms") r = b === "public" ? c : b;
  else if (a === "store") r = b === "promotions" || b === "bundles" ? "offers" : b === "availability" ? "catalog" : b;
  else if (a === "catalog" || a === "inventory") r = "catalog";
  else if (a === "coupons") r = "offers";
  else r = a;
  return (KNOWN.has(r) ? r : "other") as StoreCacheResource;
}

/** Normalises a shop key (slug or host): lower case, no port on custom domains is up to the caller. */
export const cacheKey = (key: string) => key.trim().toLowerCase();

export const shopTag = (key: string) => `store:${cacheKey(key)}`;
export const resourceTag = (key: string, resource: StoreCacheResource) => `store:${cacheKey(key)}:${resource}`;

/** The tags of a cached fetch of `path` for the shop `key`. */
export function cacheTags(key: string, path: string): string[] {
  return [shopTag(key), resourceTag(key, cacheResource(path))];
}

export interface RevalidateRequest {
  /** The shop's slug and verified custom domains. */
  keys: string[];
  /** Resources to refresh; empty / missing = everything of the shop. */
  resources?: string[];
}

/** The tags a refresh request clears (unknown resources are ignored; none valid → the whole shop). Null = bad body. */
export function tagsToRevalidate(body: unknown): string[] | null {
  if (!body || typeof body !== "object") return null;
  const { keys, resources } = body as Partial<RevalidateRequest>;
  if (!Array.isArray(keys)) return null;
  const ks = [...new Set(keys.filter((k): k is string => typeof k === "string" && /^[a-z0-9.:-]{1,253}$/i.test(k.trim())).map(cacheKey))].slice(0, 20);
  if (!ks.length) return null;
  const rs = Array.isArray(resources) ? [...new Set(resources.filter((r): r is StoreCacheResource => typeof r === "string" && KNOWN.has(r)))] : [];
  return ks.flatMap((k) => (rs.length ? rs.map((r) => resourceTag(k, r)) : [shopTag(k)]));
}

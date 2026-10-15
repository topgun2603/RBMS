/**
 * Storefront URL layout shared by the API (sitemap, menus) and the storefront app. Pure — no server imports.
 * Matches the reserved page slugs (`p`, `c`, `collections`, `blog`, `search`, `products` …).
 */
export const STORE_PATHS = {
  home: "/",
  products: "/products",
  search: "/search",
  blog: "/blog",
  product: (slug: string) => `/p/${encodeURIComponent(slug)}`,
  category: (slug: string) => `/c/${encodeURIComponent(slug)}`,
  collection: (slug: string) => `/collections/${encodeURIComponent(slug)}`,
  page: (slug: string) => `/${encodeURIComponent(slug)}`,
  post: (slug: string) => `/blog/${encodeURIComponent(slug)}`,
} as const;

/** "https://shop.in/" → "https://shop.in" (no trailing slash). */
export const normalizeBaseUrl = (baseUrl: string) => baseUrl.trim().replace(/\/+$/, "");

/** Absolute URL for a site path; absolute http(s) URLs pass through unchanged. */
export function absoluteUrl(baseUrl: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = normalizeBaseUrl(baseUrl);
  const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return path === "/" ? `${base}/` : `${base}${path}`;
}

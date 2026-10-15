import { absoluteUrl, STORE_PATHS } from "./paths";

/** The sitemap protocol's per-file limit. */
export const SITEMAP_MAX_URLS = 50_000;

export interface SitemapUrl {
  /** Site path or absolute URL. */
  loc: string;
  lastmod?: Date | string | null;
}

export const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** W3C datetime without milliseconds ("2026-10-15T04:30:00Z"); null for missing/invalid dates. */
export function lastmodOf(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * `<urlset>` XML with absolute, XML-escaped locs; duplicates removed and capped at 50 000 URLs (earlier entries win,
 * so pass the most important ones first).
 */
export function buildSitemapXml(baseUrl: string, urls: readonly SitemapUrl[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const u of urls) {
    if (lines.length >= SITEMAP_MAX_URLS) break;
    const loc = absoluteUrl(baseUrl, u.loc);
    if (seen.has(loc)) continue;
    seen.add(loc);
    const lastmod = lastmodOf(u.lastmod);
    lines.push(`<url><loc>${xmlEscape(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join("\n")}${lines.length ? "\n" : ""}</urlset>\n`;
}

export interface SitemapGroups {
  home?: Date | string | null;
  pages?: { slug: string; updatedAt: Date | string | null }[];
  posts?: { slug: string; updatedAt: Date | string | null }[];
  categories?: { slug: string; updatedAt: Date | string | null }[];
  collections?: { slug: string; updatedAt: Date | string | null }[];
  products?: { slug: string; updatedAt: Date | string | null }[];
}

/** Sitemap URLs in priority order: home, pages, blog + posts, categories, collections, products. */
export function sitemapUrls(g: SitemapGroups): SitemapUrl[] {
  const urls: SitemapUrl[] = [{ loc: STORE_PATHS.home, lastmod: g.home ?? null }];
  for (const p of g.pages ?? []) urls.push({ loc: STORE_PATHS.page(p.slug), lastmod: p.updatedAt });
  const posts = g.posts ?? [];
  if (posts.length) {
    const newest = posts.map((p) => lastmodOf(p.updatedAt)).filter((d): d is string => !!d).sort().pop() ?? null;
    urls.push({ loc: STORE_PATHS.blog, lastmod: newest });
    for (const p of posts) urls.push({ loc: STORE_PATHS.post(p.slug), lastmod: p.updatedAt });
  }
  for (const c of g.categories ?? []) urls.push({ loc: STORE_PATHS.category(c.slug), lastmod: c.updatedAt });
  for (const c of g.collections ?? []) urls.push({ loc: STORE_PATHS.collection(c.slug), lastmod: c.updatedAt });
  for (const p of g.products ?? []) urls.push({ loc: STORE_PATHS.product(p.slug), lastmod: p.updatedAt });
  return urls;
}

export const buildSitemap = (baseUrl: string, groups: SitemapGroups) => buildSitemapXml(baseUrl, sitemapUrls(groups));

export const ROBOTS_DISALLOW = ["/account", "/checkout", "/cart"] as const;

/** robots.txt: allow all, keep private flows out, link the sitemap. */
export function buildRobotsTxt(baseUrl: string, sitemapPath = "/sitemap.xml"): string {
  return [
    "User-agent: *",
    "Allow: /",
    ...ROBOTS_DISALLOW.map((p) => `Disallow: ${p}`),
    "",
    `Sitemap: ${absoluteUrl(baseUrl, sitemapPath)}`,
    "",
  ].join("\n");
}

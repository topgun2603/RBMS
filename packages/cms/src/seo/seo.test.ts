import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  breadcrumbJsonLd,
  defaultMeta,
  organizationJsonLd,
  plainText,
  productJsonLd,
  serializeJsonLd,
  truncate,
  websiteSearchJsonLd,
} from "./jsonld";
import { absoluteUrl } from "./paths";
import { buildRobotsTxt, buildSitemap, buildSitemapXml, lastmodOf, SITEMAP_MAX_URLS, xmlEscape } from "./sitemap";

const BASE = "https://raja.srikit.in/";

describe("sitemap", () => {
  it("absolute, escaped URLs with ISO lastmod in priority order", () => {
    const xml = buildSitemap(BASE, {
      home: new Date("2026-10-01T10:00:00.123Z"),
      pages: [{ slug: "about", updatedAt: "2026-09-01T00:00:00Z" }],
      posts: [
        { slug: "care-tips", updatedAt: new Date("2026-09-10T00:00:00Z") },
        { slug: "new", updatedAt: new Date("2026-09-12T00:00:00Z") },
      ],
      categories: [{ slug: "sarees", updatedAt: null }],
      collections: [{ slug: "best", updatedAt: "bad date" }],
      products: [{ slug: "silk&cotton<1>", updatedAt: new Date("2026-08-01T00:00:00Z") }],
    });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')).toBe(true);
    const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([
      "https://raja.srikit.in/",
      "https://raja.srikit.in/about",
      "https://raja.srikit.in/blog",
      "https://raja.srikit.in/blog/care-tips",
      "https://raja.srikit.in/blog/new",
      "https://raja.srikit.in/c/sarees",
      "https://raja.srikit.in/collections/best",
      "https://raja.srikit.in/p/silk%26cotton%3C1%3E",
    ]);
    expect(xml).toContain("<url><loc>https://raja.srikit.in/</loc><lastmod>2026-10-01T10:00:00Z</lastmod></url>");
    expect(xml).toContain("<loc>https://raja.srikit.in/blog</loc><lastmod>2026-09-12T00:00:00Z</lastmod>");
    expect(xml).toContain("<url><loc>https://raja.srikit.in/c/sarees</loc></url>");
    expect(xml).toContain("<url><loc>https://raja.srikit.in/collections/best</loc></url>");
    expect(xml.endsWith("</urlset>\n")).toBe(true);
  });

  it("XML-escapes locs", () => {
    expect(xmlEscape(`a&b<c>"d'`)).toBe("a&amp;b&lt;c&gt;&quot;d&apos;");
    const xml = buildSitemapXml("https://shop.in", [{ loc: "https://shop.in/search?q=a&b=<c>" }]);
    expect(xml).toContain("<loc>https://shop.in/search?q=a&amp;b=&lt;c&gt;</loc>");
    expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  });

  it("caps at 50 000 URLs and drops duplicates", () => {
    const products = Array.from({ length: SITEMAP_MAX_URLS + 10 }, (_, i) => ({ slug: `p${i}`, updatedAt: null }));
    const xml = buildSitemap(BASE, { products, pages: [{ slug: "about", updatedAt: null }, { slug: "about", updatedAt: null }] });
    expect(xml.match(/<url>/g)?.length).toBe(SITEMAP_MAX_URLS);
    expect(xml.match(/\/about</g)?.length).toBe(1);
  });

  it("no blog URL without posts", () => {
    expect(buildSitemap(BASE, {})).not.toContain("/blog");
    expect(lastmodOf(null)).toBeNull();
  });
});

describe("robots.txt", () => {
  it("allows all, disallows private flows and links the sitemap", () => {
    expect(buildRobotsTxt("https://raja.srikit.in/")).toBe(
      "User-agent: *\nAllow: /\nDisallow: /account\nDisallow: /checkout\nDisallow: /cart\n\nSitemap: https://raja.srikit.in/sitemap.xml\n",
    );
  });
});

describe("JSON-LD", () => {
  it("Product with a single INR offer", () => {
    const ld = productJsonLd({
      baseUrl: BASE,
      name: "Kanchipuram Silk Saree",
      slug: "kanchi-silk",
      description: "**Pure** silk with [zari](/zari) border.",
      images: ["/uploads/a.jpg", { url: "https://cdn.x/b.jpg" }],
      brand: "Raja",
      sku: "KS-01",
      priceMin: 1249900,
    });
    expect(ld).toEqual({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Kanchipuram Silk Saree",
      url: "https://raja.srikit.in/p/kanchi-silk",
      image: ["https://raja.srikit.in/uploads/a.jpg", "https://cdn.x/b.jpg"],
      description: "Pure silk with zari border.",
      sku: "KS-01",
      brand: { "@type": "Brand", name: "Raja" },
      offers: {
        "@type": "Offer",
        price: "12499.00",
        priceCurrency: "INR",
        availability: "https://schema.org/InStock",
        url: "https://raja.srikit.in/p/kanchi-silk",
      },
    });
    expect(ld).not.toHaveProperty("aggregateRating");
  });

  it("Product with a price range, out of stock and a rating", () => {
    const ld = productJsonLd({
      baseUrl: BASE,
      name: "Kurti",
      slug: "kurti",
      priceMin: 49900,
      priceMax: 79950,
      variantCount: 4,
      availability: false,
      rating: { average: 4.36, count: 12 },
    });
    expect(ld.offers).toMatchObject({
      "@type": "AggregateOffer",
      lowPrice: "499.00",
      highPrice: "799.50",
      offerCount: 4,
      priceCurrency: "INR",
      availability: "https://schema.org/OutOfStock",
    });
    expect(ld.aggregateRating).toEqual({ "@type": "AggregateRating", ratingValue: 4.4, reviewCount: 12, bestRating: 5, worstRating: 1 });
    expect(productJsonLd({ baseUrl: BASE, name: "x", slug: "x", priceMin: 1, rating: { average: 0, count: 0 } })).not.toHaveProperty(
      "aggregateRating",
    );
  });

  it("BreadcrumbList", () => {
    expect(breadcrumbJsonLd([{ name: "Home", url: "/" }, { name: "Sarees", url: "/c/sarees" }, { name: "Silk" }], BASE)).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://raja.srikit.in/" },
        { "@type": "ListItem", position: 2, name: "Sarees", item: "https://raja.srikit.in/c/sarees" },
        { "@type": "ListItem", position: 3, name: "Silk" },
      ],
    });
  });

  it("Organization with logo and sameAs", () => {
    expect(
      organizationJsonLd({ name: "Raja Silks", url: BASE, logo: "/logo.png", sameAs: ["https://instagram.com/raja", null, "javascript:x"] }),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "Raja Silks",
      url: "https://raja.srikit.in/",
      logo: "https://raja.srikit.in/logo.png",
      sameAs: ["https://instagram.com/raja"],
    });
  });

  it("WebSite with SearchAction to /search?q=", () => {
    expect(websiteSearchJsonLd({ name: "Raja Silks", url: BASE })).toEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Raja Silks",
      url: "https://raja.srikit.in/",
      potentialAction: {
        "@type": "SearchAction",
        target: { "@type": "EntryPoint", urlTemplate: "https://raja.srikit.in/search?q={search_term_string}" },
        "query-input": "required name=search_term_string",
      },
    });
  });

  it("serializes safely for a script tag", () => {
    const s = serializeJsonLd({ name: "</script><script>alert(1)</script> & co " });
    expect(s).not.toContain("<");
    expect(s).not.toContain("&");
    expect(s).not.toContain(" ");
    expect(JSON.parse(s)).toEqual({ name: "</script><script>alert(1)</script> & co " });
  });

  it("has no server imports", () => {
    for (const f of ["./jsonld.ts", "./paths.ts"]) {
      const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
      const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      expect(imports.every((i) => i === "./paths"), `${f}: ${imports.join(", ")}`).toBe(true);
    }
  });
});

describe("defaultMeta", () => {
  const shop = { name: "Raja Silks", baseUrl: BASE, tagline: "Silks since 1962", logoUrl: "/logo.png" };

  it("home uses the shop name and tagline", () => {
    const m = defaultMeta(shop, { kind: "home" });
    expect(m).toMatchObject({
      title: "Raja Silks – Silks since 1962",
      description: "Silks since 1962",
      canonical: "https://raja.srikit.in/",
      openGraph: { type: "website", siteName: "Raja Silks", locale: "en_IN", images: [{ url: "https://raja.srikit.in/logo.png" }] },
    });
    expect(m.robots).toBeUndefined();
  });

  it("product from its fields, SEO overrides win", () => {
    const desc = "A *pure* silk saree. ".repeat(20);
    const m = defaultMeta(shop, { kind: "product", slug: "kanchi", name: "Kanchi Saree", description: desc, image: "https://cdn/a.jpg" });
    expect(m.title).toBe("Kanchi Saree | Raja Silks");
    expect(m.canonical).toBe("https://raja.srikit.in/p/kanchi");
    expect(m.description.length).toBeLessThanOrEqual(160);
    expect(m.description.endsWith("…")).toBe(true);
    expect(m.description).not.toContain("*");
    expect(m.openGraph).toMatchObject({ type: "product", url: m.canonical, images: [{ url: "https://cdn/a.jpg", alt: "Kanchi Saree" }] });
    expect(m.twitter.card).toBe("summary_large_image");

    const o = defaultMeta(shop, {
      kind: "page",
      slug: "about",
      title: "About",
      seo: { title: "Our story", description: "Four generations of weavers", noindex: true },
    });
    expect(o).toMatchObject({ title: "Our story", description: "Four generations of weavers", canonical: "https://raja.srikit.in/about", robots: "noindex, nofollow" });
  });

  it("post is an article with dates; fallbacks without a description", () => {
    const m = defaultMeta(
      { name: "Kumar", baseUrl: "https://kumar.in" },
      { kind: "post", slug: "tips", title: "Care tips", publishedAt: "2026-09-01T00:00:00Z", updatedAt: new Date("2026-09-02T00:00:00Z") },
    );
    expect(m.openGraph).toMatchObject({
      type: "article",
      publishedTime: "2026-09-01T00:00:00.000Z",
      modifiedTime: "2026-09-02T00:00:00.000Z",
      images: [],
    });
    expect(m.description).toBe("Care tips – shop online at Kumar.");
    expect(m.canonical).toBe("https://kumar.in/blog/tips");
  });

  it("text helpers", () => {
    expect(plainText("# Title\n\n- **bold** <b>x</b> ![img](a.png)")).toBe("Title bold x img");
    expect(truncate("hello world foo", 12)).toBe("hello world…");
    expect(absoluteUrl("https://a.in/", "x")).toBe("https://a.in/x");
  });
});

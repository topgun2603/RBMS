import { describe, expect, it } from "vitest";
import {
  blockSchema,
  blocksSchema,
  CMS_LIMITS,
  extractYoutubeId,
  homeDocSchema,
  homeSectionSchema,
  hrefSchema,
  menuItemsSchema,
  pageInputSchema,
  postInputSchema,
  stripHtml,
  urlSchema,
} from "./content";

const U1 = "11111111-1111-4111-8111-111111111111";
const ok = (schema: { safeParse(v: unknown): { success: boolean } }, v: unknown) => schema.safeParse(v).success;

describe("urls", () => {
  it("accepts http(s) and site paths only", () => {
    for (const v of ["https://cdn.shop.in/a.jpg", "http://x.in", "/products", "/c/sarees?sort=new", "/"]) expect(ok(urlSchema, v)).toBe(true);
    for (const v of ["javascript:alert(1)", "data:image/png;base64,AA", "//evil.com/x", "/\\evil.com", "ftp://x.in/a", "products", "", "/a b"])
      expect(ok(urlSchema, v), v).toBe(false);
  });
  it("links also take mailto: and tel:", () => {
    expect(ok(hrefSchema, "tel:+91 98765 43210")).toBe(true);
    expect(ok(hrefSchema, "mailto:hi@shop.in")).toBe(true);
    expect(ok(hrefSchema, "javascript:void(0)")).toBe(false);
    expect(ok(urlSchema, "tel:+919876543210")).toBe(false);
  });
});

describe("home sections", () => {
  const valid: Record<string, unknown> = {
    hero: { type: "hero", slides: [{ imageUrl: "https://cdn/x.jpg", heading: "Diwali sale", cta: { label: "Shop", href: "/products" } }] },
    categories: { type: "categories", title: "Shop by category", categoryIds: [U1] },
    collection: { type: "collection", title: "Best sellers", collectionSlug: "best-sellers", layout: "grid", limit: 8 },
    products: { type: "products", title: "Picks", productIds: [U1] },
    banner: { type: "banner", imageUrl: "/uploads/b.jpg", href: "/c/sarees", alt: "Sarees" },
    text: { type: "text", heading: "About", markdown: "We **love** silk." },
    "image-text": { type: "image-text", imageUrl: "https://cdn/x.jpg", heading: "Handloom", markdown: "Woven in Madurai", imageSide: "right" },
    testimonials: { type: "testimonials", items: [{ quote: "Lovely!", name: "Meena" }] },
    usp: { type: "usp", items: [{ icon: "truck", title: "Free shipping", text: "Above ₹999" }] },
    newsletter: { type: "newsletter", heading: "Get offers", text: "No spam" },
  };
  const invalid: Record<string, unknown> = {
    hero: { type: "hero", slides: [] },
    categories: { type: "categories", categoryIds: ["not-a-uuid"] },
    collection: { type: "collection", collectionSlug: "Best Sellers!", layout: "grid", limit: 8 },
    products: { type: "products", productIds: [] },
    banner: { type: "banner", imageUrl: "javascript:alert(1)" },
    text: { type: "text", markdown: "   " },
    "image-text": { type: "image-text", imageUrl: "https://cdn/x.jpg", heading: "", markdown: "" },
    testimonials: { type: "testimonials", items: [{ quote: "", name: "Meena" }] },
    usp: { type: "usp", items: Array.from({ length: CMS_LIMITS.usps + 1 }, () => ({ icon: "truck", title: "x" })) },
    newsletter: { type: "newsletter", heading: "" },
  };

  for (const type of Object.keys(valid)) {
    it(`${type}: valid and invalid`, () => {
      expect(homeSectionSchema.safeParse(valid[type]).success).toBe(true);
      expect(homeSectionSchema.safeParse(invalid[type]).success).toBe(false);
    });
  }

  it("fills defaults and rejects unknown types", () => {
    const c = homeSectionSchema.parse({ type: "collection", collectionSlug: "new" });
    expect(c).toMatchObject({ title: "", layout: "carousel", limit: 12 });
    expect(homeSectionSchema.parse({ type: "image-text", imageUrl: "/a.jpg", heading: "H" })).toMatchObject({ imageSide: "left", markdown: "" });
    expect(ok(homeSectionSchema, { type: "marquee", text: "x" })).toBe(false);
    expect(ok(homeSectionSchema, { type: "collection", collectionSlug: "x", limit: 49 })).toBe(false);
  });

  it("caps sections at 40 and hero slides at 8", () => {
    const text = { type: "text", markdown: "x" };
    expect(ok(homeDocSchema, { sections: Array(40).fill(text) })).toBe(true);
    expect(ok(homeDocSchema, { sections: Array(41).fill(text) })).toBe(false);
    const slide = { imageUrl: "/a.jpg" };
    expect(ok(homeSectionSchema, { type: "hero", slides: Array(9).fill(slide) })).toBe(false);
  });

  it("strips raw HTML from markdown", () => {
    const t = homeSectionSchema.parse({ type: "text", markdown: "Hi <script>alert(1)</script><b>there</b> <!-- x --> 2 < 3" });
    expect(t).toMatchObject({ markdown: "Hi alert(1)there  2 < 3" });
    expect(stripHtml('<img src=x onerror="a()">ok')).toBe("ok");
  });
});

describe("blocks", () => {
  const valid: Record<string, unknown> = {
    heading: { type: "heading", level: 3, text: "Shipping" },
    paragraph: { type: "paragraph", markdown: "We ship **everywhere**." },
    image: { type: "image", url: "/uploads/a.jpg", alt: "Shop front", caption: "Our shop" },
    gallery: { type: "gallery", images: [{ url: "/a.jpg", alt: "a" }, { url: "https://cdn/b.jpg" }] },
    button: { type: "button", label: "WhatsApp us", href: "https://wa.me/919876543210" },
    faq: { type: "faq", items: [{ q: "COD?", a: "Yes" }] },
    video: { type: "video", youtubeId: "dQw4w9WgXcQ" },
    divider: { type: "divider" },
  };
  const invalid: Record<string, unknown> = {
    heading: { type: "heading", level: 1, text: "Title" },
    paragraph: { type: "paragraph", markdown: "" },
    image: { type: "image", url: "data:image/png;base64,AA" },
    gallery: { type: "gallery", images: [] },
    button: { type: "button", label: "Go", href: "javascript:x()" },
    faq: { type: "faq", items: [{ q: "", a: "Yes" }] },
    video: { type: "video", youtubeId: "short" },
    divider: { type: "line" },
  };
  for (const type of Object.keys(valid)) {
    it(`${type}: valid and invalid`, () => {
      expect(blockSchema.safeParse(valid[type]).success).toBe(true);
      expect(blockSchema.safeParse(invalid[type]).success).toBe(false);
    });
  }

  it("takes YouTube links and stores the id", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://youtube.com/shorts/dQw4w9WgXcQ",
    ]) {
      expect(blockSchema.parse({ type: "video", youtubeId: url })).toMatchObject({ youtubeId: "dQw4w9WgXcQ" });
    }
    expect(extractYoutubeId("https://vimeo.com/123")).toBeNull();
    expect(ok(blockSchema, { type: "video", youtubeId: "https://evil.com/watch?v=dQw4w9WgXcQ" })).toBe(false);
  });

  it("caps blocks at 100", () => {
    expect(ok(blocksSchema, Array(100).fill({ type: "divider" }))).toBe(true);
    expect(ok(blocksSchema, Array(101).fill({ type: "divider" }))).toBe(false);
  });

  it("heading level defaults to 2", () => {
    expect(blockSchema.parse({ type: "heading", text: "x" })).toMatchObject({ level: 2 });
  });
});

describe("menus", () => {
  it("accepts two levels with targets", () => {
    const items = menuItemsSchema.parse([
      { label: "Sarees", type: "category", ref: "sarees", children: [{ label: "Silk", type: "category", ref: "silk-sarees" }] },
      { label: "About", type: "page", ref: "about-us" },
      { label: "Help", children: [{ label: "Call", href: "tel:+919876543210" }] },
    ]);
    expect(items[2]).toMatchObject({ type: "url" });
  });

  it("rejects a third level, missing targets and more than 40 items", () => {
    const deep = [{ label: "A", href: "/a", children: [{ label: "B", href: "/b", children: [{ label: "C", href: "/c" }] }] }];
    expect(ok(menuItemsSchema, deep)).toBe(false);
    expect(ok(menuItemsSchema, [{ label: "A", type: "page" }])).toBe(false);
    expect(ok(menuItemsSchema, [{ label: "A", type: "url" }])).toBe(false);
    expect(ok(menuItemsSchema, [{ label: "A", href: "javascript:x()" }])).toBe(false);
    const leaf = { label: "x", href: "/x" };
    expect(ok(menuItemsSchema, Array(40).fill(leaf))).toBe(true);
    expect(ok(menuItemsSchema, Array(41).fill(leaf))).toBe(false);
    // 20 parents × (1 + 1 child) = 40 ok; one more child → 41
    const parents = Array.from({ length: 20 }, () => ({ ...leaf, children: [leaf] }));
    expect(ok(menuItemsSchema, parents)).toBe(true);
    expect(ok(menuItemsSchema, [...parents.slice(0, 19), { ...leaf, children: [leaf, leaf] }])).toBe(false);
  });

  it("accepts an empty children array on a leaf", () => {
    expect(ok(menuItemsSchema, [{ label: "A", href: "/a", children: [{ label: "B", href: "/b", children: [] }] }])).toBe(true);
  });
});

describe("pages and posts", () => {
  it("validates input and normalises tags", () => {
    const p = pageInputSchema.parse({ title: "About us" });
    expect(p.blocks).toEqual([]);
    expect(ok(pageInputSchema, { title: "" })).toBe(false);
    expect(pageInputSchema.parse({ title: "x", slug: "About-Us" }).slug).toBe("about-us");
    expect(ok(pageInputSchema, { title: "x", slug: "about us" })).toBe(false);
    const post = postInputSchema.parse({ title: "Care tips", tags: ["Silk", "silk", "care"] });
    expect(post.tags).toEqual(["silk", "care"]);
    expect(ok(postInputSchema, { title: "x", coverUrl: "javascript:x" })).toBe(false);
  });
});

import type { BusinessPack } from "./packs";

/**
 * A new shop's starter home page in the CMS section format (`@srirealtime/cms` homeSectionSchema validates it):
 * a photo-less hero (the theme's brand block), categories, the newest items, the pack's promises and a newsletter.
 */
export function starterHome(pack: BusinessPack, shopName: string, locale: "en" | "ta" = "en") {
  const c = pack.copy[locale];
  const id = (k: string) => `starter-${k}`;
  return [
    {
      type: "hero" as const,
      id: id("hero"),
      slides: [{ imageUrl: null, heading: shopName ? `${shopName}: ${c.heroHeading}` : c.heroHeading, subheading: c.heroSubheading, cta: { label: c.cta, href: pack.ctaHref ?? "/search" } }],
    },
    { type: "categories" as const, id: id("categories"), title: c.categoriesTitle },
    {
      type: "usp" as const,
      id: id("usp"),
      items: pack.usps.map((u) => ({ icon: u.icon, title: u.title[locale], text: u.text[locale] })),
    },
    { type: "newsletter" as const, id: id("newsletter"), heading: locale === "ta" ? "தொடர்பில் இருங்கள்" : "Stay in touch", text: c.newsletter },
  ];
}

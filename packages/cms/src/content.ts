import { z } from "zod";

/**
 * Zod schemas for everything shop owners edit: home sections, page/post blocks, menus and SEO overrides
 * (docs/commerce-batch2.md §4). Pure — no server imports.
 */

// ------------------------------------------------------------------ limits

export const CMS_LIMITS = {
  sections: 60,
  blocks: 100,
  heroSlides: 8,
  menuItems: 40,
  menuChildren: 20,
  sectionItems: 20,
  usps: 8,
  ids: 48,
  galleryImages: 24,
  faqItems: 50,
  tags: 20,
  title: 160,
  heading: 120,
  label: 60,
  alt: 200,
  url: 1000,
  markdownSection: 10_000,
  markdownBlock: 20_000,
  collectionLimit: 48,
  logos: 24,
  mosaicTiles: 7,
  hours: 7,
  services: 12,
  menuGroups: 12,
  menuDishes: 40,
  instagramImages: 12,
  productTabs: 6,
  shelfLimit: 24,
  hotspots: 8,
  stats: 6,
  timeline: 12,
  team: 16,
  plans: 4,
  planFeatures: 12,
  blogLimit: 12,
  reviewsLimit: 12,
  finderQuestions: 3,
  finderOptions: 8,
  stories: 12,
  shelfCategories: 8,
  chapters: 6,
  compareProducts: 4,
  compareRows: 12,
  tiles: 12,
  sizeGroups: 4,
  sizes: 20,
  swatchProducts: 6,
  shades: 60,
  /** Paise (₹10 lakh). */
  price: 100_000_000,
} as const;

// ------------------------------------------------------------------ primitives

/** Site-relative path: starts with one "/", no "//" or "/\" (protocol-relative tricks), no whitespace or backslashes. */
const SITE_PATH = /^\/(?![/\\])[^\s\\]*$/;

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname.length > 0;
  } catch {
    return false;
  }
}

/** `http(s)://…` or a site path (`/products`). */
export const isSafeUrl = (value: string) => SITE_PATH.test(value) || isHttpUrl(value);

/** Links may also be `mailto:` / `tel:` (a "Call us" button). */
export const isSafeHref = (value: string) => isSafeUrl(value) || /^(mailto:[^\s]+@[^\s]+|tel:\+?[0-9 ()-]{3,20})$/i.test(value);

/** Image / media URL: http(s) or site-relative. */
export const urlSchema = z
  .string()
  .trim()
  .min(1)
  .max(CMS_LIMITS.url)
  .refine(isSafeUrl, "Use an http(s) URL or a site path starting with /");

/** Link target: http(s), site-relative, mailto: or tel:. */
export const hrefSchema = z
  .string()
  .trim()
  .min(1)
  .max(CMS_LIMITS.url)
  .refine(isSafeHref, "Use an http(s) URL, a site path starting with /, mailto: or tel:");

/** Removes HTML tags and comments: content is markdown, rendered client-side by a safe renderer; no raw HTML is stored. */
export function stripHtml(value: string): string {
  return value.replace(/<!--[\s\S]*?-->/g, "").replace(/<\/?[a-zA-Z][^<>]*>/g, "");
}

const text = (max: number) => z.string().trim().max(max);
const requiredText = (max: number) => z.string().trim().min(1).max(max);
const markdown = (max: number) => z.string().max(max).transform((s) => stripHtml(s).trim());
const requiredMarkdown = (max: number) =>
  markdown(max).refine((s) => s.length > 0, "Required");

/** `[a-z0-9]` words joined by single hyphens. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX = 80;
export const slugSchema = z.string().trim().toLowerCase().min(1).max(SLUG_MAX).regex(SLUG_RE, "Use lowercase letters, digits and hyphens");
/** Slugs of catalogue things (categories, collections) may be up to 120 characters. */
const refSlug = z.string().trim().toLowerCase().min(1).max(120).regex(SLUG_RE, "Use lowercase letters, digits and hyphens");

export const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** The 11-character id from a YouTube id or URL (watch, youtu.be, embed, shorts, live); null when there is none. */
export function extractYoutubeId(value: string): string | null {
  const v = value.trim();
  if (YOUTUBE_ID_RE.test(v)) return v;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(u.pathname);
      id = m?.[1] ?? null;
    }
  }
  return id && YOUTUBE_ID_RE.test(id) ? id : null;
}

export const youtubeIdSchema = z.preprocess(
  (v) => (typeof v === "string" ? (extractYoutubeId(v) ?? v.trim()) : v),
  z.string().regex(YOUTUBE_ID_RE, "Not a YouTube video id or link"),
);

const uuid = z.string().uuid();
/** Optional client key so the editor can track sections/blocks across edits. */
const clientId = z.string().trim().min(1).max(40).optional();

export const ctaSchema = z.object({ label: requiredText(CMS_LIMITS.label), href: hrefSchema });
export type Cta = z.output<typeof ctaSchema>;

// ------------------------------------------------------------------ home sections

export const HOME_SECTION_TYPES = [
  "hero",
  "categories",
  "collection",
  "products",
  "banner",
  "text",
  "image-text",
  "testimonials",
  "usp",
  "newsletter",
  "hero-split",
  "hero-video",
  "offer",
  "gallery",
  "logos",
  "category-mosaic",
  "faq",
  "location",
  "menu-board",
  "appointment",
  "before-after",
  "gold-rates",
  "instagram",
  "product-tabs",
  "deal",
  "shop-the-look",
  "bestsellers",
  "recently-viewed",
  "recommended",
  "stats",
  "timeline",
  "team",
  "pricing-table",
  "blog-posts",
  "reviews-summary",
  "flash-sale",
  "finder",
  "stories",
  "category-shelf",
  "sticky-story",
  "comparison",
  "tiles",
  "size-finder",
  "swatches",
  "enquiry-form",
] as const;
export type HomeSectionType = (typeof HOME_SECTION_TYPES)[number];

/** Hidden sections stay in the draft (and the published doc) but are skipped on the storefront. */
const sectionHidden = z.boolean().optional();

// ------------------------------------------------------------------ section style

export const SECTION_BACKGROUNDS = ["none", "brand", "muted", "dark", "image", "gradient"] as const;
export type SectionBackground = (typeof SECTION_BACKGROUNDS)[number];
export const SECTION_PADDINGS = ["compact", "normal", "spacious"] as const;
export const SECTION_WIDTHS = ["contained", "full"] as const;
export const SECTION_ALIGNS = ["start", "center"] as const;
export const SECTION_ANIMATIONS = ["none", "fade", "rise"] as const;
/** full: the whole row (the default) · half: two half sections in a row sit side by side on larger screens. */
export const SECTION_SPANS = ["full", "half"] as const;

/** An enum that falls back to "not set" (the default look) when stored content has a value this build doesn't know. */
const lenient = <T extends [string, ...string[]]>(values: T) => z.enum(values).optional().catch(undefined);

/**
 * Optional look of any home section; a field left out means the theme's default. Background `image` needs `imageUrl`
 * (darkened by `overlay` %); `gradient` blends the brand colours. Hide on phones (< 768px) or on larger screens.
 * `span: half` pairs the section with the next half section (side by side from 1024px; stacked on phones).
 */
export const sectionStyleSchema = z
  .object({
    background: lenient([...SECTION_BACKGROUNDS]),
    imageUrl: urlSchema.optional(),
    overlay: z.coerce.number().int().min(0).max(90).optional(),
    padding: lenient([...SECTION_PADDINGS]),
    width: lenient([...SECTION_WIDTHS]),
    align: lenient([...SECTION_ALIGNS]),
    animation: lenient([...SECTION_ANIMATIONS]),
    hideOnMobile: z.boolean().optional(),
    hideOnDesktop: z.boolean().optional(),
    span: lenient([...SECTION_SPANS]),
  })
  .superRefine((st, ctx) => {
    if (st.background === "image" && !st.imageUrl) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["imageUrl"], message: "Required" });
  });
export type SectionStyle = z.output<typeof sectionStyleSchema>;
const sectionStyle = sectionStyleSchema.optional();

/** A price in paise (whole number). */
const paise = z.coerce.number().int().min(0).max(CMS_LIMITS.price);
const phone = z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/, "Use digits, spaces and an optional +");

export const heroSlideSchema = z.object({
  /** Null/omitted: the storefront renders a branded gradient instead of a photo. */
  imageUrl: urlSchema.nullable().default(null),
  mobileImageUrl: urlSchema.optional(),
  heading: text(CMS_LIMITS.heading).optional(),
  subheading: text(240).optional(),
  cta: ctaSchema.optional(),
});
export type HeroSlide = z.output<typeof heroSlideSchema>;

export const heroSectionSchema = z.object({
  type: z.literal("hero"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  slides: z.array(heroSlideSchema).min(1).max(CMS_LIMITS.heroSlides),
});

/** An enum with a default that also replaces values this build doesn't know (stored content stays readable). */
const variant = <T extends [string, ...string[]]>(values: T, fallback: T[number]) => z.enum(values).default(fallback).catch(fallback);

/**
 * Category tiles: circles (round tiles, the original look) · cards (photo cards in a grid) · slider (large portrait
 * cards in a swipe row with arrows) · icon-list (wrapping chips with a small photo) · big-grid (large tiles, name on the
 * photo) · rounded-squares (app-icon squares, name below) · story-rings (circles in a brand gradient ring, like
 * stories) · pills (one swipeable row of icon chips, good for many categories) · tiles (square tiles, name + count on
 * a scrim) · banner-row (wide cards: picture, name, count, "Shop now") · bento (asymmetric grid, the first one large —
 * same look as the category-mosaic section) · minimal-list (an editorial text list with counts and arrows).
 * Categories without a photo get a brand-tinted icon. `showCounts` adds how many products each one has; `columns`
 * caps the tiles per row on desktop for the grid layouts and the slider (auto = the layout's own); the section style's
 * `align` centres rows of round tiles / chips (the default) or starts them at the left.
 */
export const CATEGORY_LAYOUTS = [
  "circles",
  "cards",
  "slider",
  "icon-list",
  "big-grid",
  "rounded-squares",
  "story-rings",
  "pills",
  "tiles",
  "banner-row",
  "bento",
  "minimal-list",
] as const;
export const CATEGORY_COLUMNS = ["auto", "3", "4", "5", "6"] as const;

export const categoriesSectionSchema = z.object({
  type: z.literal("categories"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).default(""),
  /** Which categories, in order; omitted = all (as the catalogue lists them). */
  categoryIds: z.array(uuid).max(CMS_LIMITS.ids).optional(),
  layout: variant([...CATEGORY_LAYOUTS], "circles"),
  showCounts: z.boolean().default(false),
  columns: variant([...CATEGORY_COLUMNS], "auto"),
});

export const collectionSectionSchema = z.object({
  type: z.literal("collection"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).default(""),
  collectionSlug: refSlug,
  layout: z.enum(["carousel", "grid"]).default("carousel"),
  limit: z.coerce.number().int().min(1).max(CMS_LIMITS.collectionLimit).default(12),
});

export const productsSectionSchema = z.object({
  type: z.literal("products"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).default(""),
  productIds: z.array(uuid).min(1).max(CMS_LIMITS.ids),
});

export const bannerSectionSchema = z.object({
  type: z.literal("banner"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  imageUrl: urlSchema,
  mobileImageUrl: urlSchema.optional(),
  href: hrefSchema.optional(),
  alt: text(CMS_LIMITS.alt).default(""),
});

export const textSectionSchema = z.object({
  type: z.literal("text"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  heading: text(CMS_LIMITS.heading).optional(),
  markdown: requiredMarkdown(CMS_LIMITS.markdownSection),
});

export const imageTextSectionSchema = z.object({
  type: z.literal("image-text"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  imageUrl: urlSchema,
  heading: requiredText(CMS_LIMITS.heading),
  markdown: markdown(CMS_LIMITS.markdownSection).default(""),
  cta: ctaSchema.optional(),
  imageSide: z.enum(["left", "right"]).default("left"),
});

export const testimonialsSectionSchema = z.object({
  type: z.literal("testimonials"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).optional(),
  /** carousel (a sliding row of cards, the default) · cards (a grid) · single (one big quote at a time). */
  layout: z.enum(["carousel", "cards", "single"]).default("carousel"),
  items: z
    .array(
      z.object({
        quote: requiredText(600),
        name: requiredText(80),
        /** "Bride, Madurai", "Member since 2021". */
        role: text(80).optional(),
        /** 1–5 stars; omitted = no stars. */
        rating: z.coerce.number().int().min(1).max(5).optional(),
        photoUrl: urlSchema.optional(),
      }),
    )
    .min(1)
    .max(CMS_LIMITS.sectionItems),
});

/** Icon keys the storefront knows (free shipping, COD, returns …); unknown keys render a generic icon. */
export const USP_ICONS = ["truck", "cash", "return", "shield", "star", "gift", "phone", "leaf", "clock", "tag", "heart", "check"] as const;

/** cards (one card per point, the original look) · inline (a slim strip with dividers) · centered (big icons in columns) · split (heading on one side, points on the other). */
export const USP_LAYOUTS = ["cards", "inline", "centered", "split"] as const;

export const uspSectionSchema = z.object({
  type: z.literal("usp"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  /** Shown by the centered and split layouts ("Why shop with us"). */
  title: text(CMS_LIMITS.heading).optional(),
  text: text(400).optional(),
  layout: variant([...USP_LAYOUTS], "cards"),
  items: z
    .array(
      z.object({
        icon: z.string().trim().toLowerCase().min(1).max(40).regex(/^[a-z0-9-]+$/, "Icon key: letters, digits, hyphens"),
        title: requiredText(CMS_LIMITS.label),
        text: text(200).default(""),
      }),
    )
    .min(1)
    .max(CMS_LIMITS.usps),
});

/** band (brand-coloured block, the original look) · split (a picture beside the form) · card (a centred card) · inline (one slim row). */
export const NEWSLETTER_LAYOUTS = ["band", "split", "card", "inline"] as const;

export const newsletterSectionSchema = z.object({
  type: z.literal("newsletter"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  heading: requiredText(CMS_LIMITS.heading),
  text: text(400).default(""),
  layout: variant([...NEWSLETTER_LAYOUTS], "band"),
  /** The split layout's picture (without one it shows the brand colour). */
  imageUrl: urlSchema.optional(),
});

// ---- richer layouts and trade sections

/** Picture beside the words (left or right) and up to two buttons; no picture = the brand colour block. */
export const heroSplitSectionSchema = z.object({
  type: z.literal("hero-split"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  imageUrl: urlSchema.nullable().default(null),
  imageSide: z.enum(["left", "right"]).default("right"),
  eyebrow: text(CMS_LIMITS.label).optional(),
  heading: requiredText(CMS_LIMITS.heading),
  text: text(400).optional(),
  cta: ctaSchema.optional(),
  cta2: ctaSchema.optional(),
});

/** A muted, looping background video (.mp4 / .webm file) under a darkening overlay; the poster shows until it plays. */
export const heroVideoSectionSchema = z.object({
  type: z.literal("hero-video"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  videoUrl: urlSchema,
  posterUrl: urlSchema.optional(),
  /** Darkening over the video, 0–90 %. */
  overlay: z.coerce.number().int().min(0).max(90).default(45),
  heading: requiredText(CMS_LIMITS.heading),
  text: text(400).optional(),
  cta: ctaSchema.optional(),
});

/** An offer strip: optional coupon code (with a copy button) and countdown; after `endsAt` it hides itself. */
export const offerSectionSchema = z.object({
  type: z.literal("offer"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  eyebrow: text(CMS_LIMITS.label).optional(),
  heading: requiredText(CMS_LIMITS.heading),
  text: text(400).optional(),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(40)
    .regex(/^[A-Z0-9_-]+$/, "Letters, digits, - and _")
    .optional(),
  endsAt: z.string().datetime({ offset: true }).optional(),
  cta: ctaSchema.optional(),
});

export const gallerySectionSchema = z.object({
  type: z.literal("gallery"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).optional(),
  layout: z.enum(["grid", "masonry", "carousel"]).default("grid"),
  images: z
    .array(z.object({ url: urlSchema, alt: text(CMS_LIMITS.alt).default(""), caption: text(200).optional(), href: hrefSchema.optional() }))
    .min(1)
    .max(CMS_LIMITS.galleryImages),
});

/**
 * Brand / partner logos in a strip; `grayscale` shows them grey until hovered. A logo picture is optional: entries
 * with only a name (and maybe a link) show as typeset wordmarks.
 */
export const logosSectionSchema = z.object({
  type: z.literal("logos"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).optional(),
  grayscale: z.boolean().default(false),
  items: z
    .array(z.object({ imageUrl: urlSchema.optional(), name: requiredText(80), href: hrefSchema.optional() }))
    .min(1)
    .max(CMS_LIMITS.logos),
});

/** Big category tiles in a bento layout (the first one large). Ids omitted = the catalogue's first categories. */
export const categoryMosaicSectionSchema = z.object({
  type: z.literal("category-mosaic"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).default(""),
  categoryIds: z.array(uuid).max(CMS_LIMITS.mosaicTiles).optional(),
});

export const faqSectionSchema = z.object({
  type: z.literal("faq"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).optional(),
  items: z
    .array(z.object({ q: requiredText(300), a: requiredMarkdown(3000) }))
    .min(1)
    .max(CMS_LIMITS.faqItems),
});

/** "9.9252, 78.1198" — what Google Maps copies when you right-click a place. */
export const COORDS_RE = /^-?\d{1,2}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/;

export function parseCoords(value: string | null | undefined): { lat: number; lng: number } | null {
  if (!value || !COORDS_RE.test(value.trim())) return null;
  const [lat, lng] = value.split(",").map((x) => Number(x.trim())) as [number, number];
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

/** Address, opening hours, call / WhatsApp and a map (an OpenStreetMap embed from the pin; no API keys). */
export const locationSectionSchema = z.object({
  type: z.literal("location"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).optional(),
  /** Omitted: the storefront shows the shop's own contact details (and nothing when there are none). */
  address: text(500).optional(),
  hours: z
    .array(z.object({ label: requiredText(40), value: requiredText(60) }))
    .max(CMS_LIMITS.hours)
    .default([]),
  phone: phone.optional(),
  whatsapp: phone.optional(),
  /** Map pin as "lat, lng"; without it there's no map, only the directions link. */
  coords: z
    .string()
    .trim()
    .refine((v) => parseCoords(v) !== null, "Use latitude, longitude like 9.9252, 78.1198")
    .optional(),
  /** "Get directions" target (e.g. a Google Maps share link); default: a maps search for the address. */
  mapLink: hrefSchema.optional(),
});

export const DIETS = ["veg", "nonveg", "egg"] as const;

/** Restaurant menu board: groups of dishes with prices and veg / non-veg marks (typed in by the owner). */
export const menuBoardSectionSchema = z.object({
  type: z.literal("menu-board"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).optional(),
  groups: z
    .array(
      z.object({
        name: requiredText(CMS_LIMITS.label),
        items: z
          .array(z.object({ name: requiredText(80), description: text(200).optional(), price: paise.optional(), diet: z.enum(DIETS).optional() }))
          .min(1)
          .max(CMS_LIMITS.menuDishes),
      }),
    )
    .min(1)
    .max(CMS_LIMITS.menuGroups),
  cta: ctaSchema.optional(),
});

/** Services trades: a few services with time and price and a Book button (default: the booking page). */
export const appointmentSectionSchema = z.object({
  type: z.literal("appointment"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  heading: requiredText(CMS_LIMITS.heading),
  text: text(400).optional(),
  services: z
    .array(z.object({ name: requiredText(80), duration: text(40).optional(), price: paise.optional() }))
    .max(CMS_LIMITS.services)
    .default([]),
  cta: ctaSchema.optional(),
});

/** Two pictures of the same thing with a drag slider between them (salon, repair, tailoring, gym). */
export const beforeAfterSectionSchema = z.object({
  type: z.literal("before-after"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).optional(),
  text: text(400).optional(),
  beforeUrl: urlSchema,
  afterUrl: urlSchema,
  beforeLabel: text(40).optional(),
  afterLabel: text(40).optional(),
});

/** Jewellery: today's gold (and silver) rate per gram from the shop's rate board; shows nothing when rates are off. */
export const goldRatesSectionSchema = z.object({
  type: z.literal("gold-rates"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).optional(),
  text: text(400).optional(),
  showSilver: z.boolean().default(true),
});

/** Hand-picked photos with a link to the shop's Instagram profile (no Instagram API). */
export const instagramSectionSchema = z.object({
  type: z.literal("instagram"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).optional(),
  handle: z
    .string()
    .trim()
    .transform((h) => h.replace(/^@/, ""))
    .pipe(z.string().regex(/^[A-Za-z0-9._]{1,30}$/, "Instagram username: letters, digits, . and _")),
  images: z
    .array(z.object({ url: urlSchema, alt: text(CMS_LIMITS.alt).default(""), href: hrefSchema.optional() }))
    .min(1)
    .max(CMS_LIMITS.instagramImages),
});

// ---- shelves, social proof and story sections

/** Where a product tab takes its products from. `collection` needs `collectionSlug`. */
export const PRODUCT_TAB_SOURCES = ["new", "bestsellers", "sale", "collection"] as const;
export const SHELF_LAYOUTS = ["grid", "carousel"] as const;
const shelfLimit = (fallback: number) => z.coerce.number().int().min(1).max(CMS_LIMITS.shelfLimit).default(fallback);

/** Tabs over product shelves (New / Bestsellers / On sale / a collection); each tab is a grid or a swipe row. */
export const productTabsSectionSchema = z.object({
  type: z.literal("product-tabs"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).default(""),
  layout: z.enum(SHELF_LAYOUTS).default("grid"),
  limit: shelfLimit(8),
  tabs: z
    .array(
      z
        .object({
          /** Omitted: the source's own name ("New arrivals", the collection's name …). */
          label: text(CMS_LIMITS.label).optional(),
          source: z.enum(PRODUCT_TAB_SOURCES),
          collectionSlug: refSlug.optional(),
        })
        .superRefine((tab, ctx) => {
          if (tab.source === "collection" && !tab.collectionSlug) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["collectionSlug"], message: "Required" });
        }),
    )
    .min(1)
    .max(CMS_LIMITS.productTabs),
});

/** One product, big picture, price, a countdown and Add to cart. Without `endsAt` the countdown runs to midnight. */
export const dealSectionSchema = z.object({
  type: z.literal("deal"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  /** Small line above the product name; default "Deal of the day". */
  title: text(CMS_LIMITS.heading).optional(),
  text: text(400).optional(),
  productId: uuid,
  /** After this the section hides itself (like an offer). */
  endsAt: z.string().datetime({ offset: true }).optional(),
});

/** A photo with dots on it (x / y in % of the picture), each linked to a product shown in a small card. */
export const shopTheLookSectionSchema = z.object({
  type: z.literal("shop-the-look"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).optional(),
  text: text(400).optional(),
  imageUrl: urlSchema,
  alt: text(CMS_LIMITS.alt).default(""),
  hotspots: z
    .array(z.object({ x: z.coerce.number().min(0).max(100), y: z.coerce.number().min(0).max(100), productId: uuid }))
    .min(1)
    .max(CMS_LIMITS.hotspots),
});

/** Best sellers by recent paid orders (the newest products while the shop has no orders yet). */
export const bestsellersSectionSchema = z.object({
  type: z.literal("bestsellers"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).default(""),
  layout: z.enum(SHELF_LAYOUTS).default("carousel"),
  limit: shelfLimit(8),
});

/** What this shopper looked at (kept in their browser); nothing shows until there are two. */
export const recentlyViewedSectionSchema = z.object({
  type: z.literal("recently-viewed"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).optional(),
});

/** "Recommended for you": trending products blended with the categories this shopper looked at. */
export const recommendedSectionSchema = z.object({
  type: z.literal("recommended"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).default(""),
  layout: z.enum(SHELF_LAYOUTS).default("carousel"),
  limit: shelfLimit(8),
});

/** Big numbers that count up when they come into view ("25+ years", "10,000 happy customers"). */
export const statsSectionSchema = z.object({
  type: z.literal("stats"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).optional(),
  text: text(400).optional(),
  items: z
    .array(
      z.object({
        value: z.coerce.number().min(0).max(1_000_000_000),
        prefix: text(8).optional(),
        /** "+", "%", " yrs", "K". */
        suffix: text(12).optional(),
        label: requiredText(CMS_LIMITS.label),
      }),
    )
    .min(1)
    .max(CMS_LIMITS.stats),
});

/** Our story: milestones in order ("1985 · First shop in Madurai"), each with an optional photo. */
export const timelineSectionSchema = z.object({
  type: z.literal("timeline"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).optional(),
  text: text(400).optional(),
  items: z
    .array(z.object({ when: requiredText(40), title: requiredText(CMS_LIMITS.heading), text: text(600).default(""), imageUrl: urlSchema.optional() }))
    .min(1)
    .max(CMS_LIMITS.timeline),
});

/** People (stylists, doctors, trainers): photo, role, a line about them and their links. */
export const teamSectionSchema = z.object({
  type: z.literal("team"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).optional(),
  text: text(400).optional(),
  members: z
    .array(
      z.object({
        name: requiredText(80),
        role: text(80).optional(),
        photoUrl: urlSchema.optional(),
        bio: text(300).optional(),
        instagram: hrefSchema.optional(),
        facebook: hrefSchema.optional(),
        linkedin: hrefSchema.optional(),
        website: hrefSchema.optional(),
      }),
    )
    .min(1)
    .max(CMS_LIMITS.team),
});

/** Plans or packages side by side (gym memberships, salon packages); at most one highlighted. */
export const pricingTableSectionSchema = z.object({
  type: z.literal("pricing-table"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).optional(),
  text: text(400).optional(),
  plans: z
    .array(
      z.object({
        name: requiredText(CMS_LIMITS.label),
        /** Paise; omitted = "Ask us". */
        price: paise.optional(),
        /** "/ month", "per session". */
        period: text(30).optional(),
        description: text(200).optional(),
        features: z.array(requiredText(120)).max(CMS_LIMITS.planFeatures).default([]),
        highlight: z.boolean().default(false),
        /** "Most popular". */
        badge: text(30).optional(),
        cta: ctaSchema.optional(),
      }),
    )
    .min(1)
    .max(CMS_LIMITS.plans)
    .refine((plans) => plans.filter((p) => p.highlight).length <= 1, "Highlight one plan at most"),
});

/** The newest published blog posts (optionally one tag); nothing shows while there are none. */
export const blogPostsSectionSchema = z.object({
  type: z.literal("blog-posts"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).optional(),
  limit: z.coerce.number().int().min(1).max(CMS_LIMITS.blogLimit).default(3),
  tag: z.string().trim().toLowerCase().min(1).max(40).optional(),
});

/** The shop's average rating, review count and latest approved reviews; nothing shows without reviews. */
export const reviewsSummarySectionSchema = z.object({
  type: z.literal("reviews-summary"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).optional(),
  limit: z.coerce.number().int().min(1).max(CMS_LIMITS.reviewsLimit).default(6),
});

// ---- layout sections: flash sale, finder, stories, category shelf, sticky story, comparison

/** Where a flash sale takes its products: picked by hand · the biggest discounts · a collection (`collectionSlug`). */
export const FLASH_SALE_SOURCES = ["pick", "sale", "collection"] as const;
const dateTime = z.string().datetime({ offset: true });

/** "HH:MM" shop time (IST), "24:00" = midnight at the end of the day. */
const clockTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/, "Use HH:MM");

/**
 * A timed sale over several products: a countdown band over a shelf. Shows from `startsAt` (omitted = now) until
 * `endsAt`, then hides itself; with `daily` only between those times each day ("every day 18:00–21:00", shop time,
 * may run past midnight), counting down to the end of the day's window. `pick` needs `productIds`, `collection` needs
 * `collectionSlug` (the editor checks both; a section without products is simply not shown).
 */
export const flashSaleSectionSchema = z.object({
  type: z.literal("flash-sale"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  /** Default "Flash sale". */
  title: text(CMS_LIMITS.heading).optional(),
  text: text(400).optional(),
  startsAt: dateTime.optional(),
  endsAt: dateTime,
  daily: z
    .object({ from: clockTime, to: clockTime })
    .refine((d) => d.from !== d.to, { message: "The daily window needs a different start and end", path: ["to"] })
    .optional(),
  source: variant([...FLASH_SALE_SOURCES], "pick"),
  productIds: z.array(uuid).max(CMS_LIMITS.ids).default([]),
  collectionSlug: refSlug.optional(),
  layout: z.enum(SHELF_LAYOUTS).default("carousel"),
  limit: shelfLimit(8),
  cta: ctaSchema.optional(),
});

/** wizard: one question at a time with a progress bar, then the matches · chips: every question as a row of chips, matches update live. */
export const FINDER_LAYOUTS = ["wizard", "chips"] as const;

/**
 * One answer of a finder question and what it filters: a category, a product tag (`tag`, exact: "class-1-5", "acne"),
 * a product option / attribute (`filterName` = `filterValue`, e.g. Age = 3-5 years, Size = 8, Skin type = Oily), words
 * to search (`keywords`) and a price range in paise. Answers to different questions combine (all must match).
 */
export const finderOptionSchema = z.object({
  label: requiredText(CMS_LIMITS.label),
  imageUrl: urlSchema.optional(),
  categoryId: uuid.optional(),
  tag: z.string().trim().toLowerCase().min(1).max(40).optional(),
  filterName: text(60).optional(),
  filterValue: text(200).optional(),
  keywords: text(120).optional(),
  priceMin: paise.optional(),
  priceMax: paise.optional(),
  /** Opens this page instead of the filtered list (a class's collection, a size guide …). */
  href: hrefSchema.optional(),
});
export type FinderOption = z.output<typeof finderOptionSchema>;

/** inline: the matching products show under the questions · button: a "Show" button opens the matching list. */
export const FINDER_RESULTS = ["inline", "button"] as const;

/** "Shop by finder": up to 3 questions (age, class, concern, size …) → a filtered product list and a link to all matches. */
export const finderSectionSchema = z.object({
  type: z.literal("finder"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  /** Default "Find the right one". */
  title: text(CMS_LIMITS.heading).optional(),
  text: text(400).optional(),
  layout: variant([...FINDER_LAYOUTS], "wizard"),
  results: variant([...FINDER_RESULTS], "inline"),
  /** The "Show" button's words ("Show my list"); default "Show matches". */
  buttonLabel: text(CMS_LIMITS.label).optional(),
  /** A picture beside the questions on larger screens. */
  imageUrl: urlSchema.optional(),
  /** A second button (e.g. "Send your school list on WhatsApp"). */
  cta: ctaSchema.optional(),
  questions: z
    .array(z.object({ label: requiredText(CMS_LIMITS.heading), options: z.array(finderOptionSchema).min(2).max(CMS_LIMITS.finderOptions) }))
    .min(1)
    .max(CMS_LIMITS.finderQuestions),
  /** Matches shown under the questions (the rest are one tap away). */
  limit: z.coerce.number().int().min(2).max(12).default(8),
});

/** rings: round story bubbles · reels: tall 9:16 cards in a swipe row. Either opens a full-screen story viewer. */
export const STORY_LAYOUTS = ["rings", "reels"] as const;

/** A strip of short stories / reels (picture or muted video, a line of text and a link), tapped open full screen. */
export const storiesSectionSchema = z.object({
  type: z.literal("stories"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).optional(),
  layout: variant([...STORY_LAYOUTS], "rings"),
  items: z
    .array(
      z.object({
        imageUrl: urlSchema,
        /** A short .mp4 / .webm clip; the picture is its poster. */
        videoUrl: urlSchema.optional(),
        title: requiredText(CMS_LIMITS.label),
        text: text(200).optional(),
        href: hrefSchema.optional(),
        ctaLabel: text(CMS_LIMITS.label).optional(),
      }),
    )
    .min(1)
    .max(CMS_LIMITS.stories),
});

/** A category list beside a product grid: pick a category on the side (chips on phones), its products show. Ids omitted = the first categories. */
export const categoryShelfSectionSchema = z.object({
  type: z.literal("category-shelf"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).default(""),
  categoryIds: z.array(uuid).max(CMS_LIMITS.shelfCategories).optional(),
  /** Category pictures in the side list. */
  showImages: z.boolean().default(true),
  limit: shelfLimit(8),
});

/** A picture that stays in view while chapters of text scroll past it; each chapter brings its own picture. */
export const stickyStorySectionSchema = z.object({
  type: z.literal("sticky-story"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).optional(),
  imageSide: z.enum(["left", "right"]).default("left"),
  chapters: z
    .array(
      z.object({
        eyebrow: text(CMS_LIMITS.label).optional(),
        heading: requiredText(CMS_LIMITS.heading),
        markdown: markdown(3000).default(""),
        imageUrl: urlSchema,
        alt: text(CMS_LIMITS.alt).default(""),
        cta: ctaSchema.optional(),
      }),
    )
    .min(1)
    .max(CMS_LIMITS.chapters),
});

/**
 * 2–4 products side by side: picture, price, rating and Add, then the owner's rows (one value per product, in the
 * products' order). `highlightId` marks the recommended one ("Best pick" or `highlightLabel`).
 */
export const comparisonSectionSchema = z.object({
  type: z.literal("comparison"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).optional(),
  text: text(400).optional(),
  productIds: z.array(uuid).min(2).max(CMS_LIMITS.compareProducts),
  highlightId: uuid.optional(),
  highlightLabel: text(30).optional(),
  showRating: z.boolean().default(true),
  rows: z
    .array(z.object({ label: requiredText(CMS_LIMITS.label), values: z.array(text(120)).max(CMS_LIMITS.compareProducts).default([]) }))
    .max(CMS_LIMITS.compareRows)
    .default([]),
});

/** row: one row (a sideways scroll on phones) · grid: two per row on phones, up to six on desktop. */
export const TILE_LAYOUTS = ["row", "grid"] as const;

/**
 * "Shop by need" tiles (concern, occasion, project, room): picture or icon, name, a one-line note and how many
 * products. A tile opens `href`, else its collection, else its tag's listing; the count comes from the collection or
 * the tag.
 */
export const tilesSectionSchema = z.object({
  type: z.literal("tiles"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).optional(),
  text: text(400).optional(),
  layout: variant([...TILE_LAYOUTS], "row"),
  showCounts: z.boolean().default(true),
  items: z
    .array(
      z.object({
        label: requiredText(CMS_LIMITS.label),
        /** "Niacinamide, salicylic acid, sunscreen". */
        note: text(160).optional(),
        imageUrl: urlSchema.optional(),
        collectionSlug: refSlug.optional(),
        tag: z.string().trim().toLowerCase().min(1).max(40).optional(),
        href: hrefSchema.optional(),
      }),
    )
    .min(1)
    .max(CMS_LIMITS.tiles),
});

/**
 * "Find your size": a group toggle (Men / Women / Kids) over size chips; a chip opens the listing filtered to that
 * size (`opt.<optionName>`, in the group's category). With `footLength`, a foot-length box (cm) picks the size from the
 * UK / India shoe chart (adult sizes "3"–"13", children's "8C"–"13C").
 */
export const sizeFinderSectionSchema = z.object({
  type: z.literal("size-finder"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).optional(),
  text: text(400).optional(),
  imageUrl: urlSchema.optional(),
  /** The product option the sizes are values of. */
  optionName: requiredText(60).default("Size"),
  footLength: z.boolean().default(false),
  groups: z
    .array(
      z.object({
        label: requiredText(CMS_LIMITS.label),
        categoryId: uuid.optional(),
        sizes: z.array(requiredText(20)).min(1).max(CMS_LIMITS.sizes),
      }),
    )
    .min(1)
    .max(CMS_LIMITS.sizeGroups),
});

/** Skin depth tags for face shades (a filter over the swatches). */
export const SKIN_DEPTHS = ["fair", "wheatish", "dusky", "deep"] as const;

/**
 * Shade finder: colour swatches of products' shade option (lipstick, foundation, nail paint, paint, thread); tapping a
 * swatch shows the shade and adds that variant. `shades` gives each option value its colour (and an optional skin
 * depth for the filter); values without one show a neutral swatch with their initial. With `alsoOption` (case colour
 * × phone model) the shopper picks the other option's value first.
 */
export const swatchesSectionSchema = z.object({
  type: z.literal("swatches"),
  id: clientId,
  hidden: sectionHidden,
  style: sectionStyle,
  title: text(CMS_LIMITS.heading).optional(),
  text: text(400).optional(),
  optionName: requiredText(60).default("Shade"),
  /**
   * A second option the shopper picks first (a case's "Phone model"): the swatches then show that value's colours,
   * with the exact variant's price, and Add adds that variant. Omitted = one-option products (the first variant of
   * each shade).
   */
  alsoOption: text(60).optional(),
  /** The picker's label (default "Your <alsoOption>"). */
  alsoLabel: text(60).optional(),
  productIds: z.array(uuid).min(1).max(CMS_LIMITS.swatchProducts),
  shades: z
    .array(
      z.object({
        value: requiredText(80),
        hex: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a colour like #b0413e"),
        depth: z.enum(SKIN_DEPTHS).optional(),
      }),
    )
    .max(CMS_LIMITS.shades)
    .default([]),
});

/** Fields of the enquiry form, shared by the home section and the page block. */
const enquiryFormFields = {
  id: clientId,
  heading: requiredText(CMS_LIMITS.heading),
  text: text(400).optional(),
  /** Sent with every enquiry as its topic (e.g. "Admission 2027-28"). */
  topic: text(60).optional(),
  askStudent: z.boolean().default(false),
  studentLabel: text(40).optional(),
  optionLabel: text(40).optional(),
  /** A choice list (e.g. classes); the select is hidden when empty. */
  options: z.array(requiredText(60)).max(20).default([]),
  askEmail: z.boolean().default(true),
  askMessage: z.boolean().default(true),
  submitLabel: text(40).optional(),
  successText: text(300).optional(),
  imageUrl: urlSchema.optional(),
  imageAlt: text(CMS_LIMITS.alt).optional(),
};

/** A contact / admission enquiry form that posts to the shop's enquiries inbox. */
export const enquiryFormSectionSchema = z.object({
  type: z.literal("enquiry-form"),
  hidden: sectionHidden,
  style: sectionStyle,
  ...enquiryFormFields,
});

export const homeSectionSchema = z.discriminatedUnion("type", [
  heroSectionSchema,
  categoriesSectionSchema,
  collectionSectionSchema,
  productsSectionSchema,
  bannerSectionSchema,
  textSectionSchema,
  imageTextSectionSchema,
  testimonialsSectionSchema,
  uspSectionSchema,
  newsletterSectionSchema,
  heroSplitSectionSchema,
  heroVideoSectionSchema,
  offerSectionSchema,
  gallerySectionSchema,
  logosSectionSchema,
  categoryMosaicSectionSchema,
  faqSectionSchema,
  locationSectionSchema,
  menuBoardSectionSchema,
  appointmentSectionSchema,
  beforeAfterSectionSchema,
  goldRatesSectionSchema,
  instagramSectionSchema,
  productTabsSectionSchema,
  dealSectionSchema,
  shopTheLookSectionSchema,
  bestsellersSectionSchema,
  recentlyViewedSectionSchema,
  recommendedSectionSchema,
  statsSectionSchema,
  timelineSectionSchema,
  teamSectionSchema,
  pricingTableSectionSchema,
  blogPostsSectionSchema,
  reviewsSummarySectionSchema,
  flashSaleSectionSchema,
  finderSectionSchema,
  storiesSectionSchema,
  categoryShelfSectionSchema,
  stickyStorySectionSchema,
  comparisonSectionSchema,
  tilesSectionSchema,
  sizeFinderSectionSchema,
  swatchesSectionSchema,
  enquiryFormSectionSchema,
]);
export type HomeSection = z.output<typeof homeSectionSchema>;
export type HomeSectionInput = z.input<typeof homeSectionSchema>;
export type SectionOf<T extends HomeSectionType> = Extract<HomeSection, { type: T }>;

// ------------------------------------------------------------------ SEO overrides

export const seoSchema = z.object({
  title: text(70).optional(),
  description: text(320).optional(),
  imageUrl: urlSchema.optional(),
  /** Keep out of search engines (and the sitemap). */
  noindex: z.boolean().optional(),
});
export type SeoFields = z.output<typeof seoSchema>;

/** A translated word, or a list / object of them (the shape of the section it translates; see localize.ts). */
type TranslationValue = string | TranslationValue[] | { [key: string]: TranslationValue };
const translationValue: z.ZodType<TranslationValue> = z.lazy(() =>
  z.union([z.string().max(CMS_LIMITS.markdownSection), z.array(translationValue).max(60), z.record(z.string().max(60), translationValue)]),
);

/**
 * The home page's words in other languages (`{ ta: { "<section id>": { heading: "…", items: [{ q: "…" }] } } }`):
 * the storefront shows them to shoppers browsing in that language (`localizeSections`, @srirealtime/cms/localize).
 * Only words are taken from a translation; links, pictures and references always come from the section.
 */
export const homeTranslationsSchema = z
  .object({ ta: z.record(z.string().max(80), z.record(z.string().max(60), translationValue)).optional() })
  .refine((t) => JSON.stringify(t).length <= 200_000, "Translations are too long");

/** What `PUT /home` takes and the draft/published columns hold. */
export const homeDocSchema = z.object({
  sections: z.array(homeSectionSchema).max(CMS_LIMITS.sections),
  seo: seoSchema.optional(),
  translations: homeTranslationsSchema.optional(),
});
export type HomeDoc = z.output<typeof homeDocSchema>;
export type HomeDocInput = z.input<typeof homeDocSchema>;

// ------------------------------------------------------------------ page / post blocks

export const BLOCK_TYPES = ["heading", "paragraph", "image", "gallery", "button", "faq", "video", "divider", "enquiry-form"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

const imageItem = z.object({ url: urlSchema, alt: text(CMS_LIMITS.alt).default(""), caption: text(300).optional() });

export const blockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), id: clientId, level: z.union([z.literal(2), z.literal(3)]).default(2), text: requiredText(200) }),
  z.object({ type: z.literal("paragraph"), id: clientId, markdown: requiredMarkdown(CMS_LIMITS.markdownBlock) }),
  z.object({ type: z.literal("image"), id: clientId, ...imageItem.shape }),
  z.object({
    type: z.literal("gallery"),
    id: clientId,
    images: z.array(imageItem).min(1).max(CMS_LIMITS.galleryImages),
  }),
  z.object({
    type: z.literal("button"),
    id: clientId,
    label: requiredText(CMS_LIMITS.label),
    href: hrefSchema,
    style: z.enum(["primary", "secondary"]).default("primary"),
  }),
  z.object({
    type: z.literal("faq"),
    id: clientId,
    items: z
      .array(z.object({ q: requiredText(300), a: requiredMarkdown(3000) }))
      .min(1)
      .max(CMS_LIMITS.faqItems),
  }),
  z.object({ type: z.literal("video"), id: clientId, youtubeId: youtubeIdSchema, title: text(200).optional() }),
  z.object({ type: z.literal("divider"), id: clientId }),
  z.object({ type: z.literal("enquiry-form"), ...enquiryFormFields }),
]);
export type Block = z.output<typeof blockSchema>;
export type BlockInput = z.input<typeof blockSchema>;

export const blocksSchema = z.array(blockSchema).max(CMS_LIMITS.blocks);

// ------------------------------------------------------------------ menus

export const MENU_KEYS = ["header", "footer"] as const;
export type MenuKey = (typeof MENU_KEYS)[number];
export const menuKeySchema = z.enum(MENU_KEYS);

export const MENU_ITEM_TYPES = ["url", "page", "category", "collection", "post"] as const;
export type MenuItemType = (typeof MENU_ITEM_TYPES)[number];

const menuItemBase = z.object({
  id: clientId,
  label: requiredText(CMS_LIMITS.label),
  type: z.enum(MENU_ITEM_TYPES).default("url"),
  /** For `url`. */
  href: hrefSchema.optional(),
  /** Slug of the page, category, collection or post. */
  ref: refSlug.optional(),
});

function checkTarget(item: { type: MenuItemType; href?: string; ref?: string; children?: unknown[] }, ctx: z.RefinementCtx) {
  if (item.type === "url") {
    if (!item.href && !(item.children && item.children.length > 0))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["href"], message: "A link needs an address (or sub-items)" });
  } else if (!item.ref) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ref"], message: `Pick the ${item.type} to link to` });
  }
}

const menuChildSchema = menuItemBase
  .extend({ children: z.array(z.unknown()).max(0, "Menus nest at most 2 levels").optional() })
  .superRefine(checkTarget)
  .transform(({ children: _c, ...rest }) => rest);

export const menuItemSchema = menuItemBase
  .extend({ children: z.array(menuChildSchema).max(CMS_LIMITS.menuChildren).optional() })
  .superRefine(checkTarget);
export type MenuItem = z.output<typeof menuItemSchema>;
export type MenuItemInput = z.input<typeof menuItemSchema>;

/** `PUT /menus/:key` body: `{ items }`, at most 40 items counting sub-items, 2 levels deep. */
export const menuItemsSchema = z
  .array(menuItemSchema)
  .max(CMS_LIMITS.menuItems)
  .superRefine((items, ctx) => {
    const total = items.reduce((n, i) => n + 1 + (i.children?.length ?? 0), 0);
    if (total > CMS_LIMITS.menuItems)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `A menu holds at most ${CMS_LIMITS.menuItems} items (incl. sub-items)` });
  });
export const menuBodySchema = z.object({ items: menuItemsSchema });

// ------------------------------------------------------------------ pages & posts input

export const pageInputSchema = z.object({
  title: requiredText(CMS_LIMITS.title),
  /** Omitted → generated from the title. */
  slug: slugSchema.optional(),
  blocks: blocksSchema.default([]),
  seo: seoSchema.optional(),
});
export type PageInput = z.input<typeof pageInputSchema>;
export const pagePatchSchema = pageInputSchema.partial().extend({ seo: seoSchema.nullable().optional() });
export type PagePatch = z.input<typeof pagePatchSchema>;

const tag = z.string().trim().toLowerCase().min(1).max(40);
export const postInputSchema = z.object({
  title: requiredText(CMS_LIMITS.title),
  slug: slugSchema.optional(),
  excerpt: text(500).optional(),
  coverUrl: urlSchema.optional(),
  blocks: blocksSchema.default([]),
  tags: z
    .array(tag)
    .max(CMS_LIMITS.tags)
    .default([])
    .transform((t) => [...new Set(t)]),
  authorName: text(80).optional(),
  seo: seoSchema.optional(),
});
export type PostInput = z.input<typeof postInputSchema>;
export const postPatchSchema = postInputSchema
  .partial()
  .extend({
    excerpt: text(500).nullable().optional(),
    coverUrl: urlSchema.nullable().optional(),
    authorName: text(80).nullable().optional(),
    seo: seoSchema.nullable().optional(),
  });
export type PostPatch = z.input<typeof postPatchSchema>;

export const CONTENT_STATUSES = ["draft", "published"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const publicPostsQuerySchema = z.object({
  tag: tag.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type PublicPostsQuery = z.input<typeof publicPostsQuerySchema>;

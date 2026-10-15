import { z } from "zod";

/**
 * Zod schemas for everything shop owners edit: home sections, page/post blocks, menus and SEO overrides
 * (docs/commerce-batch2.md §4). Pure — no server imports.
 */

// ------------------------------------------------------------------ limits

export const CMS_LIMITS = {
  sections: 30,
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
] as const;
export type HomeSectionType = (typeof HOME_SECTION_TYPES)[number];

/** Hidden sections stay in the draft (and the published doc) but are skipped on the storefront. */
const sectionHidden = z.boolean().optional();

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
  slides: z.array(heroSlideSchema).min(1).max(CMS_LIMITS.heroSlides),
});

export const categoriesSectionSchema = z.object({
  type: z.literal("categories"),
  id: clientId,
  hidden: sectionHidden,
  title: text(CMS_LIMITS.heading).default(""),
  /** Which categories, in order; omitted = all (as the catalogue lists them). */
  categoryIds: z.array(uuid).max(CMS_LIMITS.ids).optional(),
});

export const collectionSectionSchema = z.object({
  type: z.literal("collection"),
  id: clientId,
  hidden: sectionHidden,
  title: text(CMS_LIMITS.heading).default(""),
  collectionSlug: refSlug,
  layout: z.enum(["carousel", "grid"]).default("carousel"),
  limit: z.coerce.number().int().min(1).max(CMS_LIMITS.collectionLimit).default(12),
});

export const productsSectionSchema = z.object({
  type: z.literal("products"),
  id: clientId,
  hidden: sectionHidden,
  title: text(CMS_LIMITS.heading).default(""),
  productIds: z.array(uuid).min(1).max(CMS_LIMITS.ids),
});

export const bannerSectionSchema = z.object({
  type: z.literal("banner"),
  id: clientId,
  hidden: sectionHidden,
  imageUrl: urlSchema,
  mobileImageUrl: urlSchema.optional(),
  href: hrefSchema.optional(),
  alt: text(CMS_LIMITS.alt).default(""),
});

export const textSectionSchema = z.object({
  type: z.literal("text"),
  id: clientId,
  hidden: sectionHidden,
  heading: text(CMS_LIMITS.heading).optional(),
  markdown: requiredMarkdown(CMS_LIMITS.markdownSection),
});

export const imageTextSectionSchema = z.object({
  type: z.literal("image-text"),
  id: clientId,
  hidden: sectionHidden,
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
  title: text(CMS_LIMITS.heading).optional(),
  items: z
    .array(z.object({ quote: requiredText(600), name: requiredText(80) }))
    .min(1)
    .max(CMS_LIMITS.sectionItems),
});

/** Icon keys the storefront knows (free shipping, COD, returns …); unknown keys render a generic icon. */
export const USP_ICONS = ["truck", "cash", "return", "shield", "star", "gift", "phone", "leaf", "clock", "tag", "heart", "check"] as const;

export const uspSectionSchema = z.object({
  type: z.literal("usp"),
  id: clientId,
  hidden: sectionHidden,
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

export const newsletterSectionSchema = z.object({
  type: z.literal("newsletter"),
  id: clientId,
  hidden: sectionHidden,
  heading: requiredText(CMS_LIMITS.heading),
  text: text(400).default(""),
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

/** What `PUT /home` takes and the draft/published columns hold. */
export const homeDocSchema = z.object({
  sections: z.array(homeSectionSchema).max(CMS_LIMITS.sections),
  seo: seoSchema.optional(),
});
export type HomeDoc = z.output<typeof homeDocSchema>;
export type HomeDocInput = z.input<typeof homeDocSchema>;

// ------------------------------------------------------------------ page / post blocks

export const BLOCK_TYPES = ["heading", "paragraph", "image", "gallery", "button", "faq", "video", "divider"] as const;
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

export const staffListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(CONTENT_STATUSES).optional(),
  tag: tag.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type StaffListQuery = z.input<typeof staffListQuerySchema>;

export const publicPostsQuerySchema = z.object({
  tag: tag.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export type PublicPostsQuery = z.input<typeof publicPostsQuerySchema>;

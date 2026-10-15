/**
 * Home-section form model: every input is a plain string (or a list), so the editor never holds `undefined`, and
 * `fromSectionForm` turns it back into exactly what `homeSectionSchema` accepts (empty optional fields are omitted).
 * Round-trips are unit-tested for every section type. Pure — no React.
 */
import {
  CMS_LIMITS,
  homeSectionSchema,
  USP_ICONS,
  type HomeSection,
  type HomeSectionInput,
  type HomeSectionType,
} from "./content";
import type { CategoryRef, PublicProductSummary, ResolvedHomeSection } from "./types";

export interface SlideForm {
  imageUrl: string;
  mobileImageUrl: string;
  heading: string;
  subheading: string;
  ctaLabel: string;
  ctaHref: string;
}

export type SectionForm =
  | { type: "hero"; id?: string; slides: SlideForm[] }
  | { type: "categories"; id?: string; title: string; mode: "all" | "pick"; categoryIds: string[] }
  | { type: "collection"; id?: string; title: string; collectionSlug: string; layout: "carousel" | "grid"; limit: string }
  | { type: "products"; id?: string; title: string; productIds: string[] }
  | { type: "banner"; id?: string; imageUrl: string; mobileImageUrl: string; href: string; alt: string }
  | { type: "text"; id?: string; heading: string; markdown: string }
  | {
      type: "image-text";
      id?: string;
      imageUrl: string;
      heading: string;
      markdown: string;
      ctaLabel: string;
      ctaHref: string;
      imageSide: "left" | "right";
    }
  | { type: "testimonials"; id?: string; title: string; items: { quote: string; name: string }[] }
  | { type: "usp"; id?: string; items: { icon: string; title: string; text: string }[] }
  | { type: "newsletter"; id?: string; heading: string; text: string };

export type FormOf<T extends HomeSectionType> = Extract<SectionForm, { type: T }>;

const s = (v: string | null | undefined) => v ?? "";
const idOf = (id: string | undefined) => (id ? { id } : {});
/** Optional string: omitted when blank. */
const opt = <K extends string>(key: K, v: string) => (v.trim() ? ({ [key]: v.trim() } as Record<K, string>) : {});
/** Optional CTA: omitted when both parts are blank; otherwise both are sent (the schema reports the missing one). */
const cta = (label: string, href: string) => (label.trim() || href.trim() ? { cta: { label: label.trim(), href: href.trim() } } : {});

export const emptySlide = (): SlideForm => ({ imageUrl: "", mobileImageUrl: "", heading: "", subheading: "", ctaLabel: "", ctaHref: "" });

/** Stored/parsed section → editor form. */
export function toSectionForm(section: HomeSection | HomeSectionInput): SectionForm {
  const x = section as HomeSection;
  switch (x.type) {
    case "hero":
      return {
        type: "hero",
        ...idOf(x.id),
        slides: x.slides.map((sl) => ({
          imageUrl: s(sl.imageUrl),
          mobileImageUrl: s(sl.mobileImageUrl),
          heading: s(sl.heading),
          subheading: s(sl.subheading),
          ctaLabel: s(sl.cta?.label),
          ctaHref: s(sl.cta?.href),
        })),
      };
    case "categories":
      return {
        type: "categories",
        ...idOf(x.id),
        title: s(x.title),
        mode: x.categoryIds && x.categoryIds.length > 0 ? "pick" : "all",
        categoryIds: [...(x.categoryIds ?? [])],
      };
    case "collection":
      return {
        type: "collection",
        ...idOf(x.id),
        title: s(x.title),
        collectionSlug: s(x.collectionSlug),
        layout: x.layout ?? "carousel",
        limit: String(x.limit ?? 12),
      };
    case "products":
      return { type: "products", ...idOf(x.id), title: s(x.title), productIds: [...x.productIds] };
    case "banner":
      return { type: "banner", ...idOf(x.id), imageUrl: s(x.imageUrl), mobileImageUrl: s(x.mobileImageUrl), href: s(x.href), alt: s(x.alt) };
    case "text":
      return { type: "text", ...idOf(x.id), heading: s(x.heading), markdown: s(x.markdown) };
    case "image-text":
      return {
        type: "image-text",
        ...idOf(x.id),
        imageUrl: s(x.imageUrl),
        heading: s(x.heading),
        markdown: s(x.markdown),
        ctaLabel: s(x.cta?.label),
        ctaHref: s(x.cta?.href),
        imageSide: x.imageSide ?? "left",
      };
    case "testimonials":
      return { type: "testimonials", ...idOf(x.id), title: s(x.title), items: x.items.map((i) => ({ quote: s(i.quote), name: s(i.name) })) };
    case "usp":
      return { type: "usp", ...idOf(x.id), items: x.items.map((i) => ({ icon: s(i.icon), title: s(i.title), text: s(i.text) })) };
    case "newsletter":
      return { type: "newsletter", ...idOf(x.id), heading: s(x.heading), text: s(x.text) };
  }
}

/** Editor form → `homeSectionSchema` input (not yet validated). */
export function fromSectionForm(f: SectionForm): HomeSectionInput {
  switch (f.type) {
    case "hero":
      return {
        type: "hero",
        ...idOf(f.id),
        slides: f.slides.map((sl) => ({
          // No image → null: the storefront shows a branded gradient.
          imageUrl: sl.imageUrl.trim() || null,
          ...opt("mobileImageUrl", sl.mobileImageUrl),
          ...opt("heading", sl.heading),
          ...opt("subheading", sl.subheading),
          ...cta(sl.ctaLabel, sl.ctaHref),
        })),
      };
    case "categories":
      return {
        type: "categories",
        ...idOf(f.id),
        title: f.title.trim(),
        ...(f.mode === "pick" && f.categoryIds.length > 0 ? { categoryIds: [...f.categoryIds] } : {}),
      };
    case "collection": {
      const n = Number(f.limit.trim());
      return {
        type: "collection",
        ...idOf(f.id),
        title: f.title.trim(),
        collectionSlug: f.collectionSlug.trim(),
        layout: f.layout,
        limit: f.limit.trim() === "" || !Number.isFinite(n) ? (f.limit as unknown as number) : n,
      };
    }
    case "products":
      return { type: "products", ...idOf(f.id), title: f.title.trim(), productIds: [...f.productIds] };
    case "banner":
      return { type: "banner", ...idOf(f.id), imageUrl: f.imageUrl.trim(), ...opt("mobileImageUrl", f.mobileImageUrl), ...opt("href", f.href), alt: f.alt.trim() };
    case "text":
      return { type: "text", ...idOf(f.id), ...opt("heading", f.heading), markdown: f.markdown };
    case "image-text":
      return {
        type: "image-text",
        ...idOf(f.id),
        imageUrl: f.imageUrl.trim(),
        heading: f.heading.trim(),
        markdown: f.markdown,
        ...cta(f.ctaLabel, f.ctaHref),
        imageSide: f.imageSide,
      };
    case "testimonials":
      return { type: "testimonials", ...idOf(f.id), ...opt("title", f.title), items: f.items.map((i) => ({ quote: i.quote.trim(), name: i.name.trim() })) };
    case "usp":
      return { type: "usp", ...idOf(f.id), items: f.items.map((i) => ({ icon: i.icon.trim().toLowerCase(), title: i.title.trim(), text: i.text.trim() })) };
    case "newsletter":
      return { type: "newsletter", ...idOf(f.id), heading: f.heading.trim(), text: f.text.trim() };
  }
}

/** Field errors keyed by the editor's field path ("slides.0.ctaHref", "items.1.quote", "productIds" …). */
export type FieldErrors = Record<string, string>;

/** Maps a zod issue path on the schema shape to the form's field path (CTA parts are flat in the form). */
export function formPath(path: readonly (string | number)[]): string {
  const p = path.map(String);
  const i = p.indexOf("cta");
  if (i >= 0) {
    const part = p[i + 1] === "href" ? "ctaHref" : "ctaLabel";
    return [...p.slice(0, i), part].join(".");
  }
  return p.join(".");
}

export type SectionCheck = { ok: true; value: HomeSection; errors: FieldErrors } | { ok: false; errors: FieldErrors };

/** Validates a form with the cms schema. Error messages are the schema's (English); the UI maps them to keys by code. */
export function checkSection(f: SectionForm): SectionCheck {
  const r = homeSectionSchema.safeParse(fromSectionForm(f));
  if (r.success) return { ok: true, value: r.data, errors: {} };
  const errors: FieldErrors = {};
  for (const issue of r.error.issues) {
    const key = formPath(issue.path) || "_";
    if (!errors[key]) errors[key] = issueCode(issue);
  }
  return { ok: false, errors };
}

/** Short, translatable reason for an issue: "required", "tooLong", "url", "tooMany", "invalid". */
export function issueCode(issue: { code: string; message: string; type?: string; minimum?: unknown; maximum?: unknown }): string {
  if (issue.code === "too_small") return issue.type === "array" ? "minItems" : "required";
  if (issue.code === "too_big") return issue.type === "array" ? "tooMany" : issue.type === "number" ? "tooBig" : "tooLong";
  if (issue.code === "invalid_type") return issue.message === "Required" ? "required" : "invalid";
  if (issue.code === "custom") {
    if (/http\(s\) URL/.test(issue.message)) return "url";
    if (issue.message === "Required") return "required";
  }
  if (issue.code === "invalid_string" && /Icon/.test(issue.message)) return "invalid";
  if (issue.code === "invalid_string") return "invalid";
  return "invalid";
}

// ---------------------------------------------------------------- new sections

export interface SectionSamples {
  heroHeading: string;
  heroSubheading: string;
  shopNow: string;
  categoriesTitle: string;
  productsTitle: string;
  textHeading: string;
  textBody: string;
  imageTextHeading: string;
  testimonialsTitle: string;
  testimonialQuote: string;
  testimonialName: string;
  uspFreeShipping: string;
  uspFreeShippingText: string;
  uspCod: string;
  uspCodText: string;
  uspReturns: string;
  uspReturnsText: string;
  newsletterHeading: string;
  newsletterText: string;
}

let seq = 0;
/** Short client id for new sections ("s-k3j9x2"), sent with the section so preview/storefront keys stay stable. */
export const newSectionId = () => `s-${Date.now().toString(36).slice(-4)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** A fresh section of `type` with friendly starting text (images still need choosing). */
export function newSectionForm(type: HomeSectionType, x: SectionSamples, id: string = newSectionId()): SectionForm {
  switch (type) {
    case "hero":
      return { type, id, slides: [{ ...emptySlide(), heading: x.heroHeading, subheading: x.heroSubheading, ctaLabel: x.shopNow, ctaHref: "/products" }] };
    case "categories":
      return { type, id, title: x.categoriesTitle, mode: "all", categoryIds: [] };
    case "collection":
      return { type, id, title: "", collectionSlug: "", layout: "carousel", limit: "12" };
    case "products":
      return { type, id, title: x.productsTitle, productIds: [] };
    case "banner":
      return { type, id, imageUrl: "", mobileImageUrl: "", href: "", alt: "" };
    case "text":
      return { type, id, heading: x.textHeading, markdown: x.textBody };
    case "image-text":
      return { type, id, imageUrl: "", heading: x.imageTextHeading, markdown: x.textBody, ctaLabel: "", ctaHref: "", imageSide: "left" };
    case "testimonials":
      return { type, id, title: x.testimonialsTitle, items: [{ quote: x.testimonialQuote, name: x.testimonialName }] };
    case "usp":
      return {
        type,
        id,
        items: [
          { icon: "truck", title: x.uspFreeShipping, text: x.uspFreeShippingText },
          { icon: "cash", title: x.uspCod, text: x.uspCodText },
          { icon: "return", title: x.uspReturns, text: x.uspReturnsText },
        ],
      };
    case "newsletter":
      return { type, id, heading: x.newsletterHeading, text: x.newsletterText };
  }
}

/** Copy with a new id (Duplicate). */
export function duplicateSectionForm(f: SectionForm, id: string = newSectionId()): SectionForm {
  return { ...(JSON.parse(JSON.stringify(f)) as SectionForm), id };
}

/** Item limits per list field, for "Add" buttons. */
export const SECTION_LIST_LIMITS = {
  slides: CMS_LIMITS.heroSlides,
  testimonials: CMS_LIMITS.sectionItems,
  usps: CMS_LIMITS.usps,
  ids: CMS_LIMITS.ids,
  collectionLimit: CMS_LIMITS.collectionLimit,
} as const;

/**
 * USP icon keys the storefront knows, plus aliases older content used (the demo store has "free-shipping", "cod",
 * "returns"). Unknown keys still save (the storefront shows a generic icon).
 */
export const USP_ICON_KEYS = USP_ICONS;
export const USP_ICON_ALIASES: Record<string, (typeof USP_ICONS)[number]> = {
  "free-shipping": "truck",
  shipping: "truck",
  delivery: "truck",
  cod: "cash",
  "cash-on-delivery": "cash",
  returns: "return",
  "easy-returns": "return",
  secure: "shield",
  quality: "star",
  support: "phone",
  organic: "leaf",
  fast: "clock",
  offer: "tag",
  offers: "tag",
};
export const uspIconKey = (icon: string): (typeof USP_ICONS)[number] | null => {
  const k = icon.trim().toLowerCase();
  return (USP_ICONS as readonly string[]).includes(k) ? (k as (typeof USP_ICONS)[number]) : (USP_ICON_ALIASES[k] ?? null);
};

// ---------------------------------------------------------------- live preview (local resolution)

export interface PreviewLookups {
  /** Store categories in catalogue order (undefined while loading). */
  categories?: CategoryRef[];
  products: ReadonlyMap<string, PublicProductSummary>;
  collections: ReadonlyMap<string, { name: string; slug: string; products: PublicProductSummary[] }>;
}

/** Same cap as the storefront when a categories section lists "all". */
export const ALL_CATEGORIES_LIMIT = 24;

/**
 * Approximates what the storefront will show for unsaved edits: static sections come straight from the form;
 * catalogue sections use data the editor already loaded. Incomplete sections still render (with empty lists or a
 * missing image), so the owner sees where they are; the storefront itself drops empty catalogue sections.
 */
export function resolvePreview(forms: readonly SectionForm[], lk: PreviewLookups): ResolvedHomeSection[] {
  return forms.map((f): ResolvedHomeSection => {
    const id = f.id ? { id: f.id } : {};
    switch (f.type) {
      case "hero":
        return {
          type: "hero",
          ...id,
          slides: f.slides.map((sl) => ({
            imageUrl: sl.imageUrl.trim() || null,
            ...opt("mobileImageUrl", sl.mobileImageUrl),
            ...opt("heading", sl.heading),
            ...opt("subheading", sl.subheading),
            ...(sl.ctaLabel.trim() ? { cta: { label: sl.ctaLabel.trim(), href: sl.ctaHref.trim() || "#" } } : {}),
          })),
        };
      case "categories": {
        const all = lk.categories ?? [];
        const byId = new Map(all.map((c) => [c.id, c]));
        const categories =
          f.mode === "pick" && f.categoryIds.length
            ? f.categoryIds.map((cid) => byId.get(cid)).filter((c): c is CategoryRef => !!c)
            : all.slice(0, ALL_CATEGORIES_LIMIT);
        return { type: "categories", ...id, title: f.title.trim(), categories };
      }
      case "collection": {
        const c = lk.collections.get(f.collectionSlug.trim());
        const limit = Math.max(1, Math.min(CMS_LIMITS.collectionLimit, Number(f.limit) || 12));
        return {
          type: "collection",
          ...id,
          title: f.title.trim() || c?.name || "",
          layout: f.layout,
          collection: { name: c?.name ?? "", slug: f.collectionSlug.trim() },
          products: (c?.products ?? []).slice(0, limit),
        };
      }
      case "products":
        return {
          type: "products",
          ...id,
          title: f.title.trim(),
          products: f.productIds.map((pid) => lk.products.get(pid)).filter((p): p is PublicProductSummary => !!p),
        };
      case "banner":
        return { type: "banner", ...id, imageUrl: f.imageUrl.trim(), ...opt("mobileImageUrl", f.mobileImageUrl), ...opt("href", f.href), alt: f.alt.trim() };
      case "text":
        return { type: "text", ...id, ...opt("heading", f.heading), markdown: f.markdown };
      case "image-text":
        return {
          type: "image-text",
          ...id,
          imageUrl: f.imageUrl.trim(),
          heading: f.heading.trim(),
          markdown: f.markdown,
          ...(f.ctaLabel.trim() ? { cta: { label: f.ctaLabel.trim(), href: f.ctaHref.trim() || "#" } } : {}),
          imageSide: f.imageSide,
        };
      case "testimonials":
        return { type: "testimonials", ...id, ...opt("title", f.title), items: f.items.filter((i) => i.quote.trim()).map((i) => ({ quote: i.quote.trim(), name: i.name.trim() })) };
      case "usp":
        return { type: "usp", ...id, items: f.items.filter((i) => i.title.trim()).map((i) => ({ icon: i.icon, title: i.title.trim(), text: i.text.trim() })) };
      case "newsletter":
        return { type: "newsletter", ...id, heading: f.heading.trim(), text: f.text.trim() };
    }
  });
}

/** Ids of every product / category / collection the forms reference (what the preview has to load). */
export function referencedIds(forms: readonly SectionForm[]) {
  const products = new Set<string>();
  const collections = new Set<string>();
  let categories = false;
  for (const f of forms) {
    if (f.type === "products") f.productIds.forEach((id) => products.add(id));
    else if (f.type === "collection" && f.collectionSlug.trim()) collections.add(f.collectionSlug.trim());
    else if (f.type === "categories") categories = true;
  }
  return { products: [...products], collections: [...collections], categories };
}

/**
 * Home-section form model: every input is a plain string (or a list), so the editor never holds `undefined`, and
 * `fromSectionForm` turns it back into exactly what `homeSectionSchema` accepts (empty optional fields are omitted).
 * Round-trips are unit-tested for every section type. Pure — no React.
 */
import {
  CMS_LIMITS,
  homeSectionSchema,
  USP_ICONS,
  type CATEGORY_COLUMNS,
  type CATEGORY_LAYOUTS,
  type NEWSLETTER_LAYOUTS,
  type PRODUCT_TAB_SOURCES,
  type SHELF_LAYOUTS,
  type USP_LAYOUTS,
  type HomeSection,
  type HomeSectionInput,
  type HomeSectionType,
  type SectionStyle,
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

/** The shared look of a section; "" = the theme's default. */
export interface StyleForm {
  background: "" | NonNullable<SectionStyle["background"]>;
  imageUrl: string;
  overlay: string;
  padding: "" | NonNullable<SectionStyle["padding"]>;
  width: "" | NonNullable<SectionStyle["width"]>;
  align: "" | NonNullable<SectionStyle["align"]>;
  animation: "" | NonNullable<SectionStyle["animation"]>;
  hideOnMobile: boolean;
  hideOnDesktop: boolean;
}

export type Diet = "" | "veg" | "nonveg" | "egg";
export interface TestimonialForm {
  quote: string;
  name: string;
  role: string;
  /** "" or "1"–"5". */
  rating: string;
  photoUrl: string;
}
export interface DishForm {
  name: string;
  description: string;
  /** Rupees as typed ("45", "45.50"); stored in paise. */
  price: string;
  diet: Diet;
}

export type CategoryLayout = (typeof CATEGORY_LAYOUTS)[number];
export type CategoryColumns = (typeof CATEGORY_COLUMNS)[number];
export type UspLayout = (typeof USP_LAYOUTS)[number];
export type NewsletterLayout = (typeof NEWSLETTER_LAYOUTS)[number];
export type ShelfLayout = (typeof SHELF_LAYOUTS)[number];
export type TabSource = (typeof PRODUCT_TAB_SOURCES)[number];
export interface TabForm {
  label: string;
  source: TabSource;
  collectionSlug: string;
}
export interface HotspotForm {
  /** % from the left / top, as typed or placed by clicking the picture. */
  x: string;
  y: string;
  productId: string;
}
export interface StatForm {
  value: string;
  prefix: string;
  suffix: string;
  label: string;
}
export interface MilestoneForm {
  when: string;
  title: string;
  text: string;
  imageUrl: string;
}
export interface MemberForm {
  name: string;
  role: string;
  photoUrl: string;
  bio: string;
  instagram: string;
  facebook: string;
  linkedin: string;
  website: string;
}
export interface PlanForm {
  name: string;
  /** Rupees as typed; "" = "Ask us". */
  price: string;
  period: string;
  description: string;
  /** One feature per line. */
  features: string;
  highlight: boolean;
  badge: string;
  ctaLabel: string;
  ctaHref: string;
}

type Forms =
  | { type: "hero"; id?: string; slides: SlideForm[] }
  | { type: "categories"; id?: string; title: string; mode: "all" | "pick"; categoryIds: string[]; layout: CategoryLayout; showCounts: boolean; columns: CategoryColumns }
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
  | { type: "testimonials"; id?: string; title: string; layout: "carousel" | "cards" | "single"; items: TestimonialForm[] }
  | { type: "usp"; id?: string; title: string; text: string; layout: UspLayout; items: { icon: string; title: string; text: string }[] }
  | { type: "newsletter"; id?: string; heading: string; text: string; layout: NewsletterLayout; imageUrl: string }
  | {
      type: "hero-split";
      id?: string;
      imageUrl: string;
      imageSide: "left" | "right";
      eyebrow: string;
      heading: string;
      text: string;
      ctaLabel: string;
      ctaHref: string;
      cta2Label: string;
      cta2Href: string;
    }
  | { type: "hero-video"; id?: string; videoUrl: string; posterUrl: string; overlay: string; heading: string; text: string; ctaLabel: string; ctaHref: string }
  | { type: "offer"; id?: string; eyebrow: string; heading: string; text: string; code: string; /** `datetime-local` value, local time. */ endsAt: string; ctaLabel: string; ctaHref: string }
  | { type: "gallery"; id?: string; title: string; layout: "grid" | "masonry" | "carousel"; images: { url: string; alt: string; caption: string; href: string }[] }
  | { type: "logos"; id?: string; title: string; grayscale: boolean; items: { imageUrl: string; name: string; href: string }[] }
  | { type: "category-mosaic"; id?: string; title: string; categoryIds: string[] }
  | { type: "faq"; id?: string; title: string; items: { q: string; a: string }[] }
  | {
      type: "location";
      id?: string;
      title: string;
      address: string;
      hours: { label: string; value: string }[];
      phone: string;
      whatsapp: string;
      coords: string;
      mapLink: string;
    }
  | { type: "menu-board"; id?: string; title: string; groups: { name: string; items: DishForm[] }[]; ctaLabel: string; ctaHref: string }
  | { type: "appointment"; id?: string; heading: string; text: string; services: { name: string; duration: string; price: string }[]; ctaLabel: string; ctaHref: string }
  | { type: "before-after"; id?: string; title: string; text: string; beforeUrl: string; afterUrl: string; beforeLabel: string; afterLabel: string }
  | { type: "gold-rates"; id?: string; title: string; text: string; showSilver: boolean }
  | { type: "instagram"; id?: string; title: string; handle: string; images: { url: string; alt: string; href: string }[] }
  | { type: "product-tabs"; id?: string; title: string; layout: ShelfLayout; limit: string; tabs: TabForm[] }
  | { type: "deal"; id?: string; title: string; text: string; productId: string; /** `datetime-local` value, local time. */ endsAt: string }
  | { type: "shop-the-look"; id?: string; title: string; text: string; imageUrl: string; alt: string; hotspots: HotspotForm[] }
  | { type: "bestsellers"; id?: string; title: string; layout: ShelfLayout; limit: string }
  | { type: "recently-viewed"; id?: string; title: string }
  | { type: "recommended"; id?: string; title: string; layout: ShelfLayout; limit: string }
  | { type: "stats"; id?: string; title: string; text: string; items: StatForm[] }
  | { type: "timeline"; id?: string; title: string; text: string; items: MilestoneForm[] }
  | { type: "team"; id?: string; title: string; text: string; members: MemberForm[] }
  | { type: "pricing-table"; id?: string; title: string; text: string; plans: PlanForm[] }
  | { type: "blog-posts"; id?: string; title: string; limit: string; tag: string }
  | { type: "reviews-summary"; id?: string; title: string; limit: string };

/** One section in the editor: its own fields plus the shared style (all "" = theme defaults). */
export type SectionForm = Forms & { style?: StyleForm };

export type FormOf<T extends HomeSectionType> = Extract<SectionForm, { type: T }>;

const s = (v: string | null | undefined) => v ?? "";
const idOf = (id: string | undefined) => (id ? { id } : {});
/** Optional string: omitted when blank. */
const opt = <K extends string>(key: K, v: string) => (v.trim() ? ({ [key]: v.trim() } as Record<K, string>) : {});
/** Optional CTA: omitted when both parts are blank; otherwise both are sent (the schema reports the missing one). */
const cta = (label: string, href: string, key: "cta" | "cta2" = "cta") =>
  label.trim() || href.trim() ? { [key]: { label: label.trim(), href: href.trim() } } : {};
/** A typed number: omitted when blank, a number when it is one, else the raw text (the schema reports it). */
const num = <K extends string>(key: K, v: string) => {
  const x = v.trim();
  if (!x) return {};
  const n = Number(x);
  return { [key]: Number.isFinite(n) ? n : x } as Record<K, number>;
};
/** Rupees typed in the editor → paise (omitted when blank; raw text when it isn't a number). */
const rupees = (v: string) => {
  const x = v.trim().replace(/[₹,\s]/g, "");
  if (!x) return {};
  const n = Number(x);
  return { price: Number.isFinite(n) ? Math.round(n * 100) : (x as unknown as number) };
};
const toRupees = (paise: number | undefined) => (paise === undefined ? "" : String(Math.round(paise) / 100));

/** ISO date-time → `datetime-local` value in the browser's time zone ("2026-11-01T18:30"). */
export function isoToLocalInput(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** `datetime-local` value → ISO (UTC); unparsable input is passed on for the schema to reject. */
export function localInputToIso(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}

export const emptySlide = (): SlideForm => ({ imageUrl: "", mobileImageUrl: "", heading: "", subheading: "", ctaLabel: "", ctaHref: "" });
export const emptyStyle = (): StyleForm => ({ background: "", imageUrl: "", overlay: "", padding: "", width: "", align: "", animation: "", hideOnMobile: false, hideOnDesktop: false });
export const emptyTestimonial = (): TestimonialForm => ({ quote: "", name: "", role: "", rating: "", photoUrl: "" });
export const emptyDish = (): DishForm => ({ name: "", description: "", price: "", diet: "" });
export const emptyTab = (source: TabSource = "new"): TabForm => ({ label: "", source, collectionSlug: "" });
export const emptyStat = (): StatForm => ({ value: "", prefix: "", suffix: "", label: "" });
export const emptyMilestone = (): MilestoneForm => ({ when: "", title: "", text: "", imageUrl: "" });
export const emptyMember = (): MemberForm => ({ name: "", role: "", photoUrl: "", bio: "", instagram: "", facebook: "", linkedin: "", website: "" });
export const emptyPlan = (): PlanForm => ({ name: "", price: "", period: "", description: "", features: "", highlight: false, badge: "", ctaLabel: "", ctaHref: "" });
/** A typed count ("8") → number, or the raw text for the schema to report. */
const count = (v: string) => {
  const x = v.trim();
  const n = Number(x);
  return x !== "" && Number.isFinite(n) ? n : (x as unknown as number);
};

export function toStyleForm(st: SectionStyle | undefined): StyleForm {
  return {
    background: st?.background ?? "",
    imageUrl: s(st?.imageUrl),
    overlay: st?.overlay === undefined ? "" : String(st.overlay),
    padding: st?.padding ?? "",
    width: st?.width ?? "",
    align: st?.align ?? "",
    animation: st?.animation ?? "",
    hideOnMobile: st?.hideOnMobile === true,
    hideOnDesktop: st?.hideOnDesktop === true,
  };
}

/** Style form → the schema's `style` (only the fields that differ from the default; undefined when none do). */
export function fromStyleForm(f: StyleForm | undefined): Record<string, unknown> | undefined {
  if (!f) return undefined;
  const out: Record<string, unknown> = {
    ...(f.background ? { background: f.background } : {}),
    // The picture and its overlay only matter for a picture background.
    ...(f.background === "image" ? { ...opt("imageUrl", f.imageUrl), ...num("overlay", f.overlay) } : {}),
    ...(f.padding ? { padding: f.padding } : {}),
    ...(f.width ? { width: f.width } : {}),
    ...(f.align ? { align: f.align } : {}),
    ...(f.animation ? { animation: f.animation } : {}),
    ...(f.hideOnMobile ? { hideOnMobile: true } : {}),
    ...(f.hideOnDesktop ? { hideOnDesktop: true } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/** True when the style is all defaults. */
export const isDefaultStyle = (f: StyleForm | undefined) => fromStyleForm(f) === undefined;

/** Stored/parsed section → editor form. */
export function toSectionForm(section: HomeSection | HomeSectionInput): SectionForm {
  return { ...toFields(section), style: toStyleForm((section as HomeSection).style) } as SectionForm;
}

function toFields(section: HomeSection | HomeSectionInput): Forms {
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
        layout: x.layout ?? "circles",
        showCounts: x.showCounts === true,
        columns: x.columns ?? "auto",
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
      return {
        type: "testimonials",
        ...idOf(x.id),
        title: s(x.title),
        layout: x.layout ?? "carousel",
        items: x.items.map((i) => ({ quote: s(i.quote), name: s(i.name), role: s(i.role), rating: i.rating ? String(i.rating) : "", photoUrl: s(i.photoUrl) })),
      };
    case "usp":
      return { type: "usp", ...idOf(x.id), title: s(x.title), text: s(x.text), layout: x.layout ?? "cards", items: x.items.map((i) => ({ icon: s(i.icon), title: s(i.title), text: s(i.text) })) };
    case "newsletter":
      return { type: "newsletter", ...idOf(x.id), heading: s(x.heading), text: s(x.text), layout: x.layout ?? "band", imageUrl: s(x.imageUrl) };
    case "hero-split":
      return {
        type: "hero-split",
        ...idOf(x.id),
        imageUrl: s(x.imageUrl),
        imageSide: x.imageSide ?? "right",
        eyebrow: s(x.eyebrow),
        heading: s(x.heading),
        text: s(x.text),
        ctaLabel: s(x.cta?.label),
        ctaHref: s(x.cta?.href),
        cta2Label: s(x.cta2?.label),
        cta2Href: s(x.cta2?.href),
      };
    case "hero-video":
      return {
        type: "hero-video",
        ...idOf(x.id),
        videoUrl: s(x.videoUrl),
        posterUrl: s(x.posterUrl),
        overlay: String(x.overlay ?? 45),
        heading: s(x.heading),
        text: s(x.text),
        ctaLabel: s(x.cta?.label),
        ctaHref: s(x.cta?.href),
      };
    case "offer":
      return {
        type: "offer",
        ...idOf(x.id),
        eyebrow: s(x.eyebrow),
        heading: s(x.heading),
        text: s(x.text),
        code: s(x.code),
        endsAt: isoToLocalInput(x.endsAt),
        ctaLabel: s(x.cta?.label),
        ctaHref: s(x.cta?.href),
      };
    case "gallery":
      return {
        type: "gallery",
        ...idOf(x.id),
        title: s(x.title),
        layout: x.layout ?? "grid",
        images: x.images.map((i) => ({ url: s(i.url), alt: s(i.alt), caption: s(i.caption), href: s(i.href) })),
      };
    case "logos":
      return { type: "logos", ...idOf(x.id), title: s(x.title), grayscale: x.grayscale === true, items: x.items.map((i) => ({ imageUrl: s(i.imageUrl), name: s(i.name), href: s(i.href) })) };
    case "category-mosaic":
      return { type: "category-mosaic", ...idOf(x.id), title: s(x.title), categoryIds: [...(x.categoryIds ?? [])] };
    case "faq":
      return { type: "faq", ...idOf(x.id), title: s(x.title), items: x.items.map((i) => ({ q: s(i.q), a: s(i.a) })) };
    case "location":
      return {
        type: "location",
        ...idOf(x.id),
        title: s(x.title),
        address: s(x.address),
        hours: (x.hours ?? []).map((h) => ({ label: s(h.label), value: s(h.value) })),
        phone: s(x.phone),
        whatsapp: s(x.whatsapp),
        coords: s(x.coords),
        mapLink: s(x.mapLink),
      };
    case "menu-board":
      return {
        type: "menu-board",
        ...idOf(x.id),
        title: s(x.title),
        groups: x.groups.map((g) => ({
          name: s(g.name),
          items: g.items.map((d) => ({ name: s(d.name), description: s(d.description), price: toRupees(d.price), diet: d.diet ?? "" })),
        })),
        ctaLabel: s(x.cta?.label),
        ctaHref: s(x.cta?.href),
      };
    case "appointment":
      return {
        type: "appointment",
        ...idOf(x.id),
        heading: s(x.heading),
        text: s(x.text),
        services: (x.services ?? []).map((v) => ({ name: s(v.name), duration: s(v.duration), price: toRupees(v.price) })),
        ctaLabel: s(x.cta?.label),
        ctaHref: s(x.cta?.href),
      };
    case "before-after":
      return {
        type: "before-after",
        ...idOf(x.id),
        title: s(x.title),
        text: s(x.text),
        beforeUrl: s(x.beforeUrl),
        afterUrl: s(x.afterUrl),
        beforeLabel: s(x.beforeLabel),
        afterLabel: s(x.afterLabel),
      };
    case "gold-rates":
      return { type: "gold-rates", ...idOf(x.id), title: s(x.title), text: s(x.text), showSilver: x.showSilver !== false };
    case "instagram":
      return { type: "instagram", ...idOf(x.id), title: s(x.title), handle: s(x.handle), images: x.images.map((i) => ({ url: s(i.url), alt: s(i.alt), href: s(i.href) })) };
    case "product-tabs":
      return {
        type: "product-tabs",
        ...idOf(x.id),
        title: s(x.title),
        layout: x.layout ?? "grid",
        limit: String(x.limit ?? 8),
        tabs: x.tabs.map((tab) => ({ label: s(tab.label), source: tab.source, collectionSlug: s(tab.collectionSlug) })),
      };
    case "deal":
      return { type: "deal", ...idOf(x.id), title: s(x.title), text: s(x.text), productId: s(x.productId), endsAt: isoToLocalInput(x.endsAt) };
    case "shop-the-look":
      return {
        type: "shop-the-look",
        ...idOf(x.id),
        title: s(x.title),
        text: s(x.text),
        imageUrl: s(x.imageUrl),
        alt: s(x.alt),
        hotspots: x.hotspots.map((h) => ({ x: String(h.x), y: String(h.y), productId: s(h.productId) })),
      };
    case "bestsellers":
      return { type: "bestsellers", ...idOf(x.id), title: s(x.title), layout: x.layout ?? "carousel", limit: String(x.limit ?? 8) };
    case "recently-viewed":
      return { type: "recently-viewed", ...idOf(x.id), title: s(x.title) };
    case "recommended":
      return { type: "recommended", ...idOf(x.id), title: s(x.title), layout: x.layout ?? "carousel", limit: String(x.limit ?? 8) };
    case "stats":
      return { type: "stats", ...idOf(x.id), title: s(x.title), text: s(x.text), items: x.items.map((i) => ({ value: String(i.value), prefix: s(i.prefix), suffix: s(i.suffix), label: s(i.label) })) };
    case "timeline":
      return { type: "timeline", ...idOf(x.id), title: s(x.title), text: s(x.text), items: x.items.map((i) => ({ when: s(i.when), title: s(i.title), text: s(i.text), imageUrl: s(i.imageUrl) })) };
    case "team":
      return {
        type: "team",
        ...idOf(x.id),
        title: s(x.title),
        text: s(x.text),
        members: x.members.map((m) => ({
          name: s(m.name),
          role: s(m.role),
          photoUrl: s(m.photoUrl),
          bio: s(m.bio),
          instagram: s(m.instagram),
          facebook: s(m.facebook),
          linkedin: s(m.linkedin),
          website: s(m.website),
        })),
      };
    case "pricing-table":
      return {
        type: "pricing-table",
        ...idOf(x.id),
        title: s(x.title),
        text: s(x.text),
        plans: x.plans.map((p) => ({
          name: s(p.name),
          price: toRupees(p.price),
          period: s(p.period),
          description: s(p.description),
          features: (p.features ?? []).join("\n"),
          highlight: p.highlight === true,
          badge: s(p.badge),
          ctaLabel: s(p.cta?.label),
          ctaHref: s(p.cta?.href),
        })),
      };
    case "blog-posts":
      return { type: "blog-posts", ...idOf(x.id), title: s(x.title), limit: String(x.limit ?? 3), tag: s(x.tag) };
    case "reviews-summary":
      return { type: "reviews-summary", ...idOf(x.id), title: s(x.title), limit: String(x.limit ?? 6) };
  }
}

/** Editor form → `homeSectionSchema` input (not yet validated). */
export function fromSectionForm(f: SectionForm): HomeSectionInput {
  const style = fromStyleForm(f.style);
  const out = fromFields(f);
  return (style ? { ...out, style } : out) as HomeSectionInput;
}

function fromFields(f: Forms): HomeSectionInput {
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
        layout: f.layout,
        showCounts: f.showCounts,
        ...(f.columns !== "auto" ? { columns: f.columns } : {}),
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
      return {
        type: "testimonials",
        ...idOf(f.id),
        ...opt("title", f.title),
        layout: f.layout,
        items: f.items.map((i) => ({ quote: i.quote.trim(), name: i.name.trim(), ...opt("role", i.role), ...num("rating", i.rating), ...opt("photoUrl", i.photoUrl) })),
      };
    case "usp":
      return {
        type: "usp",
        ...idOf(f.id),
        ...opt("title", f.title),
        ...opt("text", f.text),
        layout: f.layout,
        items: f.items.map((i) => ({ icon: i.icon.trim().toLowerCase(), title: i.title.trim(), text: i.text.trim() })),
      };
    case "newsletter":
      return { type: "newsletter", ...idOf(f.id), heading: f.heading.trim(), text: f.text.trim(), layout: f.layout, ...opt("imageUrl", f.imageUrl) };
    case "hero-split":
      return {
        type: "hero-split",
        ...idOf(f.id),
        imageUrl: f.imageUrl.trim() || null,
        imageSide: f.imageSide,
        ...opt("eyebrow", f.eyebrow),
        heading: f.heading.trim(),
        ...opt("text", f.text),
        ...cta(f.ctaLabel, f.ctaHref),
        ...cta(f.cta2Label, f.cta2Href, "cta2"),
      };
    case "hero-video":
      return {
        type: "hero-video",
        ...idOf(f.id),
        videoUrl: f.videoUrl.trim(),
        ...opt("posterUrl", f.posterUrl),
        ...num("overlay", f.overlay),
        heading: f.heading.trim(),
        ...opt("text", f.text),
        ...cta(f.ctaLabel, f.ctaHref),
      };
    case "offer":
      return {
        type: "offer",
        ...idOf(f.id),
        ...opt("eyebrow", f.eyebrow),
        heading: f.heading.trim(),
        ...opt("text", f.text),
        ...opt("code", f.code),
        ...(f.endsAt.trim() ? { endsAt: localInputToIso(f.endsAt.trim()) } : {}),
        ...cta(f.ctaLabel, f.ctaHref),
      };
    case "gallery":
      return {
        type: "gallery",
        ...idOf(f.id),
        ...opt("title", f.title),
        layout: f.layout,
        images: f.images.map((i) => ({ url: i.url.trim(), alt: i.alt.trim(), ...opt("caption", i.caption), ...opt("href", i.href) })),
      };
    case "logos":
      return { type: "logos", ...idOf(f.id), ...opt("title", f.title), grayscale: f.grayscale, items: f.items.map((i) => ({ ...opt("imageUrl", i.imageUrl), name: i.name.trim(), ...opt("href", i.href) })) };
    case "category-mosaic":
      return { type: "category-mosaic", ...idOf(f.id), title: f.title.trim(), ...(f.categoryIds.length ? { categoryIds: [...f.categoryIds] } : {}) };
    case "faq":
      return { type: "faq", ...idOf(f.id), ...opt("title", f.title), items: f.items.map((i) => ({ q: i.q.trim(), a: i.a })) };
    case "location":
      return {
        type: "location",
        ...idOf(f.id),
        ...opt("title", f.title),
        ...opt("address", f.address),
        hours: f.hours.map((h) => ({ label: h.label.trim(), value: h.value.trim() })),
        ...opt("phone", f.phone),
        ...opt("whatsapp", f.whatsapp),
        ...opt("coords", f.coords),
        ...opt("mapLink", f.mapLink),
      };
    case "menu-board":
      return {
        type: "menu-board",
        ...idOf(f.id),
        ...opt("title", f.title),
        groups: f.groups.map((g) => ({
          name: g.name.trim(),
          items: g.items.map((d) => ({ name: d.name.trim(), ...opt("description", d.description), ...rupees(d.price), ...(d.diet ? { diet: d.diet } : {}) })),
        })),
        ...cta(f.ctaLabel, f.ctaHref),
      };
    case "appointment":
      return {
        type: "appointment",
        ...idOf(f.id),
        heading: f.heading.trim(),
        ...opt("text", f.text),
        services: f.services.map((v) => ({ name: v.name.trim(), ...opt("duration", v.duration), ...rupees(v.price) })),
        ...cta(f.ctaLabel, f.ctaHref),
      };
    case "before-after":
      return {
        type: "before-after",
        ...idOf(f.id),
        ...opt("title", f.title),
        ...opt("text", f.text),
        beforeUrl: f.beforeUrl.trim(),
        afterUrl: f.afterUrl.trim(),
        ...opt("beforeLabel", f.beforeLabel),
        ...opt("afterLabel", f.afterLabel),
      };
    case "gold-rates":
      return { type: "gold-rates", ...idOf(f.id), ...opt("title", f.title), ...opt("text", f.text), showSilver: f.showSilver };
    case "instagram":
      return {
        type: "instagram",
        ...idOf(f.id),
        ...opt("title", f.title),
        handle: f.handle.trim(),
        images: f.images.map((i) => ({ url: i.url.trim(), alt: i.alt.trim(), ...opt("href", i.href) })),
      };
    case "product-tabs":
      return {
        type: "product-tabs",
        ...idOf(f.id),
        title: f.title.trim(),
        layout: f.layout,
        limit: count(f.limit),
        tabs: f.tabs.map((tab) => ({ ...opt("label", tab.label), source: tab.source, ...opt("collectionSlug", tab.collectionSlug) })),
      };
    case "deal":
      return {
        type: "deal",
        ...idOf(f.id),
        ...opt("title", f.title),
        ...opt("text", f.text),
        productId: f.productId.trim(),
        ...(f.endsAt.trim() ? { endsAt: localInputToIso(f.endsAt.trim()) } : {}),
      };
    case "shop-the-look":
      return {
        type: "shop-the-look",
        ...idOf(f.id),
        ...opt("title", f.title),
        ...opt("text", f.text),
        imageUrl: f.imageUrl.trim(),
        alt: f.alt.trim(),
        hotspots: f.hotspots.map((h) => ({ x: count(h.x), y: count(h.y), productId: h.productId.trim() })),
      };
    case "bestsellers":
      return { type: "bestsellers", ...idOf(f.id), title: f.title.trim(), layout: f.layout, limit: count(f.limit) };
    case "recently-viewed":
      return { type: "recently-viewed", ...idOf(f.id), ...opt("title", f.title) };
    case "recommended":
      return { type: "recommended", ...idOf(f.id), title: f.title.trim(), layout: f.layout, limit: count(f.limit) };
    case "stats":
      return {
        type: "stats",
        ...idOf(f.id),
        ...opt("title", f.title),
        ...opt("text", f.text),
        items: f.items.map((i) => ({ value: count(i.value.replace(/[,\s]/g, "")), ...opt("prefix", i.prefix), ...opt("suffix", i.suffix), label: i.label.trim() })),
      };
    case "timeline":
      return {
        type: "timeline",
        ...idOf(f.id),
        ...opt("title", f.title),
        ...opt("text", f.text),
        items: f.items.map((i) => ({ when: i.when.trim(), title: i.title.trim(), text: i.text.trim(), ...opt("imageUrl", i.imageUrl) })),
      };
    case "team":
      return {
        type: "team",
        ...idOf(f.id),
        ...opt("title", f.title),
        ...opt("text", f.text),
        members: f.members.map((m) => ({
          name: m.name.trim(),
          ...opt("role", m.role),
          ...opt("photoUrl", m.photoUrl),
          ...opt("bio", m.bio),
          ...opt("instagram", m.instagram),
          ...opt("facebook", m.facebook),
          ...opt("linkedin", m.linkedin),
          ...opt("website", m.website),
        })),
      };
    case "pricing-table":
      return {
        type: "pricing-table",
        ...idOf(f.id),
        ...opt("title", f.title),
        ...opt("text", f.text),
        plans: f.plans.map((p) => ({
          name: p.name.trim(),
          ...rupees(p.price),
          ...opt("period", p.period),
          ...opt("description", p.description),
          features: planFeatures(p.features),
          highlight: p.highlight,
          ...opt("badge", p.badge),
          ...cta(p.ctaLabel, p.ctaHref),
        })),
      };
    case "blog-posts":
      return { type: "blog-posts", ...idOf(f.id), ...opt("title", f.title), limit: count(f.limit), ...opt("tag", f.tag) };
    case "reviews-summary":
      return { type: "reviews-summary", ...idOf(f.id), ...opt("title", f.title), limit: count(f.limit) };
  }
}

/** A plan's features textarea → one feature per non-empty line. */
export const planFeatures = (v: string) =>
  v
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

/** Field errors keyed by the editor's field path ("slides.0.ctaHref", "items.1.quote", "productIds" …). */
export type FieldErrors = Record<string, string>;

/** Maps a zod issue path on the schema shape to the form's field path (CTA parts are flat in the form). */
export function formPath(path: readonly (string | number)[]): string {
  const p = path.map(String);
  const i = p.findIndex((k) => k === "cta" || k === "cta2");
  if (i >= 0) {
    const key = p[i]!;
    const part = p[i + 1] === "href" ? `${key}Href` : `${key}Label`;
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
  newArrivals: string;
  offerEyebrow: string;
  offerHeading: string;
  offerText: string;
  galleryTitle: string;
  logosTitle: string;
  faqTitle: string;
  faqQ: string;
  faqA: string;
  locationTitle: string;
  hoursWeek: string;
  hoursWeekValue: string;
  menuTitle: string;
  menuGroup: string;
  menuDish: string;
  appointmentHeading: string;
  appointmentText: string;
  serviceName: string;
  book: string;
  beforeAfterTitle: string;
  goldTitle: string;
  goldText: string;
  instagramTitle: string;
  tabsTitle: string;
  lookTitle: string;
  bestsellersTitle: string;
  recommendedTitle: string;
  statsTitle: string;
  statYears: string;
  statCustomers: string;
  timelineTitle: string;
  timelineFirst: string;
  timelineToday: string;
  teamTitle: string;
  memberRole: string;
  pricingTitle: string;
  planBasic: string;
  planPopular: string;
  planFeature: string;
  blogTitle: string;
  reviewsTitle: string;
}

let seq = 0;
/** Short client id for new sections ("s-k3j9x2"), sent with the section so preview/storefront keys stay stable. */
export const newSectionId = () => `s-${Date.now().toString(36).slice(-4)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** A fresh section of `type` with friendly starting text (images still need choosing). */
export function newSectionForm(type: HomeSectionType, x: SectionSamples, id: string = newSectionId()): SectionForm {
  return { ...newFields(type, x, id), style: emptyStyle() } as SectionForm;
}

function newFields(type: HomeSectionType, x: SectionSamples, id: string): Forms {
  switch (type) {
    case "hero":
      return { type, id, slides: [{ ...emptySlide(), heading: x.heroHeading, subheading: x.heroSubheading, ctaLabel: x.shopNow, ctaHref: "/products" }] };
    case "categories":
      return { type, id, title: x.categoriesTitle, mode: "all", categoryIds: [], layout: "circles", showCounts: false, columns: "auto" };
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
      return { type, id, title: x.testimonialsTitle, layout: "carousel", items: [{ ...emptyTestimonial(), quote: x.testimonialQuote, name: x.testimonialName, rating: "5" }] };
    case "usp":
      return {
        type,
        id,
        title: "",
        text: "",
        layout: "cards",
        items: [
          { icon: "truck", title: x.uspFreeShipping, text: x.uspFreeShippingText },
          { icon: "cash", title: x.uspCod, text: x.uspCodText },
          { icon: "return", title: x.uspReturns, text: x.uspReturnsText },
        ],
      };
    case "newsletter":
      return { type, id, heading: x.newsletterHeading, text: x.newsletterText, layout: "band", imageUrl: "" };
    case "hero-split":
      return {
        type,
        id,
        imageUrl: "",
        imageSide: "right",
        eyebrow: "",
        heading: x.heroHeading,
        text: x.heroSubheading,
        ctaLabel: x.shopNow,
        ctaHref: "/products",
        cta2Label: x.newArrivals,
        cta2Href: "/search",
      };
    case "hero-video":
      return { type, id, videoUrl: "", posterUrl: "", overlay: "45", heading: x.heroHeading, text: x.heroSubheading, ctaLabel: x.shopNow, ctaHref: "/products" };
    case "offer":
      return { type, id, eyebrow: x.offerEyebrow, heading: x.offerHeading, text: x.offerText, code: "", endsAt: "", ctaLabel: x.shopNow, ctaHref: "/products" };
    case "gallery":
      return { type, id, title: x.galleryTitle, layout: "grid", images: [] };
    case "logos":
      return { type, id, title: x.logosTitle, grayscale: true, items: [] };
    case "category-mosaic":
      return { type, id, title: x.categoriesTitle, categoryIds: [] };
    case "faq":
      return { type, id, title: x.faqTitle, items: [{ q: x.faqQ, a: x.faqA }] };
    case "location":
      return { type, id, title: x.locationTitle, address: "", hours: [{ label: x.hoursWeek, value: x.hoursWeekValue }], phone: "", whatsapp: "", coords: "", mapLink: "" };
    case "menu-board":
      return { type, id, title: x.menuTitle, groups: [{ name: x.menuGroup, items: [{ ...emptyDish(), name: x.menuDish, diet: "veg" }] }], ctaLabel: "", ctaHref: "" };
    case "appointment":
      return { type, id, heading: x.appointmentHeading, text: x.appointmentText, services: [{ name: x.serviceName, duration: "", price: "" }], ctaLabel: x.book, ctaHref: "/book" };
    case "before-after":
      return { type, id, title: x.beforeAfterTitle, text: "", beforeUrl: "", afterUrl: "", beforeLabel: "", afterLabel: "" };
    case "gold-rates":
      return { type, id, title: x.goldTitle, text: x.goldText, showSilver: true };
    case "instagram":
      return { type, id, title: x.instagramTitle, handle: "", images: [] };
    case "product-tabs":
      return { type, id, title: x.tabsTitle, layout: "grid", limit: "8", tabs: [emptyTab("new"), emptyTab("bestsellers"), emptyTab("sale")] };
    case "deal":
      return { type, id, title: "", text: "", productId: "", endsAt: "" };
    case "shop-the-look":
      return { type, id, title: x.lookTitle, text: "", imageUrl: "", alt: "", hotspots: [] };
    case "bestsellers":
      return { type, id, title: x.bestsellersTitle, layout: "carousel", limit: "8" };
    case "recently-viewed":
      return { type, id, title: "" };
    case "recommended":
      return { type, id, title: x.recommendedTitle, layout: "carousel", limit: "8" };
    case "stats":
      return { type, id, title: x.statsTitle, text: "", items: [{ ...emptyStat(), value: "25", suffix: "+", label: x.statYears }, { ...emptyStat(), value: "10000", suffix: "+", label: x.statCustomers }] };
    case "timeline":
      return { type, id, title: x.timelineTitle, text: "", items: [{ ...emptyMilestone(), when: "2001", title: x.timelineFirst }, { ...emptyMilestone(), when: String(new Date().getFullYear()), title: x.timelineToday }] };
    case "team":
      return { type, id, title: x.teamTitle, text: "", members: [{ ...emptyMember(), name: x.testimonialName, role: x.memberRole }] };
    case "pricing-table":
      return {
        type,
        id,
        title: x.pricingTitle,
        text: "",
        plans: [
          { ...emptyPlan(), name: x.planBasic, features: x.planFeature, ctaLabel: x.book, ctaHref: "/book" },
          { ...emptyPlan(), name: x.planPopular, features: x.planFeature, highlight: true, ctaLabel: x.book, ctaHref: "/book" },
        ],
      };
    case "blog-posts":
      return { type, id, title: x.blogTitle, limit: "3", tag: "" };
    case "reviews-summary":
      return { type, id, title: x.reviewsTitle, limit: "6" };
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
  gallery: CMS_LIMITS.galleryImages,
  logos: CMS_LIMITS.logos,
  mosaic: CMS_LIMITS.mosaicTiles,
  faq: CMS_LIMITS.faqItems,
  hours: CMS_LIMITS.hours,
  menuGroups: CMS_LIMITS.menuGroups,
  dishes: CMS_LIMITS.menuDishes,
  services: CMS_LIMITS.services,
  instagram: CMS_LIMITS.instagramImages,
  tabs: CMS_LIMITS.productTabs,
  shelfLimit: CMS_LIMITS.shelfLimit,
  hotspots: CMS_LIMITS.hotspots,
  stats: CMS_LIMITS.stats,
  timeline: CMS_LIMITS.timeline,
  team: CMS_LIMITS.team,
  plans: CMS_LIMITS.plans,
  planFeatures: CMS_LIMITS.planFeatures,
  blogLimit: CMS_LIMITS.blogLimit,
  reviewsLimit: CMS_LIMITS.reviewsLimit,
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
/** Same as the storefront's mosaic without picked categories. */
export const MOSAIC_DEFAULT_TILES = 5;

/**
 * Approximates what the storefront will show for unsaved edits: static sections come straight from the form;
 * catalogue sections use data the editor already loaded. Incomplete sections still render (with empty lists or a
 * missing image), so the owner sees where they are; the storefront itself drops empty catalogue sections.
 */
export function resolvePreview(forms: readonly SectionForm[], lk: PreviewLookups): ResolvedHomeSection[] {
  return forms.map((f): ResolvedHomeSection => {
    const style = fromStyleForm(f.style) as SectionStyle | undefined;
    const r = resolveOne(f, lk);
    return style ? ({ ...r, style } as ResolvedHomeSection) : r;
  });
}

function resolveOne(f: SectionForm, lk: PreviewLookups): ResolvedHomeSection {
  const id = f.id ? { id: f.id } : {};
  const pickCats = (ids: string[], fallback: number) => {
    const all = lk.categories ?? [];
    const byId = new Map(all.map((c) => [c.id, c]));
    return ids.length ? ids.map((cid) => byId.get(cid)).filter((c): c is CategoryRef => !!c) : all.slice(0, fallback);
  };
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
    case "categories":
      return { type: "categories", ...id, title: f.title.trim(), layout: f.layout, showCounts: f.showCounts, columns: f.columns, categories: pickCats(f.mode === "pick" ? f.categoryIds : [], ALL_CATEGORIES_LIMIT) };
    case "deal": {
      const product = lk.products.get(f.productId);
      return {
        type: "deal",
        ...id,
        ...opt("title", f.title),
        ...opt("text", f.text),
        ...(f.endsAt.trim() ? { endsAt: localInputToIso(f.endsAt.trim()) } : {}),
        product: product ?? { id: "", name: "", slug: "", categoryId: null, categoryName: null, image: null, priceMin: 0, priceMax: 0, mrp: null, variantCount: 1, taxInclusive: true },
      };
    }
    case "shop-the-look":
      return {
        type: "shop-the-look",
        ...id,
        ...opt("title", f.title),
        ...opt("text", f.text),
        imageUrl: f.imageUrl.trim(),
        alt: f.alt.trim(),
        hotspots: f.hotspots.flatMap((h) => {
          const product = lk.products.get(h.productId);
          const x = Number(h.x);
          const y = Number(h.y);
          return product && Number.isFinite(x) && Number.isFinite(y) ? [{ x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)), product }] : [];
        }),
      };
    case "category-mosaic":
      return { type: "category-mosaic", ...id, title: f.title.trim(), categories: pickCats(f.categoryIds, MOSAIC_DEFAULT_TILES) };
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
      return {
        type: "testimonials",
        ...id,
        ...opt("title", f.title),
        layout: f.layout,
        items: f.items
          .filter((i) => i.quote.trim())
          .map((i) => ({ quote: i.quote.trim(), name: i.name.trim(), ...opt("role", i.role), ...(Number(i.rating) >= 1 ? { rating: Math.min(5, Number(i.rating)) } : {}), ...opt("photoUrl", i.photoUrl) })),
      };
    case "usp":
      return {
        type: "usp",
        ...id,
        ...opt("title", f.title),
        ...opt("text", f.text),
        layout: f.layout,
        items: f.items.filter((i) => i.title.trim()).map((i) => ({ icon: i.icon, title: i.title.trim(), text: i.text.trim() })),
      };
    case "newsletter":
      return { type: "newsletter", ...id, heading: f.heading.trim(), text: f.text.trim(), layout: f.layout, ...opt("imageUrl", f.imageUrl) };
    default: {
      // The other sections need no catalogue data: the form's values as the schema would take them (with blanks
      // dropped from lists so half-filled rows don't break the picture).
      const raw = fromFields(f) as Record<string, unknown>;
      const parsed = homeSectionSchema.safeParse(raw);
      if (parsed.success) return parsed.data as ResolvedHomeSection;
      return { ...raw, ...previewDefaults(f) } as ResolvedHomeSection;
    }
  }
}

/** Lenient values for an incomplete section in the preview (numbers that may still be text, empty rows dropped). */
function previewDefaults(f: SectionForm): Record<string, unknown> {
  switch (f.type) {
    case "hero-video":
      return { overlay: Number(f.overlay) || 45 };
    case "gallery":
      return { images: f.images.filter((i) => i.url.trim()).map((i) => ({ url: i.url.trim(), alt: i.alt, caption: i.caption || undefined })) };
    case "logos":
      return { items: f.items.filter((i) => i.imageUrl.trim() || i.name.trim()) };
    case "faq":
      return { items: f.items.filter((i) => i.q.trim()) };
    case "instagram":
      return { images: f.images.filter((i) => i.url.trim()) };
    case "menu-board":
      return {
        groups: f.groups.map((g) => ({
          name: g.name,
          items: g.items.filter((d) => d.name.trim()).map((d) => ({ name: d.name, ...(Number(d.price) > 0 ? { price: Math.round(Number(d.price) * 100) } : {}), ...(d.diet ? { diet: d.diet } : {}) })),
        })),
      };
    case "appointment":
      return { services: f.services.filter((v) => v.name.trim()).map((v) => ({ name: v.name, ...opt("duration", v.duration), ...(Number(v.price) > 0 ? { price: Math.round(Number(v.price) * 100) } : {}) })) };
    case "location":
      return { hours: f.hours.filter((h) => h.label.trim() || h.value.trim()) };
    case "product-tabs":
      return { limit: Number(f.limit) || 8, tabs: f.tabs.map((tab) => ({ ...opt("label", tab.label), source: tab.source })) };
    case "bestsellers":
    case "recommended":
      return { limit: Number(f.limit) || 8 };
    case "stats":
      return { items: f.items.filter((i) => i.label.trim()).map((i) => ({ value: Number(i.value.replace(/[,\s]/g, "")) || 0, prefix: i.prefix, suffix: i.suffix, label: i.label })) };
    case "timeline":
      return { items: f.items.filter((i) => i.when.trim() || i.title.trim()) };
    case "team":
      return { members: f.members.filter((m) => m.name.trim()) };
    case "pricing-table":
      return {
        plans: f.plans
          .filter((p) => p.name.trim())
          .map((p) => ({ name: p.name, ...(Number(p.price) >= 0 && p.price.trim() ? { price: Math.round(Number(p.price) * 100) } : {}), period: p.period || undefined, features: planFeatures(p.features), highlight: p.highlight, badge: p.badge || undefined })),
      };
    case "blog-posts":
    case "reviews-summary":
      return { limit: Number(f.limit) || 3 };
    default:
      return {};
  }
}

/** Ids of every product / category / collection the forms reference (what the preview has to load). */
export function referencedIds(forms: readonly SectionForm[]) {
  const products = new Set<string>();
  const collections = new Set<string>();
  let categories = false;
  for (const f of forms) {
    if (f.type === "products") f.productIds.forEach((id) => products.add(id));
    else if (f.type === "deal" && f.productId) products.add(f.productId);
    else if (f.type === "shop-the-look") f.hotspots.forEach((h) => h.productId && products.add(h.productId));
    else if (f.type === "collection" && f.collectionSlug.trim()) collections.add(f.collectionSlug.trim());
    else if (f.type === "categories" || f.type === "category-mosaic") categories = true;
  }
  return { products: [...products], collections: [...collections], categories };
}

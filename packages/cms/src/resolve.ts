import {
  homeSectionSchema,
  type HeroSlide,
  type HomeDoc,
  type HomeSection,
  type MenuItem,
  type MenuItemType,
  type SeoFields,
} from "./content";
import { noopLogger, type CatalogCategoryRef, type CatalogPort, type LoggerPort, type PublicProductSummary, type ShopPort } from "./ports";
import { STORE_PATHS } from "./seo/paths";

// ------------------------------------------------------------------ resolved (public) shapes

type Static = Exclude<HomeSection, { type: "hero" | "categories" | "collection" | "products" }>;

export interface ResolvedHeroSlide extends Omit<HeroSlide, "imageUrl"> {
  /** Null only in the default home (no image chosen yet): render a branded background. */
  imageUrl: string | null;
}
/** Only in the staff preview (`includeHidden`): the section is hidden on the storefront. */
interface HiddenFlag {
  hidden?: boolean;
}
export interface ResolvedHeroSection extends HiddenFlag {
  type: "hero";
  id?: string;
  slides: ResolvedHeroSlide[];
}
export interface ResolvedCategoriesSection extends HiddenFlag {
  type: "categories";
  id?: string;
  title: string;
  categories: CatalogCategoryRef[];
}
export interface ResolvedCollectionSection extends HiddenFlag {
  type: "collection";
  id?: string;
  title: string;
  layout: "carousel" | "grid";
  collection: { name: string; slug: string };
  products: PublicProductSummary[];
}
export interface ResolvedProductsSection extends HiddenFlag {
  type: "products";
  id?: string;
  title: string;
  /** Present on the default home's "New arrivals": a "View all" link. */
  href?: string;
  products: PublicProductSummary[];
}

export type ResolvedHomeSection =
  | ResolvedHeroSection
  | ResolvedCategoriesSection
  | ResolvedCollectionSection
  | ResolvedProductsSection
  | Static;

/** `GET /public/home`. */
export interface PublicHome {
  sections: ResolvedHomeSection[];
  seo: SeoFields | null;
  /** True when the shop hasn't published a home yet and this is the generated one. */
  isDefault: boolean;
  publishedAt: string | null;
}

export interface ResolveDeps {
  catalog: CatalogPort;
  log?: LoggerPort;
}

/** Keeps `ids` order, drops ids the port didn't return. */
function inOrder<T extends { id: string }>(ids: readonly string[], rows: readonly T[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const r = byId.get(id);
    if (r && !seen.has(id)) {
      out.push(r);
      seen.add(id);
    }
  }
  return out;
}

/** Max categories shown when a categories section lists "all". */
export const ALL_CATEGORIES_LIMIT = 24;

/** One section with its catalogue data; null when that data is gone (the section is dropped). */
export async function resolveSection(tenantId: string, section: HomeSection, deps: ResolveDeps): Promise<ResolvedHomeSection | null> {
  const { catalog } = deps;
  const hid = section.hidden ? { hidden: true } : {};
  switch (section.type) {
    case "categories": {
      const rows = section.categoryIds?.length
        ? inOrder(section.categoryIds, await catalog.categories(tenantId, section.categoryIds))
        : (await catalog.categories(tenantId)).slice(0, ALL_CATEGORIES_LIMIT);
      if (!rows.length) return null;
      return { type: "categories", ...(section.id ? { id: section.id } : {}), ...hid, title: section.title, categories: rows };
    }
    case "collection": {
      const c = await catalog.collection(tenantId, section.collectionSlug, section.limit);
      if (!c || !c.products.length) return null;
      return {
        type: "collection",
        ...(section.id ? { id: section.id } : {}),
        ...hid,
        title: section.title || c.name,
        layout: section.layout,
        collection: { name: c.name, slug: c.slug },
        products: c.products.slice(0, section.limit),
      };
    }
    case "products": {
      const rows = inOrder(section.productIds, await catalog.productsByIds(tenantId, section.productIds));
      if (!rows.length) return null;
      return { type: "products", ...(section.id ? { id: section.id } : {}), ...hid, title: section.title, products: rows };
    }
    default: {
      const { hidden: _h, ...rest } = section;
      return (section.hidden ? { ...rest, hidden: true } : rest) as Static;
    }
  }
}

/**
 * Resolves stored sections for the storefront: re-validates each (stored JSON may predate a schema change), loads
 * catalogue data in parallel and drops sections whose data is gone or whose lookup failed — silently for the shopper,
 * with a warning in the log for lookup errors. Hidden sections are skipped, except in the staff preview
 * (`includeHidden`), where they come back flagged `hidden: true` so the editor can show them dimmed.
 */
export async function resolveSections(
  tenantId: string,
  sections: readonly unknown[],
  deps: ResolveDeps,
  opts: { includeHidden?: boolean } = {},
): Promise<ResolvedHomeSection[]> {
  const log = deps.log ?? noopLogger;
  const out = await Promise.all(
    sections.map(async (raw) => {
      const parsed = homeSectionSchema.safeParse(raw);
      if (!parsed.success) return null;
      if (parsed.data.hidden && !opts.includeHidden) return null;
      try {
        return await resolveSection(tenantId, parsed.data, deps);
      } catch (err) {
        log.warn({ err, tenantId, section: parsed.data.type }, "cms: home section lookup failed; section dropped");
        return null;
      }
    }),
  );
  return out.filter((s): s is ResolvedHomeSection => s !== null);
}

export const DEFAULT_NEW_ARRIVALS = 12;

/** The generated home for shops that haven't published one: hero with the shop name, categories, newest products. */
export async function defaultHome(tenantId: string, deps: ResolveDeps & { shop: ShopPort }): Promise<PublicHome> {
  const log = deps.log ?? noopLogger;
  const info = await deps.shop.info(tenantId).catch((err: unknown) => {
    log.warn({ err, tenantId }, "cms: shop info failed");
    return { name: "Our shop", tagline: null };
  });
  const hero: ResolvedHeroSection = {
    type: "hero",
    slides: [
      {
        imageUrl: null,
        heading: info.name,
        ...(info.tagline ? { subheading: info.tagline } : {}),
        cta: { label: "Shop now", href: STORE_PATHS.products },
      },
    ],
  };
  const categories = resolveSections(tenantId, [{ type: "categories", title: "Shop by category" }], deps);
  const newest = deps.catalog.newest(tenantId, DEFAULT_NEW_ARRIVALS).catch((err: unknown) => {
    log.warn({ err, tenantId }, "cms: newest products lookup failed");
    return [] as PublicProductSummary[];
  });
  const [cats, products] = await Promise.all([categories, newest]);
  const sections: ResolvedHomeSection[] = [hero, ...cats];
  if (products.length) sections.push({ type: "products", title: "New arrivals", href: STORE_PATHS.products, products });
  return { sections, seo: null, isDefault: true, publishedAt: null };
}

/** The published home resolved, or the default when nothing is published. */
export async function publicHome(
  tenantId: string,
  published: HomeDoc | null | undefined,
  publishedAt: Date | null | undefined,
  deps: ResolveDeps & { shop: ShopPort },
): Promise<PublicHome> {
  if (!published) return defaultHome(tenantId, deps);
  const sections = await resolveSections(tenantId, Array.isArray(published.sections) ? published.sections : [], deps);
  return { sections, seo: published.seo ?? null, isDefault: false, publishedAt: publishedAt ? publishedAt.toISOString() : null };
}

// ------------------------------------------------------------------ menus

export interface ResolvedMenuItem {
  label: string;
  type: MenuItemType;
  /** Null for a dropdown parent without its own link. */
  href: string | null;
  children?: ResolvedMenuItem[];
}

export function menuItemHref(item: { type: MenuItemType; href?: string; ref?: string }): string | null {
  switch (item.type) {
    case "url":
      return item.href ?? null;
    case "page":
      return item.ref ? STORE_PATHS.page(item.ref) : null;
    case "post":
      return item.ref ? STORE_PATHS.post(item.ref) : null;
    case "category":
      return item.ref ? STORE_PATHS.category(item.ref) : null;
    case "collection":
      return item.ref ? STORE_PATHS.collection(item.ref) : null;
  }
}

/**
 * Menu items with storefront hrefs. Links to pages/posts that aren't published (`isLive` false) are dropped, and so
 * are link-less parents left without children.
 */
export function resolveMenu(
  items: readonly MenuItem[],
  isLive: (type: "page" | "post", slug: string) => boolean = () => true,
): ResolvedMenuItem[] {
  const one = (i: { label: string; type: MenuItemType; href?: string; ref?: string }): ResolvedMenuItem | null => {
    if ((i.type === "page" || i.type === "post") && (!i.ref || !isLive(i.type, i.ref))) return null;
    return { label: i.label, type: i.type, href: menuItemHref(i) };
  };
  const out: ResolvedMenuItem[] = [];
  for (const item of items) {
    const top = one(item);
    if (!top) continue;
    const children = (item.children ?? []).map(one).filter((c): c is ResolvedMenuItem => c !== null);
    if (!top.href && !children.length) continue;
    out.push(children.length ? { ...top, children } : top);
  }
  return out;
}

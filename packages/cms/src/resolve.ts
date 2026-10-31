import { packOrDefault } from "@rbms/verticals";
import {
  homeSectionSchema,
  type HeroSlide,
  type HomeDoc,
  type HomeSection,
  type MenuItem,
  type MenuItemType,
  type SectionStyle,
  type SectionOf as HomeSectionOf,
  type SeoFields,
} from "./content";
import { noopLogger, type CatalogCategoryRef, type CatalogPort, type LoggerPort, type PublicProductSummary, type ShopPort } from "./ports";
import { STORE_PATHS } from "./seo/paths";

// ------------------------------------------------------------------ resolved (public) shapes

type Static = Exclude<
  HomeSection,
  { type: "hero" | "categories" | "collection" | "products" | "category-mosaic" | "deal" | "shop-the-look" | "flash-sale" | "comparison" | "category-shelf" | "swatches" }
>;

export interface ResolvedHeroSlide extends Omit<HeroSlide, "imageUrl"> {
  /** Null only in the default home (no image chosen yet): render a branded background. */
  imageUrl: string | null;
}
/** Only in the staff preview (`includeHidden`): the section is hidden on the storefront. */
interface HiddenFlag {
  hidden?: boolean;
  /** The section's look (background, spacing …); omitted = the theme's defaults. */
  style?: SectionStyle;
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
  /** Older stored sections have none (= circles). */
  layout: HomeSectionOf<"categories">["layout"];
  showCounts: boolean;
  /** Tiles per row on desktop (grid layouts, slider); auto = the layout's own. */
  columns: HomeSectionOf<"categories">["columns"];
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

export interface ResolvedDealSection extends HiddenFlag, Omit<HomeSectionOf<"deal">, "productId" | "hidden" | "style"> {
  product: PublicProductSummary;
}

export interface ResolvedShopTheLookSection extends HiddenFlag, Omit<HomeSectionOf<"shop-the-look">, "hotspots" | "hidden" | "style"> {
  /** Dots whose product is gone are dropped. */
  hotspots: { x: number; y: number; product: PublicProductSummary }[];
}

export interface ResolvedCategoryMosaicSection extends HiddenFlag {
  type: "category-mosaic";
  id?: string;
  title: string;
  categories: CatalogCategoryRef[];
}

/**
 * A flash sale with its products: picked ones in order, or the collection's. `source: "sale"` comes back with no
 * products: the storefront loads the biggest discounts itself (they change by the hour).
 */
export interface ResolvedFlashSaleSection extends HiddenFlag, Omit<HomeSectionOf<"flash-sale">, "productIds" | "hidden" | "style"> {
  products: PublicProductSummary[];
}

/** Products side by side; each row keeps one value per product still on sale (values of gone products are dropped). */
export interface ResolvedComparisonSection extends HiddenFlag, Omit<HomeSectionOf<"comparison">, "productIds" | "hidden" | "style"> {
  products: PublicProductSummary[];
}

/** The categories a category shelf lists (their products are loaded by the storefront, per category). */
export interface ResolvedCategoryShelfSection extends HiddenFlag, Omit<HomeSectionOf<"category-shelf">, "categoryIds" | "hidden" | "style"> {
  categories: CatalogCategoryRef[];
}

/** The shade finder's products, in order (their variants are loaded by the storefront). */
export interface ResolvedSwatchesSection extends HiddenFlag, Omit<HomeSectionOf<"swatches">, "productIds" | "hidden" | "style"> {
  products: PublicProductSummary[];
}

export type ResolvedHomeSection =
  | ResolvedSwatchesSection
  | ResolvedFlashSaleSection
  | ResolvedComparisonSection
  | ResolvedCategoryShelfSection
  | ResolvedHeroSection
  | ResolvedCategoriesSection
  | ResolvedCategoryMosaicSection
  | ResolvedCollectionSection
  | ResolvedProductsSection
  | ResolvedDealSection
  | ResolvedShopTheLookSection
  | Static;

/** `GET /public/home`. */
export interface PublicHome {
  sections: ResolvedHomeSection[];
  seo: SeoFields | null;
  /** True when the shop hasn't published a home yet and this is the generated one. */
  isDefault: boolean;
  publishedAt: string | null;
  /** The home's words in other languages, by section id (`localizeSections` applies them); omitted when there are none. */
  translations?: HomeDoc["translations"];
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
/** Tiles a category mosaic shows when no categories are picked. */
export const MOSAIC_DEFAULT_TILES = 5;
/** Categories a category shelf lists when none are picked. */
export const SHELF_DEFAULT_CATEGORIES = 6;

/** One section with its catalogue data; null when that data is gone (the section is dropped). */
export async function resolveSection(tenantId: string, section: HomeSection, deps: ResolveDeps): Promise<ResolvedHomeSection | null> {
  const { catalog } = deps;
  // Catalogue sections are rebuilt below, so they carry the hidden flag and the style over explicitly.
  const hid = { ...(section.hidden ? { hidden: true } : {}), ...(section.style ? { style: section.style } : {}) };
  switch (section.type) {
    case "categories": {
      const rows = section.categoryIds?.length
        ? inOrder(section.categoryIds, await catalog.categories(tenantId, section.categoryIds))
        : (await catalog.categories(tenantId)).slice(0, ALL_CATEGORIES_LIMIT);
      if (!rows.length) return null;
      return {
        type: "categories",
        ...(section.id ? { id: section.id } : {}),
        ...hid,
        title: section.title,
        layout: section.layout,
        showCounts: section.showCounts,
        columns: section.columns,
        categories: rows,
      };
    }
    case "category-mosaic": {
      const rows = section.categoryIds?.length
        ? inOrder(section.categoryIds, await catalog.categories(tenantId, section.categoryIds))
        : (await catalog.categories(tenantId)).slice(0, MOSAIC_DEFAULT_TILES);
      if (!rows.length) return null;
      return { type: "category-mosaic", ...(section.id ? { id: section.id } : {}), ...hid, title: section.title, categories: rows };
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
    case "deal": {
      const [product] = await catalog.productsByIds(tenantId, [section.productId]);
      if (!product) return null;
      const { productId: _p, hidden: _h, style: _s, ...rest } = section;
      return { ...rest, ...hid, product };
    }
    case "shop-the-look": {
      const ids = [...new Set(section.hotspots.map((h) => h.productId))];
      const byId = new Map((await catalog.productsByIds(tenantId, ids)).map((p) => [p.id, p]));
      const hotspots = section.hotspots.flatMap((h) => {
        const product = byId.get(h.productId);
        return product ? [{ x: h.x, y: h.y, product }] : [];
      });
      if (!hotspots.length) return null;
      const { hotspots: _hs, hidden: _h, style: _s, ...rest } = section;
      return { ...rest, ...hid, hotspots };
    }
    case "flash-sale": {
      const { productIds, hidden: _h, style: _s, ...rest } = section;
      let products: PublicProductSummary[] = [];
      if (section.source === "pick") products = inOrder(productIds, await catalog.productsByIds(tenantId, productIds)).slice(0, section.limit);
      else if (section.source === "collection") products = section.collectionSlug ? ((await catalog.collection(tenantId, section.collectionSlug, section.limit))?.products ?? []).slice(0, section.limit) : [];
      if (section.source !== "sale" && !products.length) return null;
      return { ...rest, ...hid, products };
    }
    case "comparison": {
      const { productIds, hidden: _h, style: _s, rows, ...rest } = section;
      const found = new Map((await catalog.productsByIds(tenantId, productIds)).map((p) => [p.id, p]));
      const kept = productIds.map((pid, i) => ({ i, p: found.get(pid) })).filter((x, j, all) => x.p && all.findIndex((y) => y.p?.id === x.p!.id) === j);
      if (kept.length < 2) return null;
      return {
        ...rest,
        ...(rest.highlightId && !found.has(rest.highlightId) ? { highlightId: undefined } : {}),
        ...hid,
        products: kept.map((x) => x.p!),
        rows: rows.map((r) => ({ label: r.label, values: kept.map((x) => r.values[x.i] ?? "") })),
      };
    }
    case "swatches": {
      const { productIds, hidden: _h, style: _s, ...rest } = section;
      const products = inOrder(productIds, await catalog.productsByIds(tenantId, productIds));
      if (!products.length) return null;
      return { ...rest, ...hid, products };
    }
    case "category-shelf": {
      const { categoryIds, hidden: _h, style: _s, ...rest } = section;
      const rows = categoryIds?.length
        ? inOrder(categoryIds, await catalog.categories(tenantId, categoryIds))
        : (await catalog.categories(tenantId)).slice(0, SHELF_DEFAULT_CATEGORIES);
      if (!rows.length) return null;
      return { ...rest, ...hid, categories: rows };
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
  const info: Awaited<ReturnType<ShopPort["info"]>> = await deps.shop.info(tenantId).catch((err: unknown) => {
    log.warn({ err, tenantId }, "cms: shop info failed");
    return { name: "Our shop", tagline: null };
  });
  // The shop's trade words (pharmacy: "Order medicines", restaurant: "Today's specials"…) instead of clothing ones.
  const copy = packOrDefault(info.businessType, info.appId).copy.en;
  const hero: ResolvedHeroSection = {
    type: "hero",
    slides: [
      {
        imageUrl: null,
        heading: info.name,
        subheading: info.tagline || copy.heroSubheading,
        cta: { label: copy.cta, href: STORE_PATHS.products },
      },
    ],
  };
  const categories = resolveSections(tenantId, [{ type: "categories", title: copy.categoriesTitle }], deps);
  const newest = deps.catalog.newest(tenantId, DEFAULT_NEW_ARRIVALS).catch((err: unknown) => {
    log.warn({ err, tenantId }, "cms: newest products lookup failed");
    return [] as PublicProductSummary[];
  });
  const [cats, products] = await Promise.all([categories, newest]);
  const sections: ResolvedHomeSection[] = [hero, ...cats];
  if (products.length) sections.push({ type: "products", title: copy.newItems, href: STORE_PATHS.products, products });
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
  return {
    sections,
    seo: published.seo ?? null,
    isDefault: false,
    publishedAt: publishedAt ? publishedAt.toISOString() : null,
    ...(published.translations ? { translations: published.translations } : {}),
  };
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

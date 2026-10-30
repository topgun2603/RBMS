import type { HomeDocInput, MenuItemInput, BlockInput } from "@rbms/cms";
import type { ShopSpec } from "../seed-fixtures";
import type { Logger } from "pino";
import type { Kit } from "../kit";

/**
 * A demo store of the "20+ stores" series (docs/verticals.md, "How to add a new store look + demo shop"): one finished,
 * believable shop per look, seeded by `seedDemoStore` (seed-demo-store.ts). Pure data: everything a store needs (shop,
 * look, catalogue, home, pages, menus, offers, delivery) plus the credits of the photos it uses.
 */

/** A Pexels photo (https://www.pexels.com/license/: free for commercial use, no attribution needed; we credit anyway). */
export interface DemoPhoto {
  /** Photographer, as Pexels shows them. */
  by: string;
  /** What the picture shows (alt text and the credits page). */
  alt: string;
}

/** How a photo is cut: square product tiles, category tiles, wide banners. */
export type PhotoSize = "square" | "tile" | "wide";

export interface DemoCategory {
  name: string;
  description: string;
  /** Pexels id of the category picture. */
  photo: number;
  /** Name of the parent category (listed earlier in `categories`); a parent may hold only sub-categories. */
  parent?: string;
}

export interface DemoVariant {
  /** Option values ({ Size: "1 inch" }); omitted for a product without options. */
  values?: Record<string, string>;
  /** Paise, GST included. */
  price: number;
  mrp: number;
  stock: number;
}

export interface DemoProduct {
  name: string;
  /** One of the store's category names. */
  category: string;
  hsn: string;
  gstRate: number;
  /** Price-band GST (apparel / footwear: `withPriceBandGst`); `gstRate` is then only the fallback. */
  gstRule?: import("@rbms/gst").GstRateRule | null;
  /** pcs, bag, kg, ft, m, litre, set, coil … */
  unit: string;
  description: string;
  attributes?: Record<string, string>;
  tags?: string[];
  /** SKU prefix: SKUs are `<prefix>-<n>`. */
  sku: string;
  /** Pexels id of the product picture. */
  photo: number;
  options?: { name: string; values: string[] }[];
  /** One per option combination (or exactly one for a product without options). */
  variants: DemoVariant[];
  /** Cost as a share of the price (for margins in reports); default 0.8. */
  costShare?: number;
}

export interface DemoCollection {
  name: string;
  slug: string;
  description: string;
  /** Rule collection: products of a category (by name), a tag or on sale. */
  rule: { category?: string; tag?: string; onSale?: boolean; sort: "new" | "price-asc" | "price-desc" | "name" | "rating" };
}

/** What the home builder gets: the URL of an uploaded photo and the ids of the store's categories and products. */
export interface HomeContext {
  photo(id: number, size?: PhotoSize): string;
  category(name: string): string;
  product(name: string): string;
}

export interface DemoPage {
  slug: string;
  title: string;
  blocks: (ctx: HomeContext) => BlockInput[];
}

/** A blog post (news / events), published by the seed; matched by slug. `cover` is a Pexels id of the store's `photos`. */
export interface DemoPost {
  slug: string;
  title: string;
  excerpt: string;
  cover: number;
  tags: string[];
  authorName: string;
  blocks: (ctx: HomeContext) => BlockInput[];
}

export interface DemoStore {
  /** Shop, app, plan, trade, business profile and billing items (seed-fixtures `ensureShop`). */
  shop: ShopSpec;
  /** Theme preset id (`@rbms/branding` THEME_PRESETS): applied when the shop is created or still on its trade's look. */
  preset: string;
  /** `store` settings (contact, COD, policies, social). */
  store: Record<string, unknown>;
  /** Delivery zones and their single rate. */
  zones: { name: string; states?: string[]; pincodePrefixes?: string[]; rate: Record<string, unknown> }[];
  categories: DemoCategory[];
  products: DemoProduct[];
  collections: DemoCollection[];
  coupons: Record<string, unknown>[];
  /** The home page (section ids must be stable: a re-run finds the seeded home by them) with its Tamil words. */
  home(ctx: HomeContext): HomeDocInput;
  pages: DemoPage[];
  /** News / events posts (the home's `blog-posts` section shows them); optional. */
  posts?: DemoPost[];
  menus: { header: MenuItemInput[]; footer: MenuItemInput[] };
  /** Every photo the store uses, by Pexels id. */
  photos: Record<number, DemoPhoto>;
  /** Trade-specific setup after the catalogue exists (kitchen stations and team for a restaurant), idempotent. */
  setup?(kit: Kit, tenant: { id: string; slug: string }, ownerUserId: string, log: Logger): Promise<void>;
}

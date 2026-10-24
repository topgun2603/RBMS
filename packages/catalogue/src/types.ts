import type { GstRateRule } from "@srirealtime/gst";
import type { Channel, ProductImage, ProductOption, ProductStatus, Seo } from "./schema";

export interface ListResult<T> {
  items: T[];
  total: number;
}

export interface Category {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  sort: number;
  active: boolean;
  seo: Seo | null;
  /** Non-deleted products in this category (directly). */
  productCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CategoryNode extends Category {
  children: CategoryNode[];
}

export interface Variant {
  id: string;
  productId: string;
  sku: string | null;
  barcode: string | null;
  /** "M / Red"; "" for the default variant of a simple product. */
  title: string;
  optionValues: Record<string, string>;
  /** Paise (incl. GST when the product is tax-inclusive). */
  price: number;
  mrp: number | null;
  cost: number | null;
  weightGrams: number | null;
  position: number;
  isDefault: boolean;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  categoryId: string | null;
  hsn: string | null;
  gstRate: number;
  /** Price-band GST (apparel / footwear); null = flat `gstRate`. */
  gstRule?: GstRateRule | null;
  unit: string;
  taxInclusive: boolean;
  status: ProductStatus;
  channels: Channel[];
  tags: string[];
  attributes: Record<string, string>;
  options: ProductOption[];
  images: ProductImage[];
  seo: Seo | null;
  /** Marketplace seller owning the product; null = the shop's own product. */
  vendorId: string | null;
  variants: Variant[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductSummary {
  id: string;
  name: string;
  slug: string;
  status: ProductStatus;
  categoryId: string | null;
  categoryName: string | null;
  /** First image URL. */
  image: string | null;
  priceMin: number;
  priceMax: number;
  variantCount: number;
  channels: Channel[];
  /** Marketplace seller owning the product; null = the shop's own product. */
  vendorId: string | null;
  updatedAt: Date;
  /**
   * Staff list with stock on (stock port + inventory feature): units on hand over tracked variants and the worst
   * variant status; null = no tracked variant. Absent when stock is off.
   */
  stock?: { qty: number; status: "ok" | "low" | "out" } | null;
}

/**
 * Vendor-scoped access (marketplace sellers): service methods given a scope only see and write that seller's
 * products (others are 404) and create products owned by it.
 */
export interface ProductScope {
  vendorId: string;
}

/** One product of a seller (`vendorProducts()`; marketplace's `VendorProduct`). Paise. */
export interface VendorProductItem {
  id: string;
  name: string;
  slug: string;
  status: ProductStatus;
  image: string | null;
  priceMin: number;
  priceMax: number;
}

/** A variant of a seller's product (`vendorVariants()`, marketplace seller stock). */
export interface VendorVariantItem {
  variantId: string;
  productId: string;
  productName: string;
  /** "" for the default variant of a simple product. */
  title: string;
  sku: string | null;
  unit: string;
  status: ProductStatus;
}

/** Payload of the `product.created` / `product.updated` events. Prices in paise. */
export interface ProductEventData {
  id: string;
  name: string;
  slug: string;
  status: ProductStatus;
  vendorId: string | null;
  priceMin: number;
  priceMax: number;
  updatedAt: Date;
}

/** A sellable variant as other modules see it (ports: invoices, inventory, orders). */
export interface CatalogItem {
  /** Variant id. */
  id: string;
  productId: string;
  /** "Product" or "Product – M / Red". */
  name: string;
  sku: string | null;
  barcode: string | null;
  hsn: string | null;
  unit: string;
  /** GST-exclusive paise per unit (`exclusiveOf(price, gstRate, taxInclusive)`). */
  rate: number;
  /** As stored on the variant (incl. GST when taxInclusive). */
  price: number;
  taxInclusive: boolean;
  /** The rate at this variant's price: the product's `gstRate`, or its rule's band at `price` (before any discount). */
  gstRate: number;
  /** The product's price-band GST rule, when it has one: bill lines are re-banded on their taxable value after discounts. */
  gstRule?: GstRateRule | null;
  image: string | null;
  /** When the variant was created (billing's Item.createdAt). */
  createdAt: Date;
  /** The product's category (null = none). */
  categoryId?: string | null;
}

/** Staff lookups (`GET /variants*`): the item plus the variant and product details pickers need. */
export interface VariantLookup extends CatalogItem {
  productName: string;
  title: string;
  optionValues: Record<string, string>;
  mrp: number | null;
  cost: number | null;
  weightGrams: number | null;
  position: number;
  isDefault: boolean;
  status: ProductStatus;
  channels: Channel[];
}

export type PublicVariant = Omit<Variant, "cost">;

/**
 * What a public product is: something shipped (`product`) or a service done for the customer (`service`: a bookable
 * appointment service, or an item sold by the visit/job/session or under a SAC code). The store shows "Book now" or
 * "Enquire" for services instead of the cart, stock and delivery blocks.
 */
export type PublicItemKind = "product" | "service";
/** Food mark of a dish. */
export type PublicDiet = "veg" | "egg" | "non-veg";

/** The booking side of a service item (from bookings, through `BookableServicesPort`). */
export interface PublicServiceInfo {
  /** The bookings service id (`/book?service=<id>`); null when the item isn't linked to an appointment service. */
  serviceId: string | null;
  /** Minutes the appointment takes; null when unknown. */
  durationMin: number | null;
  /** Bookable online right now (online booking on and the service online-bookable). False = enquire instead. */
  bookable: boolean;
}

export interface PublicProduct
  extends Omit<Product, "variants" | "status" | "channels"> {
  categoryName: string | null;
  categorySlug: string | null;
  priceMin: number;
  priceMax: number;
  variants: PublicVariant[];
  kind: PublicItemKind;
  /** Set for services (`kind: "service"`). */
  service?: PublicServiceInfo | null;
  /** Veg / egg / non-veg mark of a dish (from its tags); omitted for anything else. */
  diet?: PublicDiet;
}

export interface PublicProductSummary {
  id: string;
  name: string;
  slug: string;
  categoryId: string | null;
  categoryName: string | null;
  image: string | null;
  priceMin: number;
  priceMax: number;
  /** MRP of the cheapest variant (for a struck-through price), null when unset. */
  mrp: number | null;
  variantCount: number;
  /** Live variant ids (the store asks inventory once per grid for stock badges). */
  variantIds: string[];
  /** The first two photos, only when there is more than one (cards swap to the second on hover). */
  images?: string[];
  taxInclusive: boolean;
  /** For the store's "New" badge. */
  createdAt: Date;
  /** Product or service (cards show "Book" for services). Older builders may leave it out (= product). */
  kind?: PublicItemKind;
  /** Set for services. */
  service?: PublicServiceInfo | null;
  /** Veg / egg / non-veg mark of a dish (from its tags); omitted for anything else. */
  diet?: PublicDiet;
}

export type PublicCategory = Omit<Category, "productCount" | "createdAt" | "updatedAt" | "active">;

/** `storeVariants()`: a variant lookup plus what the online store needs from its product. */
export interface StoreVariantLookup extends VariantLookup {
  productSlug: string;
  categoryId: string | null;
}

/** `productRefs()`: a product summary of any status (filter with `isPublicRef` before showing it in the store). */
export interface ProductRef extends PublicProductSummary {
  status: ProductStatus;
  channels: Channel[];
  updatedAt: Date;
  /** The product's option names in order ("Size", "Colour"); empty for a single-variant product. */
  optionNames: string[];
}

/** Shown in the online store: active and sold on the "store" channel. */
export const isPublicRef = (p: Pick<ProductRef, "status" | "channels">): boolean => p.status === "active" && p.channels.includes("store");

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
  unit: string;
  taxInclusive: boolean;
  status: ProductStatus;
  channels: Channel[];
  tags: string[];
  attributes: Record<string, string>;
  options: ProductOption[];
  images: ProductImage[];
  seo: Seo | null;
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
  gstRate: number;
  image: string | null;
  /** When the variant was created (billing's Item.createdAt). */
  createdAt: Date;
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

export interface PublicProduct
  extends Omit<Product, "variants" | "status" | "channels"> {
  categoryName: string | null;
  categorySlug: string | null;
  priceMin: number;
  priceMax: number;
  variants: PublicVariant[];
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
  taxInclusive: boolean;
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
}

/** Shown in the online store: active and sold on the "store" channel. */
export const isPublicRef = (p: Pick<ProductRef, "status" | "channels">): boolean => p.status === "active" && p.channels.includes("store");

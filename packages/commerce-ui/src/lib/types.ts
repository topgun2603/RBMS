/**
 * API shapes of `/v1/catalog` (packages/catalogue/src/types.ts) and the parts of `/v1/inventory` and `/v1/uploads`
 * this module uses. Money is integer paise; dates arrive as ISO strings.
 */

export type ISODate = string;

export interface Paged<T> {
  items: T[];
  total: number;
}

export const PRODUCT_STATUSES = ["active", "draft", "archived"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const CHANNELS = ["store", "billing", "pos", "marketplace"] as const;
export type Channel = (typeof CHANNELS)[number];
/** The channels the editor offers as checkboxes (others are kept as they are). */
export const EDITABLE_CHANNELS = ["store", "billing"] as const satisfies readonly Channel[];

/** GST slabs offered for products. */
export const PRODUCT_GST_RATES = [0, 5, 12, 18, 28] as const;

export interface Seo {
  title?: string;
  description?: string;
}

export interface ProductOption {
  name: string;
  values: string[];
}

export interface ProductImage {
  url: string;
  alt?: string | null;
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
  productCount: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface CategoryNode extends Category {
  children: CategoryNode[];
}

export interface CategoryInput {
  name: string;
  slug?: string | null;
  parentId?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  active?: boolean;
}

export interface Variant {
  id: string;
  productId: string;
  sku: string | null;
  barcode: string | null;
  title: string;
  optionValues: Record<string, string>;
  price: number;
  mrp: number | null;
  cost: number | null;
  weightGrams: number | null;
  position: number;
  isDefault: boolean;
}

export interface VariantInput {
  sku?: string | null;
  barcode?: string | null;
  optionValues?: Record<string, string>;
  title?: string | null;
  price: number;
  mrp?: number | null;
  cost?: number | null;
  weightGrams?: number | null;
  position?: number;
  isDefault?: boolean;
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
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface ProductSummary {
  id: string;
  name: string;
  slug: string;
  status: ProductStatus;
  categoryId: string | null;
  categoryName: string | null;
  image: string | null;
  priceMin: number;
  priceMax: number;
  variantCount: number;
  channels: Channel[];
  /** Marketplace seller owning the product; null = the shop's own. */
  vendorId?: string | null;
  updatedAt: ISODate;
  /** Staff list with inventory on: units on hand over tracked variants and the worst status; null = not tracked. */
  stock?: { qty: number; status: StockStatus } | null;
}

/** `stock` filter values of the staff product list. */
export const PRODUCT_STOCK_FILTERS = ["ok", "low", "out", "untracked"] as const;

/** Product fields shared by POST and PATCH. */
export interface ProductFields {
  name: string;
  slug?: string | null;
  description?: string | null;
  brand?: string | null;
  categoryId?: string | null;
  hsn?: string | null;
  gstRate: number;
  unit?: string;
  taxInclusive: boolean;
  status: ProductStatus;
  channels: Channel[];
  tags: string[];
  attributes: Record<string, string>;
  options?: ProductOption[];
  images: ProductImage[];
  seo?: Seo | null;
}

export interface ProductCreateInput extends ProductFields {
  variants?: VariantInput[];
  price?: number;
  sku?: string | null;
  barcode?: string | null;
  mrp?: number | null;
  cost?: number | null;
  weightGrams?: number | null;
}

/** `GET /catalog/products` params (lists comma-joined: `status=active,draft`). */
export interface ProductListFilters {
  q?: string;
  status?: string;
  categoryId?: string;
  collectionId?: string;
  vendorId?: string;
  channel?: string;
  stock?: string;
  tag?: string;
  sort?: string;
  limit?: string | number;
  offset?: string | number;
  [param: string]: string | number | undefined;
}

/** `GET /variants/search`: a variant with its product (pickers, stock mapping). */
export interface VariantLookup {
  id: string;
  productId: string;
  name: string;
  productName: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  price: number;
  mrp: number | null;
  image: string | null;
  status: ProductStatus;
}

export const COLLECTION_SORTS = ["new", "price-asc", "price-desc", "name", "rating"] as const;
export type CollectionSort = (typeof COLLECTION_SORTS)[number];

export interface CollectionRule {
  categoryId?: string | null;
  tag?: string | null;
  priceMax?: number | null;
  onSale?: boolean | null;
  sort: CollectionSort;
}

export interface Collection {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  type: "manual" | "rule";
  productIds: string[];
  rule: CollectionRule | null;
  active: boolean;
  seo: Seo | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface CollectionInput {
  name: string;
  slug?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  type: "manual" | "rule";
  productIds: string[];
  rule: CollectionRule | null;
  active: boolean;
  seo?: Seo | null;
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
  mrp: number | null;
  variantCount: number;
  taxInclusive: boolean;
}

export interface PublicCollectionPage {
  collection: { id: string; name: string; slug: string };
  items: PublicProductSummary[];
  total: number;
}

// inventory (`/v1/inventory`)

export type StockStatus = "ok" | "low" | "out";

export interface StockRow {
  itemId: string;
  name: string;
  unit: string | null;
  qty: number;
  reorderLevel: number;
  track: boolean;
  status: StockStatus;
  reserved?: number;
  available?: number;
}

export interface StockListResponse {
  items: StockRow[];
  total: number;
  totals: { stockValue: number; lowCount: number; outCount: number };
}

export interface StockSummary {
  stockValue: number;
  lowCount: number;
  outCount: number;
  lowItems: StockRow[];
}

export interface StockAdjustInput {
  mode: "add" | "remove" | "set";
  qty: number;
  note?: string;
}

// uploads (`/v1/uploads`)

export interface UploadSignResponse {
  fileId: string;
  key: string;
  upload: { url: string; method: "PUT"; headers: Record<string, string>; expiresIn: number };
}

export interface UploadedFile {
  id: string;
  url: string;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  contentType: string;
}

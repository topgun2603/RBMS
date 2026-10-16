import type { ProductOption, ProductStatus } from "./schema";
import type {
  Category,
  CategoryNode,
  PublicProduct,
  PublicProductSummary,
  PublicVariant,
  Product,
  ProductEventData,
  ProductSummary,
  Variant,
} from "./types";

/** Most variants one product may have. */
export const MAX_VARIANTS = 100;

const round = (n: number) => Math.sign(n) * Math.round(Math.abs(n));

// GST slabs and `exclusiveOf(price, gstRate, taxInclusive)` come from @srirealtime/gst.

/** The inverse of gst's `exclusiveOf`, for a billing rate written onto a tax-inclusive product: `round(rate × (100 + gstRate) / 100)`. */
export function inclusiveOf(rate: number, gstRate: number, taxInclusive: boolean): number {
  if (!taxInclusive || !gstRate) return rate;
  const bp = Math.round(gstRate * 100);
  return round((rate * (10_000 + bp)) / 10_000);
}

// ------------------------------------------------------------------ slugs

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX = 80;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Random lowercase base-36 id, e.g. "k3x9qa". */
export function shortId(length = 6): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

/**
 * URL slug from a name: accents stripped, lowercased ASCII, runs of anything else become one hyphen.
 * Names with no ASCII letters or digits (e.g. Tamil only) fall back to `<prefix>-<6 char id>`.
 */
export function slugify(name: string, prefix = "p", id: () => string = shortId): string {
  const ascii = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const cut = ascii.slice(0, SLUG_MAX).replace(/-+$/, "");
  return cut || `${prefix}-${id()}`;
}

/** `base`, else `base-2`, `base-3`, … — the first one not taken. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  const stem = base.slice(0, SLUG_MAX - 4);
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// ------------------------------------------------------------------ variants

/** "M / Red" in option order; "" when the variant has no option values. */
export function variantTitle(optionValues: Record<string, string>, options: readonly ProductOption[] = []): string {
  const ordered = options.map((o) => optionValues[o.name]).filter((v): v is string => Boolean(v));
  const extra = Object.keys(optionValues)
    .filter((k) => !options.some((o) => o.name === k))
    .map((k) => optionValues[k]!)
    .filter(Boolean);
  return [...ordered, ...extra].join(" / ");
}

/** "Product" for a simple product, "Product – M / Red" for a variant. */
export const itemName = (productName: string, title: string) => (title ? `${productName} – ${title}` : productName);

/** Every combination of option values, in option order (first option varies slowest). */
export function cartesian(options: readonly ProductOption[]): Record<string, string>[] {
  const used = options.filter((o) => o.values.length > 0);
  if (used.length === 0) return [];
  let combos: Record<string, string>[] = [{}];
  for (const o of used) {
    const next: Record<string, string>[] = [];
    for (const c of combos) for (const v of o.values) next.push({ ...c, [o.name]: v });
    combos = next;
  }
  return combos;
}

/** Union of two option lists by name (case-insensitive), keeping first-seen order of names and values. */
export function mergeOptions(current: readonly ProductOption[], added: readonly ProductOption[]): ProductOption[] {
  const out: ProductOption[] = current.map((o) => ({ name: o.name, values: [...o.values] }));
  for (const o of added) {
    const existing = out.find((e) => e.name.toLowerCase() === o.name.toLowerCase());
    if (!existing) {
      out.push({ name: o.name, values: [...new Set(o.values)] });
      continue;
    }
    for (const v of o.values) if (!existing.values.some((e) => e.toLowerCase() === v.toLowerCase())) existing.values.push(v);
  }
  return out;
}

const sameValues = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
};

/** True when every value the variant has agrees with the combination (a blank variant fits anything). */
const fits = (values: Record<string, string>, combo: Record<string, string>) =>
  Object.entries(values).every(([k, v]) => combo[k] === v);

export interface VariantPlan {
  /** The product's options after the merge. */
  options: ProductOption[];
  /** Existing variants that take a combination (they had fewer or no option values). Ids are kept. */
  assign: { id: string; optionValues: Record<string, string>; title: string }[];
  /** New combinations to create. */
  create: { optionValues: Record<string, string>; title: string }[];
}

/**
 * Plans `POST /products/:id/variants/generate`: the cartesian product of the merged options. Existing variants are
 * kept; a variant whose values all agree with a combination claims it (a simple product's default variant takes the
 * first combination, so its id — which bills and stock point at — survives). Unclaimed combinations are created.
 */
export function planVariants(
  existing: readonly { id: string; optionValues: Record<string, string> }[],
  currentOptions: readonly ProductOption[],
  addedOptions: readonly ProductOption[],
): VariantPlan {
  const options = mergeOptions(currentOptions, addedOptions);
  const combos = cartesian(options);
  const claimed = new Set<number>();
  const assign: VariantPlan["assign"] = [];
  // Exact matches first, so a partial variant can't steal a combination an exact one owns.
  const pending: typeof existing[number][] = [];
  for (const v of existing) {
    const i = combos.findIndex((c, idx) => !claimed.has(idx) && sameValues(v.optionValues, c));
    if (i >= 0) claimed.add(i);
    else pending.push(v);
  }
  for (const v of pending) {
    const i = combos.findIndex((c, idx) => !claimed.has(idx) && fits(v.optionValues, c));
    if (i < 0) continue;
    claimed.add(i);
    assign.push({ id: v.id, optionValues: combos[i]!, title: variantTitle(combos[i]!, options) });
  }
  const create = combos
    .filter((_, i) => !claimed.has(i))
    .map((optionValues) => ({ optionValues, title: variantTitle(optionValues, options) }));
  return { options, assign, create };
}

/**
 * The variant that should be default after a change: the requested one if still present, else the current default,
 * else the lowest position. Null for an empty list.
 */
export function pickDefault(
  variants: readonly { id: string; isDefault: boolean; position: number }[],
  preferred?: string | null,
): string | null {
  if (preferred && variants.some((v) => v.id === preferred)) return preferred;
  const current = variants.find((v) => v.isDefault);
  if (current) return current.id;
  const sorted = [...variants].sort((a, b) => a.position - b.position);
  return sorted[0]?.id ?? null;
}

// ------------------------------------------------------------------ summaries and public output

export function priceRange(variants: readonly { price: number }[]): { priceMin: number; priceMax: number } {
  if (variants.length === 0) return { priceMin: 0, priceMax: 0 };
  let priceMin = Infinity;
  let priceMax = -Infinity;
  for (const v of variants) {
    priceMin = Math.min(priceMin, v.price);
    priceMax = Math.max(priceMax, v.price);
  }
  return { priceMin, priceMax };
}

export function toSummary(
  p: Omit<Product, "variants">,
  variants: readonly Pick<Variant, "price">[],
  categoryName: string | null,
): ProductSummary {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    status: p.status,
    categoryId: p.categoryId,
    categoryName,
    image: p.images[0]?.url ?? null,
    ...priceRange(variants),
    variantCount: variants.length,
    channels: p.channels,
    vendorId: p.vendorId,
    updatedAt: p.updatedAt,
  };
}

/** `product.created` / `product.updated` event payload: the product plus its price range over live variants. */
export function productEventData(
  p: Pick<Product, "id" | "name" | "slug" | "status" | "vendorId" | "updatedAt">,
  variants: readonly Pick<Variant, "price">[],
): ProductEventData {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    status: p.status,
    vendorId: p.vendorId,
    ...priceRange(variants),
    updatedAt: p.updatedAt,
  };
}

export const toPublicVariant = ({ cost: _cost, ...v }: Variant): PublicVariant => v;

/** Storefront detail: no cost prices, no internal status/channels. */
export function toPublicProduct(
  p: Product,
  category: { name: string; slug: string } | null = null,
): PublicProduct {
  const { variants, status: _status, channels: _channels, ...rest } = p;
  return {
    ...rest,
    categoryName: category?.name ?? null,
    categorySlug: category?.slug ?? null,
    ...priceRange(variants),
    variants: variants.map(toPublicVariant),
  };
}

export function toPublicSummary(
  p: Omit<Product, "variants">,
  variants: readonly Pick<Variant, "price" | "mrp">[],
  categoryName: string | null,
): PublicProductSummary {
  const range = priceRange(variants);
  const cheapest = variants.find((v) => v.price === range.priceMin);
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    categoryId: p.categoryId,
    categoryName,
    image: p.images[0]?.url ?? null,
    ...range,
    mrp: cheapest?.mrp ?? null,
    variantCount: variants.length,
    taxInclusive: p.taxInclusive,
  };
}

// ------------------------------------------------------------------ categories

/** Nested tree ordered by `sort` then name. Orphans (parent missing) become roots. */
export function buildTree(categories: readonly Category[]): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>(categories.map((c) => [c.id, { ...c, children: [] }]));
  const roots: CategoryNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentId ? nodes.get(n.parentId) : undefined;
    if (parent && parent !== n) parent.children.push(n);
    else roots.push(n);
  }
  const order = (list: CategoryNode[]) => {
    list.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
    for (const n of list) order(n.children);
  };
  order(roots);
  return roots;
}

/** The category and all its descendants. */
export function descendantIds(categories: readonly { id: string; parentId: string | null }[], rootId: string): string[] {
  const out = [rootId];
  const seen = new Set(out);
  for (let i = 0; i < out.length; i++) {
    for (const c of categories) {
      if (c.parentId === out[i] && !seen.has(c.id)) {
        seen.add(c.id);
        out.push(c.id);
      }
    }
  }
  return out;
}

/** Whether making `parentId` the parent of `id` would create a cycle. */
export function wouldCycle(categories: readonly { id: string; parentId: string | null }[], id: string, parentId: string): boolean {
  return descendantIds(categories, id).includes(parentId);
}

/** IST calendar date `YYYY-MM-DD`. */
export const todayIST = (now = new Date()) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

export const paiseToRupees = (p: number | null | undefined) => (p === null || p === undefined ? null : (p / 100).toFixed(2));

// ------------------------------------------------------------------ marketplace listing review

/** What a write did to a seller product's listing (marketplace's `ListingReviewPort.onListing`). */
/** "changed": a live seller product's customer-facing content changed (the marketplace may re-review it). */
export type ListingEventType = "submitted" | "published" | "withdrawn" | "changed";

export interface ListingPlan {
  /** Status to store (undefined = leave as is). */
  status: ProductStatus | undefined;
  /** What to tell the listing review port after the write, if anything. */
  event: ListingEventType | null;
}

/**
 * How a write treats a marketplace seller's product (`vendorId` set). The catalogue stays generic: a product waiting for
 * review is simply kept as a `draft` (so the store, search, sitemap and collections never show it) and the
 * marketplace module keeps the review record.
 * - The seller's own write (`byVendor`) asking for `active` on a product that isn't active yet: with `needsReview` it
 *   stays a draft and is `submitted`; without it goes live (`published`). Saving an active product keeps it active.
 * - Moving it to draft/archived (or deleting it) is `withdrawn` (cancels a pending review).
 * - Staff making a seller product active `published` it (staff need no review). Shop products never raise events.
 */
export function planListing(input: {
  vendorId: string | null;
  byVendor: boolean;
  requested: ProductStatus | undefined;
  /** Current status; null when the product is being created. */
  current: ProductStatus | null;
  needsReview: boolean;
}): ListingPlan {
  const { vendorId, byVendor, requested, current, needsReview } = input;
  if (!vendorId || requested === undefined) return { status: requested, event: null };
  if (requested === "active") {
    if (current === "active") return { status: "active", event: null };
    if (byVendor && needsReview) return { status: "draft", event: "submitted" };
    return { status: "active", event: "published" };
  }
  return { status: requested, event: "withdrawn" };
}

/** Customer-facing parts of a product a re-review lists (`contentChanges`, variant writes). */
export type ContentField = "name" | "description" | "images" | "price" | "variants" | "gst";

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Which customer-facing parts a product patch really changes (values equal to the current ones don't count, so a
 * "save" that resends everything is not a change). Stock, SKU, slug, tags and channels never count.
 */
export function contentChanges(
  current: { name: string; description: string | null; images: unknown; gstRate: number; hsn: string | null; taxInclusive: boolean; options: unknown },
  patch: { name?: string; description?: string | null; images?: unknown; gstRate?: number; hsn?: string | null; taxInclusive?: boolean; options?: unknown },
): ContentField[] {
  const out = new Set<ContentField>();
  if (patch.name !== undefined && patch.name !== current.name) out.add("name");
  if (patch.description !== undefined && (patch.description ?? null) !== (current.description ?? null)) out.add("description");
  if (patch.images !== undefined && !same(patch.images, current.images)) out.add("images");
  if (patch.gstRate !== undefined && patch.gstRate !== current.gstRate) out.add("gst");
  if (patch.hsn !== undefined && (patch.hsn ?? null) !== (current.hsn ?? null)) out.add("gst");
  if (patch.taxInclusive !== undefined && patch.taxInclusive !== current.taxInclusive) out.add("gst");
  if (patch.options !== undefined && !same(patch.options, current.options)) out.add("variants");
  return [...out];
}

/** The customer-facing parts a variant patch changes: price/MRP, or the option values / title. */
export function variantChanges(
  current: { price: number; mrp: number | null; title: string; optionValues: unknown },
  set: { price?: number; mrp?: number | null; title?: string; optionValues?: unknown },
): ContentField[] {
  const out = new Set<ContentField>();
  if (set.price !== undefined && set.price !== current.price) out.add("price");
  if (set.mrp !== undefined && (set.mrp ?? null) !== (current.mrp ?? null)) out.add("price");
  if (set.title !== undefined && set.title !== current.title) out.add("variants");
  if (set.optionValues !== undefined && !same(set.optionValues, current.optionValues)) out.add("variants");
  return [...out];
}

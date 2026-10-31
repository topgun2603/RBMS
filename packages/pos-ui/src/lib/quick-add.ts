import { GST_RATES, isGstRate } from "@rbms/gst";
import type { CartProduct } from "./cart";
import { rupeesToPaise } from "./format";
import { fromVariant } from "./products";
import type { Product } from "./types";

/**
 * "Not found: add it now" at the counter: validates the form, builds the catalogue product (existing POST
 * /catalog/products, with the barcode and prices in paise), puts the opening stock in through the existing inventory
 * adjust, and returns the cart product. A barcode that already exists (another till got there first, or a double
 * submit) resolves to the existing item instead of failing. Open items are free-text lines that are never saved.
 * Pure apart from the injected calls; unit tested.
 */

export const QUICK_ADD_GST_RATES = GST_RATES;
export const QUICK_ADD_UNITS = ["pcs", "kg", "g", "l", "ml", "m", "box", "pack"] as const;

/** Catalogue permission the create path needs (packages/catalogue features.ts). */
export const QUICK_ADD_PERMISSION = "catalogue.manage";

export interface QuickAddForm {
  barcode: string;
  name: string;
  /** Rupees as typed. */
  price: string;
  gstRate: number;
  taxInclusive: boolean;
  mrp: string;
  cost: string;
  /** Opening stock as typed (blank = none). */
  qty: string;
  unit: string;
  categoryId: string;
}

export type QuickAddErrors = Partial<Record<"name" | "price" | "gstRate" | "mrp" | "cost" | "qty" | "unit" | "barcode", true>>;

export interface QuickAddValues {
  barcode: string;
  name: string;
  price: number;
  gstRate: number;
  taxInclusive: boolean;
  mrp: number | null;
  cost: number | null;
  qty: number;
  unit: string;
  categoryId: string | null;
}

export const emptyQuickAdd = (barcode: string, defaults: { gstRate?: number; unit?: string } = {}): QuickAddForm => ({
  barcode: barcode.trim(),
  name: "",
  price: "",
  gstRate: defaults.gstRate !== undefined && isGstRate(defaults.gstRate) ? defaults.gstRate : 18,
  taxInclusive: true,
  mrp: "",
  cost: "",
  qty: "",
  unit: defaults.unit || "pcs",
  categoryId: "",
});

const optionalPaise = (s: string): number | null | undefined => (s.trim() ? rupeesToPaise(s) : null);
const MAX_PAISE = 10_000_000_000;

export function validateQuickAdd(f: QuickAddForm): { ok: true; values: QuickAddValues } | { ok: false; errors: QuickAddErrors } {
  const errors: QuickAddErrors = {};
  const barcode = f.barcode.trim();
  const name = f.name.trim();
  if (!barcode || barcode.length > 64 || /\s/.test(barcode)) errors.barcode = true;
  if (!name || name.length > 200) errors.name = true;
  const price = rupeesToPaise(f.price);
  if (price === null || price <= 0 || price > MAX_PAISE) errors.price = true;
  if (!isGstRate(f.gstRate)) errors.gstRate = true;
  const mrp = optionalPaise(f.mrp);
  if (mrp === undefined || (mrp !== null && (mrp > MAX_PAISE || (price !== null && mrp < price)))) errors.mrp = true;
  const cost = optionalPaise(f.cost);
  if (cost === undefined || (cost !== null && cost > MAX_PAISE)) errors.cost = true;
  let qty = 0;
  if (f.qty.trim()) {
    const s = f.qty.replace(/[,\s]/g, "");
    const n = /^\d*\.?\d{0,3}$/.test(s) && s !== "." ? Number(s) : Number.NaN;
    if (!Number.isFinite(n) || n < 0 || n > 9_999_999) errors.qty = true;
    else qty = n;
  }
  const unit = f.unit.trim();
  if (!unit || unit.length > 16) errors.unit = true;
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    values: {
      barcode,
      name,
      price: price!,
      gstRate: f.gstRate,
      taxInclusive: f.taxInclusive,
      mrp: mrp ?? null,
      cost: cost ?? null,
      qty,
      unit,
      categoryId: f.categoryId || null,
    },
  };
}

/** The body of POST /catalog/products (the simple-product shorthand: one default variant). */
export function buildProductInput(v: QuickAddValues) {
  return {
    name: v.name,
    unit: v.unit,
    gstRate: v.gstRate,
    taxInclusive: v.taxInclusive,
    status: "active" as const,
    ...(v.categoryId ? { categoryId: v.categoryId } : {}),
    price: v.price,
    barcode: v.barcode,
    ...(v.mrp !== null ? { mrp: v.mrp } : {}),
    ...(v.cost !== null ? { cost: v.cost } : {}),
  };
}

/** The body of POST /inventory/stock/:itemId/adjust for the opening stock. */
export const buildOpeningStock = (v: QuickAddValues) => ({
  mode: "add" as const,
  qty: v.qty,
  note: "Opening stock (added at the counter)",
  ...(v.cost !== null ? { unitCost: v.cost } : {}),
});

/** The catalogue's 409 for a taken barcode (ApiError-shaped, so this stays free of the web package). */
export function isBarcodeTaken(err: unknown): boolean {
  const e = err as { status?: number; message?: string } | null;
  return !!e && e.status === 409 && /barcode/i.test(e.message ?? "");
}

export interface QuickAddDeps {
  createProduct: (body: ReturnType<typeof buildProductInput>) => Promise<Product>;
  /** Exact barcode lookup (existing item or null). */
  lookup: (barcode: string) => Promise<CartProduct | null>;
  /** Null when inventory is off. */
  adjustStock: ((itemId: string, body: ReturnType<typeof buildOpeningStock>) => Promise<unknown>) | null;
}

export interface QuickAddResult {
  product: CartProduct;
  /** The barcode already belonged to an item: it is that item, nothing was created. */
  existing: boolean;
  /** The item was saved but the opening stock could not be recorded. */
  stockFailed: boolean;
}

const inflight = new Map<string, Promise<QuickAddResult>>();

/** Creates the item once per barcode at a time: a second submit of the same barcode shares the first call. */
export function quickAdd(values: QuickAddValues, deps: QuickAddDeps): Promise<QuickAddResult> {
  const running = inflight.get(values.barcode);
  if (running) return running;
  const p = run(values, deps).finally(() => inflight.delete(values.barcode));
  inflight.set(values.barcode, p);
  return p;
}

async function run(values: QuickAddValues, deps: QuickAddDeps): Promise<QuickAddResult> {
  let product: Product;
  try {
    product = await deps.createProduct(buildProductInput(values));
  } catch (err) {
    if (!isBarcodeTaken(err)) throw err;
    const found = await deps.lookup(values.barcode);
    if (!found) throw err;
    return { product: found, existing: true, stockFailed: false };
  }
  const variant = product.variants.find((x) => x.isDefault) ?? product.variants[0];
  if (!variant) throw new Error("The new item has no variant");
  const cartProduct = fromVariant(product, variant);
  let stockFailed = false;
  if (values.qty > 0 && deps.adjustStock) {
    try {
      await deps.adjustStock(variant.id, buildOpeningStock(values));
    } catch {
      stockFailed = true;
    }
  }
  return { product: cartProduct, existing: false, stockFailed };
}

// ---------------------------------------------------------------- open item

const OPEN_PREFIX = "open:";
let openSeq = 0;

/** An open item has no catalogue id: it is billed once and never saved. */
export const isOpenItem = (itemId: string) => itemId.startsWith(OPEN_PREFIX);

export function validateOpenItem(f: { name: string; price: string; gstRate: number; taxInclusive: boolean }): { ok: true; product: CartProduct } | { ok: false } {
  const name = f.name.trim();
  const price = rupeesToPaise(f.price);
  if (!name || name.length > 200 || price === null || price <= 0 || price > MAX_PAISE || !isGstRate(f.gstRate)) return { ok: false };
  return {
    ok: true,
    product: { itemId: `${OPEN_PREFIX}${Date.now().toString(36)}${(openSeq++).toString(36)}`, name, unit: "pcs", price, taxInclusive: f.taxInclusive, gstRate: f.gstRate },
  };
}

/**
 * Whether a miss should open the add dialog: a barcode-like code (not a name being searched), online, and the staff
 * member can either create the item or bill it as an open item.
 */
export function shouldOfferQuickAdd(o: { code: string; looksLikeCode: boolean; online: boolean; canCreate: boolean; canOpenItem: boolean }): boolean {
  return !!o.code.trim() && o.looksLikeCode && o.online && (o.canCreate || o.canOpenItem);
}

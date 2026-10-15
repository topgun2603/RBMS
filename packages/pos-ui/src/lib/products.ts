import type { CartProduct } from "./cart";
import type { BillingItem, CatalogVariant, Product, VariantLookup } from "./types";

/** "Product – M / Red" (the catalogue's item name). */
export const itemName = (product: string, variant: string) => (variant.trim() ? `${product} – ${variant}` : product);

export function fromLookup(v: VariantLookup): CartProduct {
  return {
    itemId: v.id,
    productId: v.productId,
    name: v.name || itemName(v.productName, v.title),
    sku: v.sku,
    barcode: v.barcode,
    hsn: v.hsn,
    unit: v.unit || "pcs",
    price: v.price,
    taxInclusive: v.taxInclusive,
    gstRate: v.gstRate,
    image: v.image,
  };
}

export function fromVariant(p: Product, v: CatalogVariant): CartProduct {
  return {
    itemId: v.id,
    productId: p.id,
    name: itemName(p.name, v.title),
    sku: v.sku,
    barcode: v.barcode,
    hsn: p.hsn,
    unit: p.unit || "pcs",
    price: v.price,
    taxInclusive: p.taxInclusive,
    gstRate: p.gstRate,
    image: p.images[0]?.url ?? null,
  };
}

/** Billing items (catalogue off) have GST-exclusive rates. */
export function fromBillingItem(i: BillingItem): CartProduct {
  return { itemId: i.id, name: i.name, hsn: i.hsn, unit: i.unit || "pcs", price: i.rate, taxInclusive: false, gstRate: i.gstRate };
}

/** Variants a product can be sold as (all of them; the default one first for simple products). */
export const sellableVariants = (p: Product) => [...p.variants].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));

/** Looks like a barcode / SKU rather than a name: no spaces, has a digit, 4+ characters. */
export const looksLikeCode = (q: string) => /^[A-Za-z0-9._/-]{4,64}$/.test(q.trim()) && /\d/.test(q);

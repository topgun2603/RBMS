// Pure store views of automatic offers: product badges, bundle cards ("Buy together and save ₹X") and the lines a
// bundle adds to the cart. No I/O.
import { isSellable } from "./pricing";
import type { PublicOfferView, StoreProductSummary, StoreVariant } from "./ports";

interface BundleConfigView {
  items: { productId: string; variantId: string | null; qty: number }[];
  priceType: "fixed" | "percent";
  value: number;
}

/** A variant a shopper may pick for an "any variant" bundle item. */
export interface BundleOption {
  variantId: string;
  title: string;
  price: number;
}

export interface BundleItemView {
  productId: string;
  /** Fixed by the bundle, or null = the shopper picks one of `options`. */
  variantId: string | null;
  qty: number;
  name: string;
  slug: string;
  image: string | null;
  variantTitle: string;
  /** Paise per unit: the fixed variant's price, else the cheapest option. */
  price: number;
  /** Sellable variants to pick from (any-variant items); one entry = picked for the shopper. */
  options: BundleOption[];
  /** What the pick chooses: the product's option names ("Size", "Size / Colour"); "" when the product has none. */
  optionLabel: string;
  available: boolean;
}

export interface BundleView {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
  label: string;
  priceType: "fixed" | "percent";
  value: number;
  endsAt: Date | null;
  items: BundleItemView[];
  /** Σ item price × qty (paise). */
  regular: number;
  /** What the set costs. */
  price: number;
  /** regular − price. */
  save: number;
  /** Every item can be bought now. */
  available: boolean;
}

/** An offer badge for a product page / card. */
export interface OfferBadge {
  id: string;
  kind: string;
  name: string;
  label: string;
  description: string | null;
  /** Kind-specific numbers the store translates (buyQty, getQty, getPercent, min, value…). */
  config: unknown;
  endsAt: Date | null;
}

export const toBadge = (o: PublicOfferView): OfferBadge => ({ id: o.id, kind: o.kind, name: o.name, label: o.label, description: o.description, config: o.config, endsAt: o.endsAt });

/** Set price of a bundle for a regular price. */
export function bundlePrice(cfg: Pick<BundleConfigView, "priceType" | "value">, regular: number): number {
  if (regular <= 0) return 0;
  if (cfg.priceType === "fixed") return Math.min(cfg.value, regular);
  return regular - Math.round((regular * Math.min(100, Math.max(0, cfg.value))) / 100);
}

/** The label of a bundle item's variant pick: the product's option names ("Size", "Size / Colour"). */
const optionLabel = (p: StoreProductSummary | undefined): string => (p?.optionNames ?? []).map((n) => n.trim()).filter(Boolean).join(" / ");

/**
 * A bundle with its products: names, images, prices, the choices for any-variant items, and the saving. Items whose
 * product isn't on sale any more make the bundle unavailable (it is still returned so callers can decide).
 */
export function buildBundleView(offer: PublicOfferView, products: ReadonlyMap<string, StoreProductSummary>, variants: ReadonlyMap<string, StoreVariant>): BundleView {
  const cfg = offer.config as BundleConfigView;
  const items: BundleItemView[] = (cfg.items ?? []).map((it) => {
    const p = products.get(it.productId);
    const onSale = !!p && p.status === "active" && p.channels.includes("store");
    if (it.variantId) {
      const v = variants.get(it.variantId);
      const ok = onSale && !!v && isSellable(v) && v.productId === it.productId;
      return {
        productId: it.productId,
        variantId: it.variantId,
        qty: it.qty,
        name: p?.name ?? v?.productName ?? "",
        slug: p?.slug ?? v?.productSlug ?? "",
        image: v?.image ?? p?.image ?? null,
        variantTitle: v?.title ?? "",
        price: v?.price ?? p?.priceMin ?? 0,
        options: v && ok ? [{ variantId: v.id, title: v.title, price: v.price }] : [],
        optionLabel: optionLabel(p),
        available: ok,
      };
    }
    const options = (p?.variantIds ?? [])
      .map((id) => variants.get(id))
      .filter((v): v is StoreVariant => !!v && isSellable(v) && v.productId === it.productId)
      .map((v) => ({ variantId: v.id, title: v.title, price: v.price }));
    const cheapest = options.length ? Math.min(...options.map((o) => o.price)) : (p?.priceMin ?? 0);
    return {
      productId: it.productId,
      variantId: null,
      qty: it.qty,
      name: p?.name ?? "",
      slug: p?.slug ?? "",
      image: p?.image ?? null,
      variantTitle: options.length === 1 ? options[0]!.title : "",
      price: cheapest,
      options,
      optionLabel: optionLabel(p),
      available: onSale && options.length > 0,
    };
  });
  const regular = items.reduce((s, i) => s + i.price * i.qty, 0);
  const price = bundlePrice(cfg, regular);
  return {
    id: offer.id,
    slug: offer.slug,
    name: offer.name,
    description: offer.description,
    imageUrl: offer.imageUrl,
    label: offer.label,
    priceType: cfg.priceType,
    value: cfg.value,
    endsAt: offer.endsAt,
    items,
    regular,
    price,
    save: Math.max(0, regular - price),
    available: items.length >= 2 && items.every((i) => i.available),
  };
}

/** Product and variant ids a set of bundles needs to be shown. */
export function bundleRefs(offers: readonly PublicOfferView[]): { productIds: string[]; variantIds: string[] } {
  const productIds = new Set<string>();
  const variantIds = new Set<string>();
  for (const o of offers) {
    for (const it of (o.config as BundleConfigView).items ?? []) {
      productIds.add(it.productId);
      if (it.variantId) variantIds.add(it.variantId);
    }
  }
  return { productIds: [...productIds], variantIds: [...variantIds] };
}

export type BundlePickError = { code: "unavailable"; productId: string } | { code: "choose_variant"; productId: string };

/**
 * The cart lines a bundle adds: each item's fixed variant, or the shopper's pick among its options (a single option
 * is picked for them). `picks` maps productId → variantId. Quantities are multiplied by `sets`.
 */
export function bundleLines(view: BundleView, picks: Readonly<Record<string, string>>, sets = 1): { ok: true; lines: { variantId: string; qty: number }[] } | { ok: false; error: BundlePickError } {
  const out = new Map<string, number>();
  for (const it of view.items) {
    if (!it.available) return { ok: false, error: { code: "unavailable", productId: it.productId } };
    let variantId = it.variantId;
    if (!variantId) {
      const pick = picks[it.productId];
      if (pick && it.options.some((o) => o.variantId === pick)) variantId = pick;
      else if (it.options.length === 1) variantId = it.options[0]!.variantId;
      else return { ok: false, error: { code: "choose_variant", productId: it.productId } };
    }
    out.set(variantId, (out.get(variantId) ?? 0) + it.qty * sets);
  }
  return { ok: true, lines: [...out].map(([variantId, qty]) => ({ variantId, qty })) };
}

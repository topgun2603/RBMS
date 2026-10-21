import type { StoreThemeView } from "../types";

/** Stock state a card shows: plenty (no badge), a few left, or sold out (every variant). */
export type CardStock = "in" | "low" | "out";

/** "New" lasts this long after a product is added. */
export const NEW_FOR_DAYS = 30;

/**
 * Products that get the "New" badge: added in the last NEW_FOR_DAYS days — unless most of the list is that new (a
 * shop that just opened, or a bulk import), where the badge would be on everything and mean nothing.
 */
export function freshIds(products: readonly { id: string; createdAt?: string }[], now = Date.now()): Set<string> {
  const cutoff = now - NEW_FOR_DAYS * 86_400_000;
  const fresh = products.filter((p) => p.createdAt && Date.parse(p.createdAt) >= cutoff).map((p) => p.id);
  return fresh.length > products.length / 2 ? new Set() : new Set(fresh);
}

/** A product's stock from its variants' availability; null when nothing is known (no badge). */
export function stockOf(variantIds: readonly string[] | undefined, availability: ReadonlyMap<string, { inStock: boolean; lowStock: boolean }>): CardStock | null {
  const rows = (variantIds ?? []).map((id) => availability.get(id)).filter((r): r is { inStock: boolean; lowStock: boolean } => !!r);
  if (!rows.length) return null;
  if (rows.every((r) => !r.inStock)) return "out";
  // "Few left" only when no variant has plenty.
  return rows.some((r) => r.inStock && !r.lowStock) ? "in" : "low";
}

export type CardBadge = { kind: "sale" | "new" | "low" | "out"; label: string };

/** The badges on a card, most important first (sold out hides the others; at most two). */
export function cardBadges({ pct, fresh, stock }: { pct: number; fresh: boolean; stock: CardStock | null }, t: (key: string, vars?: Record<string, string | number>) => string): CardBadge[] {
  if (stock === "out") return [{ kind: "out", label: t("product.outOfStock") }];
  const out: CardBadge[] = [];
  if (pct > 0) out.push({ kind: "sale", label: t("product.off", { pct }) });
  if (stock === "low") out.push({ kind: "low", label: t("card.fewLeft") });
  if (fresh) out.push({ kind: "new", label: t("card.new") });
  return out.slice(0, 2);
}

/** Which hover effects a card runs for the theme's `cardHover` (swap falls back to zoom without a second photo). */
export function hoverEffects(hover: StoreThemeView["cardHover"], hasSecond: boolean): { lift: boolean; zoom: boolean; swap: boolean } {
  switch (hover) {
    case "rich":
      return { lift: true, zoom: true, swap: hasSecond };
    case "zoom":
      return { lift: false, zoom: true, swap: false };
    case "swap":
      return { lift: false, zoom: !hasSecond, swap: hasSecond };
    case "lift":
      return { lift: true, zoom: false, swap: false };
    default:
      return { lift: false, zoom: false, swap: false };
  }
}

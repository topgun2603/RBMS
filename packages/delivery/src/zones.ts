import { normalizePincode } from "./pincode";
import type { RateType, WeightSlab } from "./schema";

/** What zone matching needs from a `delivery_zones` row. */
export interface ZoneRule {
  id: string;
  name: string;
  states: string[];
  pincodePrefixes: string[];
  pincodes: string[];
  active: boolean;
  sort: number;
}

/** What rate calculation needs from a `delivery_rates` row. Money in paise. */
export interface RateRule {
  id: string;
  zoneId: string;
  name: string;
  type: RateType;
  amount: number;
  freeAbove: number | null;
  weightSlabs: WeightSlab[];
  etaMinDays: number;
  etaMaxDays: number;
  codAllowed: boolean;
  codFee: number;
  active: boolean;
  sort: number;
}

export interface QuoteInput {
  pincode: string;
  /** 2-digit GST state code of the address, when known. */
  stateCode?: string | null;
  weightGrams: number;
  /** Paise. */
  subtotal: number;
  /** The shopper wants to pay cash on delivery: only COD-capable options are returned. */
  cod: boolean;
}

export interface DeliveryOption {
  /** Rate id (`"default"` for the implicit All India rate). */
  id: string;
  name: string;
  /** Paise, shipping only (the COD fee is separate). */
  amount: number;
  etaDays: [number, number];
  codAllowed: boolean;
  /** Paise; 0 when COD isn't allowed. */
  codFee: number;
}

export interface Quote {
  serviceable: boolean;
  options: DeliveryOption[];
  /** The zone that matched (additive to the contract; handy for the staff "test quote"). */
  zone: { id: string; name: string } | null;
}

export type ZoneMatchKind = "pincode" | "prefix" | "state" | "rest";

export interface ZoneMatch<Z extends ZoneRule = ZoneRule> {
  zone: Z;
  by: ZoneMatchKind;
}

/**
 * The implicit zone of a tenant with no active zones: "All India", one flat ₹0 rate (2–7 days, COD allowed, no COD fee),
 * so checkout works out of the box. It disappears as soon as the shop creates an active zone.
 */
export const DEFAULT_ZONE: ZoneRule = {
  id: "default",
  name: "All India",
  states: [],
  pincodePrefixes: [],
  pincodes: [],
  active: true,
  sort: 0,
};

export const DEFAULT_RATE: RateRule = {
  id: "default",
  zoneId: "default",
  name: "Standard delivery",
  type: "flat",
  amount: 0,
  freeAbove: null,
  weightSlabs: [],
  etaMinDays: 2,
  etaMaxDays: 7,
  codAllowed: true,
  codFee: 0,
  active: true,
  sort: 0,
};

const bySortThenName = (a: ZoneRule, b: ZoneRule) => a.sort - b.sort || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

export const hasNoRules = (z: ZoneRule) => z.states.length === 0 && z.pincodePrefixes.length === 0 && z.pincodes.length === 0;

/**
 * Picks the zone for a pincode among the active zones: exact pincode > longest prefix > state > a zone with no rules
 * ("Rest of India"). Ties go to the lower `sort`, then the name. Null when nothing matches (not serviceable).
 */
export function matchZone<Z extends ZoneRule>(zones: readonly Z[], pincode: string, stateCode?: string | null): ZoneMatch<Z> | null {
  const pin = normalizePincode(pincode);
  if (!pin) return null;
  const active = zones.filter((z) => z.active).sort(bySortThenName);

  const exact = active.find((z) => z.pincodes.includes(pin));
  if (exact) return { zone: exact, by: "pincode" };

  let best: Z | null = null;
  let bestLen = 0;
  for (const z of active) {
    for (const p of z.pincodePrefixes) {
      if (p.length > bestLen && pin.startsWith(p)) {
        best = z;
        bestLen = p.length;
      }
    }
  }
  if (best) return { zone: best, by: "prefix" };

  if (stateCode) {
    const byState = active.find((z) => z.states.includes(stateCode));
    if (byState) return { zone: byState, by: "state" };
  }

  const rest = active.find(hasNoRules);
  return rest ? { zone: rest, by: "rest" } : null;
}

/** True when matching may need the address state (no pincode/prefix hit, and some active zone has state rules). */
export function needsState(zones: readonly ZoneRule[], pincode: string): boolean {
  const pin = normalizePincode(pincode);
  if (!pin) return false;
  const active = zones.filter((z) => z.active);
  if (!active.some((z) => z.states.length > 0)) return false;
  return !active.some((z) => z.pincodes.includes(pin) || z.pincodePrefixes.some((p) => pin.startsWith(p)));
}

/**
 * Shipping charge of one rate in paise, or null when the rate doesn't apply (inactive, or the parcel is heavier than the
 * last weight slab). `flat` / `free_above` charge `amount`; `weight` charges the first slab with weight ≤ upToGrams.
 * Any rate with `freeAbove` set is free when subtotal ≥ freeAbove.
 */
export function rateAmount(rate: RateRule, input: { weightGrams: number; subtotal: number }): number | null {
  if (!rate.active) return null;
  let base: number;
  if (rate.type === "weight") {
    const weight = Math.max(0, Math.ceil(input.weightGrams || 0));
    const slab = [...rate.weightSlabs].sort((a, b) => a.upToGrams - b.upToGrams).find((s) => weight <= s.upToGrams);
    if (!slab) return null;
    base = slab.amount;
  } else {
    base = rate.amount;
  }
  if (rate.freeAbove !== null && rate.freeAbove !== undefined && input.subtotal >= rate.freeAbove) return 0;
  return Math.max(0, Math.round(base));
}

/** Options from a zone's rates, ordered by `sort` then price. With `cod`, rates that don't allow COD are left out. */
export function buildOptions(rates: readonly RateRule[], input: QuoteInput): DeliveryOption[] {
  const out: { opt: DeliveryOption; sort: number }[] = [];
  for (const r of rates) {
    const amount = rateAmount(r, input);
    if (amount === null) continue;
    if (input.cod && !r.codAllowed) continue;
    const min = Math.max(0, r.etaMinDays);
    out.push({
      sort: r.sort,
      opt: {
        id: r.id,
        name: r.name,
        amount,
        etaDays: [min, Math.max(min, r.etaMaxDays)],
        codAllowed: r.codAllowed,
        codFee: r.codAllowed ? Math.max(0, r.codFee) : 0,
      },
    });
  }
  return out.sort((a, b) => a.sort - b.sort || a.opt.amount - b.opt.amount || a.opt.name.localeCompare(b.opt.name)).map((o) => o.opt);
}

/**
 * The whole quote, pure: no active zones → the implicit All India ₹0 rate; otherwise the matched zone's active rates.
 * An invalid pincode is never serviceable.
 */
export function quoteFromRules(zones: readonly ZoneRule[], rates: readonly RateRule[], input: QuoteInput): Quote {
  if (!normalizePincode(input.pincode)) return { serviceable: false, options: [], zone: null };
  const active = zones.filter((z) => z.active);
  if (active.length === 0) {
    const options = buildOptions([DEFAULT_RATE], input);
    return { serviceable: options.length > 0, options, zone: { id: DEFAULT_ZONE.id, name: DEFAULT_ZONE.name } };
  }
  const match = matchZone(active, input.pincode, input.stateCode);
  if (!match) return { serviceable: false, options: [], zone: null };
  const options = buildOptions(
    rates.filter((r) => r.zoneId === match.zone.id),
    input,
  );
  return { serviceable: options.length > 0, options, zone: { id: match.zone.id, name: match.zone.name } };
}

/** Finds the option a shopper picked; null when it isn't offered (anymore) for this input. */
export function findOption(quote: Quote, optionId: string): DeliveryOption | null {
  return quote.options.find((o) => o.id === optionId) ?? null;
}

/**
 * The lowest order amount (paise) at which a zone ships free: a `freeAbove` threshold, or 0 when a rate is already
 * free (flat ₹0). Null when no active rate of the zone ever gets free.
 */
export function zoneFreeThreshold(rates: readonly RateRule[]): number | null {
  let best: number | null = null;
  for (const r of rates) {
    if (!r.active) continue;
    let t: number | null = null;
    if (r.type !== "weight" && Math.round(r.amount) <= 0) t = 0;
    else if (r.freeAbove !== null && r.freeAbove !== undefined) t = Math.max(0, r.freeAbove);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

export interface FreeShippingInfo {
  /** Paise of goods (after discounts) from which delivery is free; null = no free delivery. */
  threshold: number | null;
  /** "zone": for this pincode; "shop": everywhere the shop delivers (the highest zone threshold). */
  scope: "zone" | "shop";
}

/**
 * Free-delivery threshold for the cart's "Add ₹X more for free delivery" bar (pure). With a pincode: its zone's
 * threshold. Without: a threshold that holds in every active zone (the highest), or null when some zone never ships
 * free. No active zones = the implicit free All India rate (0).
 */
export function freeShippingFromRules(zones: readonly ZoneRule[], rates: readonly RateRule[], input: { pincode?: string | null; stateCode?: string | null } = {}): FreeShippingInfo {
  const active = zones.filter((z) => z.active);
  if (active.length === 0) return { threshold: zoneFreeThreshold([DEFAULT_RATE]), scope: input.pincode ? "zone" : "shop" };
  if (input.pincode && normalizePincode(input.pincode)) {
    const match = matchZone(active, input.pincode, input.stateCode);
    if (!match) return { threshold: null, scope: "zone" };
    return { threshold: zoneFreeThreshold(rates.filter((r) => r.zoneId === match.zone.id)), scope: "zone" };
  }
  let worst = 0;
  for (const z of active) {
    const t = zoneFreeThreshold(rates.filter((r) => r.zoneId === z.id));
    if (t === null) return { threshold: null, scope: "shop" };
    worst = Math.max(worst, t);
  }
  return { threshold: worst, scope: "shop" };
}

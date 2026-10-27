import type { CartProduct } from "./cart";
import { findByCode, findUnitByCode, fromPosItem, type CatalogIndex } from "./catalog-sync";
import { inUnit } from "./units";
import type { WeighTicket } from "./terminal-types";
import { isTicketCode, normalizeTicketCode, ticketErrorOf } from "./weigh-ticket";

/**
 * What a scanned / typed code is, in this order: a weigh-ticket code (W + 11 digits, when weigh tickets are on) → the
 * cached catalogue (barcode, then SKU; instant and offline) → the server's lookup and counter resolvers (barcode / SKU,
 * then scale labels, serials and ticket codes). Pure apart from the injected calls; unit tested.
 */

export type ScanHit =
  | { kind: "ticket"; ticket: WeighTicket }
  | { kind: "ticketError"; code: string; error: ReturnType<typeof ticketErrorOf> }
  | { kind: "item"; product: CartProduct; soldBy: "unit" | "weight" | null; qty?: number; serial?: string; source: "cache" | "server" }
  | { kind: "miss" };

export interface ServerHit {
  /** Absent when the resolver answered with a weigh ticket. */
  product?: CartProduct;
  qty?: number;
  serial?: string;
  weighTicket?: WeighTicket;
}

export interface ScanDeps {
  cache: CatalogIndex | null;
  /** Feature pos.weighing (ticket codes are looked up). */
  tickets: boolean;
  getTicket: (code: string) => Promise<WeighTicket>;
  /** The existing lookup → resolve path (null = nothing matched). Network errors are thrown. */
  server: (code: string) => Promise<ServerHit | null>;
}

export async function resolveScan(raw: string, deps: ScanDeps): Promise<ScanHit> {
  const code = raw.trim();
  if (!code) return { kind: "miss" };
  if (deps.tickets && isTicketCode(code)) {
    const c = normalizeTicketCode(code);
    try {
      return { kind: "ticket", ticket: await deps.getTicket(c) };
    } catch (err) {
      const error = ticketErrorOf(err);
      if (error === "network") throw err;
      return { kind: "ticketError", code: c, error };
    }
  }
  const cached = deps.cache ? findByCode(deps.cache, code) : null;
  if (cached) {
    const p = fromPosItem(cached);
    return { kind: "item", product: p, soldBy: p.soldBy, source: "cache" };
  }
  // A box's (alternate unit's) barcode: one box, never weighed.
  const boxed = deps.cache ? findUnitByCode(deps.cache, code) : null;
  if (boxed) return { kind: "item", product: inUnit(fromPosItem(boxed.item), boxed.unit), soldBy: "unit", source: "cache" };
  const hit = await deps.server(code);
  if (!hit) return { kind: "miss" };
  if (hit.weighTicket) return { kind: "ticket", ticket: hit.weighTicket };
  if (!hit.product) return { kind: "miss" };
  return { kind: "item", product: hit.product, soldBy: null, qty: hit.qty, serial: hit.serial, source: "server" };
}

const WEIGHT_UNITS = /^(kg|kgs|g|gm|gms|gram|grams)$/i;

/** An item hit without a weight (not a scale label) that is sold by weight: the counter asks for the weight. */
export function needsWeight(hit: Extract<ScanHit, { kind: "item" }>): boolean {
  if (hit.qty !== undefined || hit.serial) return false;
  return hit.soldBy === "weight" || (hit.soldBy === null && WEIGHT_UNITS.test(hit.product.unit.trim()));
}

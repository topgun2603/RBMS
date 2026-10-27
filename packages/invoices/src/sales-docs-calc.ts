/**
 * Pure rules of proforma invoices, sale orders and delivery challans (no database): settings, derived statuses, who may
 * do what, and the per-line fulfilment arithmetic (ordered, delivered, invoiced). docs/sales-documents.md.
 */
import { sanitizePrefix, type LineInput, type LineTotals } from "@srirealtime/gst";
import { addDaysISO } from "./ledger";
import type {
  ChallanReason,
  ChallanStatus,
  ProformaDisplayStatus,
  ProformaStatus,
  SaleOrderStatus,
  SalesDocKind,
  SalesDocLine,
} from "./schema-sales";
import { toLineInput } from "./service";

export const DEFAULT_SALES_DOC_PREFIX: Record<SalesDocKind, string> = { proforma: "PI", sale_order: "SO", challan: "DC" };
export const DEFAULT_PROFORMA_VALIDITY_DAYS = 15;

/** Shop settings of the "sales-docs" namespace (apps/api app-settings.ts), with defaults filled in. */
export interface SalesDocSettings {
  proformaPrefix: string;
  saleOrderPrefix: string;
  challanPrefix: string;
  /** Days a proforma is valid when none is chosen; 0 = no expiry. */
  proformaValidityDays: number;
  proformaTerms: string | null;
  saleOrderTerms: string | null;
  challanTerms: string | null;
  /** Advance % new proformas and sale orders start with (1-100); null = none. */
  advancePercent: number | null;
  /** New sale orders hold stock for what is not delivered yet. */
  reserveStock: boolean;
}

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const prefixOf = (v: unknown, fallback: string) => {
  const p = typeof v === "string" && v.trim() ? sanitizePrefix(v) : fallback;
  return p || fallback;
};

/** Fills a possibly partial settings object. */
export function normalizeSalesDocSettings(raw: Partial<Record<keyof SalesDocSettings, unknown>> | null | undefined): SalesDocSettings {
  const days = Number(raw?.proformaValidityDays ?? DEFAULT_PROFORMA_VALIDITY_DAYS);
  const advance = raw?.advancePercent == null || raw.advancePercent === "" ? NaN : Number(raw.advancePercent);
  return {
    proformaPrefix: prefixOf(raw?.proformaPrefix, DEFAULT_SALES_DOC_PREFIX.proforma),
    saleOrderPrefix: prefixOf(raw?.saleOrderPrefix, DEFAULT_SALES_DOC_PREFIX.sale_order),
    challanPrefix: prefixOf(raw?.challanPrefix, DEFAULT_SALES_DOC_PREFIX.challan),
    proformaValidityDays: Number.isInteger(days) && days >= 0 && days <= 365 ? days : DEFAULT_PROFORMA_VALIDITY_DAYS,
    proformaTerms: text(raw?.proformaTerms),
    saleOrderTerms: text(raw?.saleOrderTerms),
    challanTerms: text(raw?.challanTerms),
    advancePercent: Number.isInteger(advance) && advance >= 1 && advance <= 100 ? advance : null,
    reserveStock: raw?.reserveStock === true,
  };
}

export function prefixFor(kind: SalesDocKind, s: SalesDocSettings): string {
  return kind === "proforma" ? s.proformaPrefix : kind === "sale_order" ? s.saleOrderPrefix : s.challanPrefix;
}

/** Valid-until of a new proforma: `days` after the date, or none when the shop's validity is 0. */
export function proformaValidUntil(date: string, days: number): string | null {
  return days > 0 ? addDaysISO(date, days) : null;
}

/** The advance (paise) asked for: `percent` of the total, rounded to the paisa; 0 without a percentage. */
export function advanceFor(total: number, percent: number | null | undefined): number {
  if (!percent || percent <= 0 || total <= 0) return 0;
  return Math.min(Math.round((total * Math.min(percent, 100)) / 100), total);
}

/** Short random key of a document line (fulfilment is tracked per key). */
export function lineKey(random: () => number = Math.random): string {
  return Math.floor(random() * 36 ** 8)
    .toString(36)
    .padStart(8, "0");
}

/** Gives each computed line a key: the old line's key when it is the same position and item, else a new one. */
export function keyLines(lines: LineTotals[], previous: readonly SalesDocLine[] = [], newKey: () => string = lineKey): SalesDocLine[] {
  const used = new Set<string>();
  return lines.map((l, i) => {
    const old = previous[i];
    const same = old && (old.itemId ?? null) === (l.itemId ?? null) && old.description === l.description && !used.has(old.key);
    let key = same ? old.key : newKey();
    while (used.has(key)) key = newKey();
    used.add(key);
    return { ...l, key };
  });
}

// ------------------------------------------------------------------ proforma

export function proformaDisplayStatus(p: { status: ProformaStatus; validUntil: string | null }, today: string): ProformaDisplayStatus {
  if (p.status === "issued" && p.validUntil && p.validUntil < today) return "expired";
  return p.status;
}

export function proformaEditProblem(p: { status: ProformaStatus }): string | null {
  if (p.status === "converted") return "This proforma was already billed";
  if (p.status === "cancelled") return "This proforma is cancelled";
  return null;
}

export function proformaConvertProblem(p: { status: ProformaStatus }, billGone = false): string | null {
  if (p.status === "cancelled") return "This proforma is cancelled";
  if (p.status === "converted" && !billGone) return "This proforma was already billed";
  return null;
}

export function proformaCancelProblem(p: { status: ProformaStatus }): string | null {
  if (p.status === "cancelled") return "This proforma is already cancelled";
  if (p.status === "converted") return "This proforma was already billed; cancel the bill instead";
  return null;
}

/** Recording an advance needs a live document and a saved customer (advances are kept in the customer's credit book). */
export function advanceProblem(d: { customerId: string | null; status: string }, amount: number, total: number, alreadyReceived: number): string | null {
  if (d.status === "cancelled" || d.status === "converted" || d.status === "invoiced") return "Advances can only be taken against an open document";
  if (!d.customerId) return "Save the customer first: advances are kept in the customer's credit book";
  if (!Number.isInteger(amount) || amount <= 0) return "Enter the advance amount";
  if (alreadyReceived + amount > total) return "The advances can't be more than the document total";
  return null;
}

// ------------------------------------------------------------------ partial lines

/**
 * The bill / challan line for `qty` of a document line: same rate and GST, the discount (and a tax-inclusive total) in
 * proportion. Serial numbers stay only when the whole quantity goes.
 */
export function partialLine(l: LineTotals, qty: number): LineInput {
  const base = toLineInput(l);
  if (qty >= l.qty) return base;
  const share = qty / l.qty;
  const out: LineInput = { ...base, qty };
  if (base.discount) out.discount = Math.round(base.discount * share);
  else delete out.discount;
  if (base.inclusiveTotal !== undefined) out.inclusiveTotal = Math.round(base.inclusiveTotal * share);
  delete out.serials;
  return out;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Sums quantities per key. */
export function qtyByKey(rows: readonly { key: string; qty: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.key, round3((m.get(r.key) ?? 0) + r.qty));
  return m;
}

/**
 * Checks requested quantities against what is left per key: every key must exist, quantities > 0 and within what is
 * left. Returns the problem or null.
 */
export function quantityProblem(
  requested: readonly { key: string; qty: number }[],
  left: ReadonlyMap<string, number>,
  label: (key: string) => string = (k) => k,
): string | null {
  if (requested.length === 0) return "Choose at least one line";
  const asked = qtyByKey(requested);
  for (const [key, qty] of asked) {
    if (!left.has(key)) return "A line doesn't belong to this document";
    if (!(qty > 0)) return "Quantities must be more than 0";
    if (qty > (left.get(key) ?? 0) + 1e-9) return `Only ${round3(left.get(key) ?? 0)} left of ${label(key)}`;
  }
  return null;
}

// ------------------------------------------------------------------ challans

/** Quantity sent, returned and still out per line. */
export function challanNet(c: { lines: readonly SalesDocLine[]; returns: readonly { lines: { key: string; qty: number }[] }[] }) {
  const back = qtyByKey(c.returns.flatMap((r) => r.lines));
  return c.lines.map((l) => {
    const returned = Math.min(back.get(l.key) ?? 0, l.qty);
    return { key: l.key, orderLineKey: l.orderLineKey ?? null, itemId: l.itemId ?? null, sent: l.qty, returned, net: round3(l.qty - returned) };
  });
}

/** issued / partly_returned / returned from the returns (invoiced and cancelled are set by those actions). */
export function challanReturnStatus(c: Parameters<typeof challanNet>[0]): Extract<ChallanStatus, "issued" | "partly_returned" | "returned"> {
  const net = challanNet(c);
  const back = net.reduce((s, l) => s + l.returned, 0);
  if (back <= 0) return "issued";
  return net.every((l) => l.net <= 0) ? "returned" : "partly_returned";
}

/** What staff see: an invoiced challan whose bill was cancelled or deleted reads as its return status again. */
export function challanDisplayStatus(c: Parameters<typeof challanNet>[0] & { status: ChallanStatus }, billGone: boolean): ChallanStatus {
  if (c.status === "invoiced" && billGone) return challanReturnStatus(c);
  return c.status;
}

/** Reasons whose goods are sold (and so billed): on approval and delivery before the bill. */
export const BILLABLE_CHALLAN_REASONS: readonly ChallanReason[] = ["approval", "before_invoice"];

export function challanReturnProblem(c: { status: ChallanStatus }): string | null {
  if (c.status === "cancelled") return "This challan is cancelled";
  if (c.status === "invoiced") return "This challan was already billed; take returns with a credit note on the bill";
  if (c.status === "returned") return "Everything on this challan has come back";
  return null;
}

export function challanInvoiceProblem(c: Parameters<typeof challanNet>[0] & { status: ChallanStatus; reason: ChallanReason }): string | null {
  if (c.status === "cancelled") return "This challan is cancelled";
  if (c.status === "invoiced") return "This challan was already billed";
  if (!BILLABLE_CHALLAN_REASONS.includes(c.reason)) return "Only challans for goods on approval or delivered before the bill are billed";
  if (challanNet(c).every((l) => l.net <= 0)) return "Everything on this challan came back; there is nothing to bill";
  return null;
}

export function challanCancelProblem(c: { status: ChallanStatus }): string | null {
  if (c.status === "cancelled") return "This challan is already cancelled";
  if (c.status === "invoiced") return "This challan was billed; cancel the bill first";
  return null;
}

/** Vehicle numbers are printed upper-case without spaces or dashes: "tn 01 ab-1234" → "TN01AB1234". */
export const normalizeVehicle = (v: string) => v.toUpperCase().replace(/[\s.\-/]/g, "");

/** Consignments above ₹50,000 usually need an e-way bill (Rule 138); a hint only, the portal decides. */
export const EWB_HINT_PAISE = 50_000_00;
export function ewayBillHint(total: number): boolean {
  return total > EWB_HINT_PAISE;
}

// ------------------------------------------------------------------ sale order fulfilment

export interface OrderLineProgress {
  key: string;
  description: string;
  unit: string | null;
  itemId: string | null;
  ordered: number;
  /** On live challans (sent less returned) plus billed directly. */
  delivered: number;
  /** Billed directly plus on billed challans. */
  invoiced: number;
  /** Not delivered yet. */
  toDeliver: number;
  /** Delivered on challans that are not billed yet (billed by billing those challans). */
  onChallans: number;
}

export interface OrderFulfilmentInput {
  /** Live (not cancelled) challans of the order. */
  challans: readonly { lines: readonly SalesDocLine[]; returns: readonly { lines: { key: string; qty: number }[] }[]; billed: boolean }[];
  /** Live bills made straight from the order. */
  bills: readonly { lines: readonly { key: string; qty: number }[] }[];
}

/** Ordered, delivered and invoiced per order line. */
export function orderProgress(lines: readonly SalesDocLine[], f: OrderFulfilmentInput): OrderLineProgress[] {
  const challanNetByKey = new Map<string, { net: number; billed: number }>();
  for (const c of f.challans) {
    for (const n of challanNet(c)) {
      if (!n.orderLineKey) continue;
      const cur = challanNetByKey.get(n.orderLineKey) ?? { net: 0, billed: 0 };
      cur.net = round3(cur.net + n.net);
      if (c.billed) cur.billed = round3(cur.billed + n.net);
      challanNetByKey.set(n.orderLineKey, cur);
    }
  }
  const direct = qtyByKey(f.bills.flatMap((b) => b.lines));
  return lines.map((l) => {
    const ch = challanNetByKey.get(l.key) ?? { net: 0, billed: 0 };
    const billed = direct.get(l.key) ?? 0;
    const delivered = round3(ch.net + billed);
    return {
      key: l.key,
      description: l.description,
      unit: l.unit ?? null,
      itemId: l.itemId ?? null,
      ordered: l.qty,
      delivered,
      invoiced: round3(billed + ch.billed),
      toDeliver: round3(Math.max(l.qty - delivered, 0)),
      onChallans: round3(Math.max(ch.net - ch.billed, 0)),
    };
  });
}

/** open → partly_delivered → delivered → invoiced, from the progress (cancelled stays cancelled). */
export function orderStatusOf(progress: readonly OrderLineProgress[], cancelled = false): SaleOrderStatus {
  if (cancelled) return "cancelled";
  if (progress.length > 0 && progress.every((p) => p.invoiced >= p.ordered - 1e-9)) return "invoiced";
  if (progress.length > 0 && progress.every((p) => p.delivered >= p.ordered - 1e-9)) return "delivered";
  if (progress.some((p) => p.delivered > 0 || p.invoiced > 0)) return "partly_delivered";
  return "open";
}

/** Quantities still to hold in stock per item (undelivered, catalogue items only). */
export function reservationLines(progress: readonly OrderLineProgress[]): { itemId: string; qty: number }[] {
  const by = new Map<string, number>();
  for (const p of progress) if (p.itemId && p.toDeliver > 0) by.set(p.itemId, round3((by.get(p.itemId) ?? 0) + p.toDeliver));
  return [...by.entries()].map(([itemId, qty]) => ({ itemId, qty }));
}

/** Lines can change until something was delivered or billed; the rest (dates, notes) stays editable while open. */
export function orderEditProblem(o: { status: SaleOrderStatus }, linesChange: boolean): string | null {
  if (o.status === "cancelled") return "This sale order is cancelled";
  if (o.status === "invoiced") return "This sale order is fully billed";
  if (linesChange && o.status !== "open") return "Items can't be changed once something was delivered or billed";
  return null;
}

export function orderCancelProblem(o: { status: SaleOrderStatus }): string | null {
  if (o.status === "cancelled") return "This sale order is already cancelled";
  if (o.status !== "open") return "Something was already delivered or billed; cancel those challans and bills first";
  return null;
}

export function orderFulfilProblem(o: { status: SaleOrderStatus }): string | null {
  if (o.status === "cancelled") return "This sale order is cancelled";
  if (o.status === "invoiced" || o.status === "delivered") return "Everything on this sale order was already delivered";
  return null;
}

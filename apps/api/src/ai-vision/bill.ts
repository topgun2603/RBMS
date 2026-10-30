import type { Confidence, PurchaseBillRaw } from "@rbms/ai";
import { GST_STATES, computeLine, normalizeStateCode, stateFromGstin, type GstRate } from "@rbms/gst";
import {
  Flags,
  MAX_QTY,
  dateField,
  expiryField,
  gstRateField,
  gstinField,
  hsnField,
  nameSimilarity,
  normName,
  paiseField,
  safeText,
  type Flag,
} from "./common";

export interface SupplierLite {
  id: string;
  name: string;
  gstin: string | null;
  stateCode: string | null;
}
export interface ItemLite {
  id: string;
  name: string;
  hsn: string | null;
  unit: string;
  gstRate: number;
}

/** What the post-processing needs from the shop. The API wires these to the inventory and invoices services. */
export interface BillContext {
  today: string;
  /** The shop's own state code (billing profile), e.g. "33". */
  shopState: string | null;
  /** Pharmacy shops: every line needs a batch and an expiry. */
  pharmacy: boolean;
  suppliers: { byGstin(gstin: string): Promise<SupplierLite | null>; search(q: string): Promise<SupplierLite[]> };
  items: { search(q: string): Promise<ItemLite[]> };
}

export interface BillLineDraft {
  description: string;
  code: string | null;
  hsn: string | null;
  qty: number | null;
  unit: string | null;
  /** Cost per unit, excluding GST, paise. */
  rate: number | null;
  discount: number;
  gstRate: GstRate | null;
  mrp: number | null;
  batchNo: string | null;
  /** YYYY-MM-DD (last day of the printed month). */
  expiry: string | null;
  packSize: string | null;
  /** The saved item this line is linked to (stock is added to it when saved). */
  itemId: string | null;
  itemName: string | null;
  match: "exact" | "fuzzy" | "none";
  /** No saved item matched: offer to create one. */
  createNew: boolean;
  /** Form fields the person should check: the model was unsure, or a check failed. */
  lowFields: string[];
}

export interface BillDraft {
  supplier: {
    name: string | null;
    gstin: string | null;
    gstinValid: boolean;
    address: string | null;
    stateCode: string | null;
    match: { id: string; name: string; by: "gstin" | "name" } | null;
  };
  invoice: { number: string | null; date: string | null; placeOfSupply: string | null };
  lines: BillLineDraft[];
  /** Totals as printed on the bill (paise) and as worked out from the lines. */
  printed: { taxable: number | null; cgst: number | null; sgst: number | null; igst: number | null; cess: number | null; roundOff: number | null; total: number | null };
  computed: { taxable: number; cgst: number; sgst: number; igst: number; total: number };
  /** true = the bill charges IGST (supplier state differs from the shop's); null when a state is unknown. */
  interState: boolean | null;
  /** Header fields to check: supplier.name, supplier.gstin, invoice.number, invoice.date, totals. */
  lowFields: string[];
  flags: Flag[];
  notes: string | null;
}

const low = (c: Confidence) => c === "low";
const stateByName = (name: string | null | undefined): string | null => {
  if (!name) return null;
  const n = normName(name);
  if (!n) return null;
  const code = normalizeStateCode(n);
  if (code && GST_STATES.some((s) => s.code === code)) return code;
  return GST_STATES.find((s) => normName(s.name) === n)?.code ?? GST_STATES.find((s) => n.includes(normName(s.name)))?.code ?? null;
};

/** Words worth searching with: the longest few, so "Aashirvaad Atta 5 kg" finds "Aashirvaad Whole Wheat Atta 5kg". */
const searchTerms = (desc: string) => {
  const words = normName(desc)
    .split(" ")
    .filter((w) => w.length > 2 && !/^\d+$/.test(w))
    .sort((a, b) => b.length - a.length)
    .slice(0, 2);
  return [desc.slice(0, 80), ...words];
};

export const EXACT_MATCH = 0.95;
export const FUZZY_MATCH = 0.6;

/** Link a bill line to a saved item: exact name, then close name. Returns the item and how it matched. */
export async function matchItem(
  items: BillContext["items"],
  line: { description: string; code: string | null },
  cache = new Map<string, Promise<ItemLite[]>>(),
): Promise<{ item: ItemLite; match: "exact" | "fuzzy" } | null> {
  const found = new Map<string, ItemLite>();
  for (const q of [...(line.code ? [line.code] : []), ...searchTerms(line.description)]) {
    const key = q.toLowerCase();
    if (!cache.has(key)) cache.set(key, items.search(q).catch(() => []));
    for (const it of await cache.get(key)!) found.set(it.id, it);
  }
  let best: { item: ItemLite; score: number } | null = null;
  for (const it of found.values()) {
    const score = Math.max(nameSimilarity(line.description, it.name), line.code && normName(line.code) === normName(it.name) ? 1 : 0);
    if (!best || score > best.score) best = { item: it, score };
  }
  if (!best || best.score < FUZZY_MATCH) return null;
  return { item: best.item, match: best.score >= EXACT_MATCH ? "exact" : "fuzzy" };
}

const sum = (xs: (number | null)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);

/**
 * Turn the model's reading of a bill into a draft for the purchase form. Never throws on bad content: bad fields are
 * dropped (null) and reported in `flags`. The caller decides what to do with an unreadable bill (`raw.readable`).
 */
export async function processBill(raw: PurchaseBillRaw, ctx: BillContext): Promise<BillDraft> {
  const flags = new Flags();
  const headerLow: string[] = [];

  // ---- supplier
  const name = safeText(raw.supplier.name, 120, flags, "supplier.name");
  const address = safeText(raw.supplier.address, 300, flags, "supplier.address");
  const g = gstinField(raw.supplier.gstin, flags, "supplier.gstin");
  if (!g.valid && !raw.supplier.gstin) flags.add("gstin_missing", "warn", { field: "supplier.gstin" });
  if (!name) flags.add("supplier_name_missing", "error", { field: "supplier.name" });
  if (name && low(raw.confidence.supplierName)) headerLow.push("supplier.name");
  if (g.value && low(raw.confidence.supplierGstin)) headerLow.push("supplier.gstin");
  if (!g.value && raw.supplier.gstin) headerLow.push("supplier.gstin");

  // state: from the GSTIN (checksummed), else the printed state name, else the place of supply
  const supplierState = (g.value ? stateFromGstin(g.value) : null) ?? stateByName(raw.supplier.state) ?? null;
  const pos = stateByName(raw.invoice.placeOfSupply);
  if (g.value && raw.supplier.state) {
    const printed = stateByName(raw.supplier.state);
    if (printed && supplierState && printed !== supplierState) flags.add("state_mismatch", "warn", { field: "supplier.state", params: { printed, gstin: supplierState } });
  }

  let match: BillDraft["supplier"]["match"] = null;
  if (g.value) {
    const s = await ctx.suppliers.byGstin(g.value).catch(() => null);
    if (s) match = { id: s.id, name: s.name, by: "gstin" };
  }
  if (!match && name) {
    const cands = await ctx.suppliers.search(name).catch(() => []);
    let best: { s: SupplierLite; score: number } | null = null;
    for (const s of cands) {
      // A different valid GSTIN means a different business, whatever the name looks like.
      if (g.value && s.gstin && s.gstin !== g.value) continue;
      const score = nameSimilarity(name, s.name);
      if (!best || score > best.score) best = { s, score };
    }
    if (best && best.score >= 0.7) match = { id: best.s.id, name: best.s.name, by: "name" };
  }

  // ---- invoice
  const number = safeText(raw.invoice.number, 40, flags, "invoice.number");
  if (!number) flags.add("invoice_number_missing", "error", { field: "invoice.number" });
  else if (low(raw.confidence.invoiceNumber)) headerLow.push("invoice.number");
  const date = dateField(raw.invoice.date, ctx.today, flags, "invoice.date");
  if (!date) {
    if (!raw.invoice.date) flags.add("date_missing", "error", { field: "invoice.date" });
    headerLow.push("invoice.date");
  } else if (low(raw.confidence.invoiceDate)) headerLow.push("invoice.date");

  // ---- lines
  const itemCache = new Map<string, Promise<ItemLite[]>>();
  const lines: BillLineDraft[] = [];
  const interState = supplierState && ctx.shopState ? supplierState !== ctx.shopState : null;
  for (const [i, l] of raw.lines.slice(0, 100).entries()) {
    const f = (k: string) => `lines.${i}.${k}`;
    const lowFields: string[] = [];
    const mark = (k: string) => lowFields.includes(k) || lowFields.push(k);
    const description = safeText(l.description, 300, flags, f("description"), i) ?? "";
    if (!description) {
      flags.add("line_description_missing", "error", { field: f("description"), line: i });
      mark("description");
    } else if (low(l.confidence.description)) mark("description");

    const qty: number | null = typeof l.qty === "number" && l.qty > 0 && l.qty <= MAX_QTY ? Math.round(l.qty * 1000) / 1000 : null;
    if (qty === null) {
      flags.add("line_qty_invalid", "error", { field: f("qty"), line: i });
      mark("qty");
    } else if (low(l.confidence.qty)) mark("qty");

    const rate = paiseField(l.rate, flags, f("rate"), { line: i });
    if (rate === null) mark("rate");
    else if (low(l.confidence.rate)) mark("rate");
    const mrp = paiseField(l.mrp, flags, f("mrp"), { line: i });
    if (rate !== null && mrp !== null && mrp > 0 && rate > mrp) {
      flags.add("rate_above_mrp", "warn", { field: f("rate"), line: i });
      mark("rate");
    }

    let discount = paiseField(l.discount, flags, f("discount"), { line: i }) ?? 0;
    if (qty !== null && rate !== null && discount > Math.round(qty * rate)) {
      flags.add("discount_too_big", "error", { field: f("discount"), line: i });
      discount = 0;
      mark("discount");
    }

    const hsn = hsnField(l.hsn, flags, f("hsn"), i);
    if (l.hsn && !hsn) mark("hsn");
    else if (hsn && low(l.confidence.hsn)) mark("hsn");
    const gstRate = gstRateField(l.gstRate, flags, f("gstRate"), i) as GstRate | null;
    if (gstRate === null) mark("gstRate");
    else if (low(l.confidence.gstRate)) mark("gstRate");

    const code = safeText(l.code, 40, flags, f("code"), i);
    const unit = safeText(l.unit, 16, flags, f("unit"), i);
    const packSize = safeText(l.packSize, 40, flags, f("packSize"), i);
    const batchNo = safeText(l.batch, 60, flags, f("batchNo"), i);
    const expiry = expiryField(l.expiry, flags, f("expiry"), i);
    if (l.expiry && !expiry) mark("expiry");
    if (expiry && expiry < ctx.today) {
      flags.add("expiry_past", "error", { field: f("expiry"), line: i, params: { value: expiry } });
      mark("expiry");
    }
    if (ctx.pharmacy) {
      if (!batchNo) {
        flags.add("line_batch_missing", "error", { field: f("batchNo"), line: i });
        mark("batchNo");
      }
      if (!expiry && !l.expiry) {
        flags.add("line_expiry_missing", "error", { field: f("expiry"), line: i });
        mark("expiry");
      }
    }

    let itemId: string | null = null;
    let itemName: string | null = null;
    let matchKind: BillLineDraft["match"] = "none";
    if (description) {
      const m = await matchItem(ctx.items, { description, code }, itemCache);
      if (m) {
        itemId = m.item.id;
        itemName = m.item.name;
        matchKind = m.match;
        if (m.match === "fuzzy") flags.add("item_fuzzy", "info", { field: f("description"), line: i, params: { item: m.item.name } });
      }
    }
    if (description && matchKind === "none") flags.add("item_new", "info", { field: f("description"), line: i });

    lines.push({
      description,
      code,
      hsn,
      qty,
      unit,
      rate,
      discount,
      gstRate,
      mrp,
      batchNo,
      expiry,
      packSize,
      itemId,
      itemName,
      match: matchKind,
      createNew: !!description && matchKind === "none",
      lowFields,
    });
  }
  if (raw.lines.length > 100) flags.add("too_many_lines", "warn", { params: { count: raw.lines.length } });
  if (lines.length === 0) flags.add("no_lines", "error");

  // ---- GST maths
  const printed = {
    taxable: paiseField(raw.totals.taxable, flags, "totals.taxable"),
    cgst: paiseField(raw.totals.cgst, flags, "totals.cgst"),
    sgst: paiseField(raw.totals.sgst, flags, "totals.sgst"),
    igst: paiseField(raw.totals.igst, flags, "totals.igst"),
    cess: paiseField(raw.totals.cess, flags, "totals.cess"),
    roundOff: paiseField(raw.totals.roundOff, flags, "totals.roundOff", { allowNegative: true }),
    total: paiseField(raw.totals.total, flags, "totals.total"),
  };
  // Use the tax type the bill's states imply; when a state is unknown use what the bill prints.
  const inter = interState ?? ((printed.igst ?? 0) > 0 && (printed.cgst ?? 0) + (printed.sgst ?? 0) === 0);
  const priced = lines.filter((l) => l.qty !== null && l.rate !== null && l.gstRate !== null);
  const calc = priced.map((l) => computeLine({ description: l.description, qty: l.qty!, rate: l.rate!, gstRate: l.gstRate!, ...(l.discount ? { discount: l.discount } : {}) }, inter));
  const computed = {
    taxable: sum(calc.map((c) => c.taxable)),
    cgst: sum(calc.map((c) => c.cgst)),
    sgst: sum(calc.map((c) => c.sgst)),
    igst: sum(calc.map((c) => c.igst)),
    total: 0,
  };
  computed.total = computed.taxable + computed.cgst + computed.sgst + computed.igst;
  const slack = 100 + 50 * Math.max(1, priced.length); // Rs 1 plus 50 paise of per-line rounding
  let totalsLow = low(raw.confidence.totals);
  if (priced.length < lines.length) flags.add("lines_incomplete", "warn", { params: { count: lines.length - priced.length } });
  if (priced.length === lines.length && lines.length > 0) {
    if (printed.taxable !== null && Math.abs(printed.taxable - computed.taxable) > slack) {
      flags.add("taxable_mismatch", "error", { field: "totals", params: { printed: printed.taxable, computed: computed.taxable } });
      totalsLow = true;
    }
    const printedTax = printed.cgst !== null || printed.sgst !== null || printed.igst !== null ? sum([printed.cgst, printed.sgst, printed.igst]) : null;
    const computedTax = computed.cgst + computed.sgst + computed.igst;
    if (printedTax !== null && Math.abs(printedTax - computedTax) > slack) {
      flags.add("tax_mismatch", "error", { field: "totals", params: { printed: printedTax, computed: computedTax } });
      totalsLow = true;
    }
    if (printed.total !== null) {
      const withRound = computed.total + (printed.roundOff ?? 0) + (printed.cess ?? 0);
      if (Math.abs(printed.total - withRound) > slack) {
        flags.add("total_mismatch", "error", { field: "totals", params: { printed: printed.total, computed: withRound } });
        totalsLow = true;
      }
    }
  }
  // The bill must add up by itself too: taxable + tax + cess + round off = total
  if (printed.total !== null && printed.taxable !== null) {
    const own = printed.taxable + sum([printed.cgst, printed.sgst, printed.igst, printed.cess, printed.roundOff]);
    if (Math.abs(own - printed.total) > 150) {
      flags.add("bill_not_adding_up", "warn", { field: "totals", params: { printed: printed.total, computed: own } });
      totalsLow = true;
    }
  }
  // CGST/SGST on an inter-state bill or IGST on an intra-state one
  if (interState !== null) {
    const hasIgst = (printed.igst ?? 0) > 0;
    const hasLocal = (printed.cgst ?? 0) + (printed.sgst ?? 0) > 0;
    if ((interState && hasLocal && !hasIgst) || (!interState && hasIgst && !hasLocal)) {
      flags.add("tax_type_mismatch", "error", { field: "totals", params: { inter: interState ? 1 : 0 } });
      totalsLow = true;
    }
  }
  if (supplierState === null) flags.add("state_unknown", "warn", { field: "supplier.state" });
  if (pos && ctx.shopState && pos !== ctx.shopState) flags.add("place_of_supply_other", "info", { field: "invoice.placeOfSupply", params: { code: pos } });
  if (totalsLow) headerLow.push("totals");

  const notes = safeText(raw.notes, 400, flags, "notes");
  if (notes && /ignored/i.test(notes) && /instruction/i.test(notes)) {
    flags.add("injection", "warn", { field: "notes" });
  }

  return {
    supplier: { name, gstin: g.value, gstinValid: g.valid, address, stateCode: supplierState, match },
    invoice: { number, date, placeOfSupply: pos },
    lines,
    printed,
    computed,
    interState,
    lowFields: [...new Set(headerLow)],
    flags: dedupe(flags.list),
    notes,
  };
}

/** One `injection` flag is enough; the rest are kept as they are. */
function dedupe(list: Flag[]): Flag[] {
  let seenInjection = false;
  return list.filter((f) => {
    if (f.code !== "injection") return true;
    if (seenInjection) return false;
    seenInjection = true;
    return true;
  });
}

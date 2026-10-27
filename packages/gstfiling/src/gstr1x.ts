import { isValidGstin, isValidStateCode, normalizeGstin, normalizeStateCode, stateFromGstin } from "@srirealtime/gst";
import { classifyLine } from "./gstr3b";
import { compositionOn, type GstConfig } from "./config";
import type { SalesDocSrc, VoidedNumberSrc } from "./ports";
import { rupees, roundHalfUp } from "./util";

/**
 * The GSTR-1 tables the base export (packages/einvoice/src/gstr1.ts) does not produce, plus a pre-download check:
 * - Table 6A exports (`exp`): bills whose place of supply is 96 (foreign country), with or without payment of IGST;
 * - Table 8 nil rated, exempted and non-GST supplies (`nil`): 0% lines by inter/intra State and registered/unregistered buyer;
 * - Table 11 advances received (`at`) and adjusted (`txpd`): typed in by the owner;
 * - Table 13 documents issued (`doc_issue`): bill number ranges per series with cancelled bills and the unused / voided
 *   numbers of offline billing blocks counted as cancelled, so the ranges are complete;
 * - a validation report listing what to fix before the file is uploaded.
 */

const money = (n: number) => rupees(n);

// ------------------------------------------------------------------ table 8: nil / exempt / non-GST

export interface NilRow {
  sply_ty: "INTRB2B" | "INTRB2C" | "INTRAB2B" | "INTRAB2C";
  expt_amt: number;
  nil_amt: number;
  ngsup_amt: number;
}

/** Table 8. Credit notes take value off the same row. Supply type: INTR = inter-State, INTRA = intra-State; B2B = buyer has a GSTIN. */
export function buildNil(sales: readonly SalesDocSrc[], config: GstConfig, range: { from: string; to: string }): { inv: NilRow[]; paise: Record<string, { exempt: number; nil: number; nongst: number }> } {
  const acc = new Map<NilRow["sply_ty"], { exempt: number; nil: number; nongst: number }>();
  for (const d of sales) {
    if (!d.number || d.status === "draft" || d.status === "cancelled" || d.date < range.from || d.date > range.to) continue;
    if (compositionOn(config, d.date)) continue;
    const note = d.docType === "CRN";
    if (d.docType && d.docType !== "INV" && !note) continue;
    const sign = note ? -1 : 1;
    const b2b = !!d.buyer.gstin && isValidGstin(d.buyer.gstin) && normalizeGstin(d.buyer.gstin) !== normalizeGstin(d.seller.gstin ?? "");
    const type: NilRow["sply_ty"] = `${d.interState ? "INTR" : "INTRA"}${b2b ? "B2B" : "B2C"}` as NilRow["sply_ty"];
    for (const l of d.lines) {
      const klass = classifyLine(d, l, config);
      if (klass === "taxable" || klass === "zero") continue;
      const row = acc.get(type) ?? { exempt: 0, nil: 0, nongst: 0 };
      if (klass === "exempt") row.exempt += sign * l.taxable;
      else if (klass === "nil") row.nil += sign * l.taxable;
      else row.nongst += sign * l.taxable;
      acc.set(type, row);
    }
  }
  const order: NilRow["sply_ty"][] = ["INTRB2B", "INTRB2C", "INTRAB2B", "INTRAB2C"];
  const inv: NilRow[] = [];
  const paise: Record<string, { exempt: number; nil: number; nongst: number }> = {};
  for (const t of order) {
    const r = acc.get(t);
    if (!r || (!r.exempt && !r.nil && !r.nongst)) continue;
    paise[t] = r;
    inv.push({ sply_ty: t, expt_amt: money(r.exempt), nil_amt: money(r.nil), ngsup_amt: money(r.nongst) });
  }
  return { inv, paise };
}

// ------------------------------------------------------------------ table 6A: exports

export interface ExpInvoice {
  inum: string;
  idt: string;
  val: number;
  /** Port code, shipping bill number and date ("DD-MM-YYYY"), when known. */
  sbpcode?: string;
  sbnum?: string;
  sbdt?: string;
  itms: { txval: number; rt: number; iamt: number; csamt: number }[];
}
export interface ExpBlock {
  exp_typ: "WPAY" | "WOPAY";
  inv: ExpInvoice[];
}

const toPortalDate = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

/**
 * Table 6A: exports — bills of an export supply type, or with place of supply 96 (export of goods / services). With
 * payment of IGST = WPAY, under LUT / bond = WOPAY (the supply type says which; older bills: IGST charged or not), with
 * the shipping bill and port when the bill has them. SEZ supplies are B2B (SEWP / SEWOP), not here.
 */
export function buildExp(sales: readonly SalesDocSrc[], range: { from: string; to: string }): ExpBlock[] {
  const wpay: ExpInvoice[] = [];
  const wopay: ExpInvoice[] = [];
  for (const d of sales) {
    if (!d.number || d.status === "draft" || d.status === "cancelled" || d.docType === "CRN" || (d.docType && d.docType !== "INV")) continue;
    const exported = d.supplyType === "export_wpay" || d.supplyType === "export_wopay" || ((!d.supplyType || d.supplyType === "domestic") && d.placeOfSupply === "96");
    if (!exported || d.date < range.from || d.date > range.to) continue;
    const byRate = new Map<number, { taxable: number; igst: number }>();
    for (const l of d.lines) {
      const r = byRate.get(l.gstRate) ?? { taxable: 0, igst: 0 };
      r.taxable += l.taxable;
      r.igst += l.igst;
      byRate.set(l.gstRate, r);
    }
    const paid = d.supplyType === "export_wpay" ? true : d.supplyType === "export_wopay" ? false : d.totals.igst > 0;
    const x = d.exportDetails ?? null;
    const inv: ExpInvoice = {
      inum: d.number,
      idt: toPortalDate(d.date),
      val: money(d.totals.total),
      ...(x?.portCode ? { sbpcode: x.portCode } : {}),
      ...(x?.shippingBillNo ? { sbnum: x.shippingBillNo } : {}),
      ...(x?.shippingBillDate ? { sbdt: toPortalDate(x.shippingBillDate) } : {}),
      itms: [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rt, a]) => ({ txval: money(a.taxable), rt, iamt: money(a.igst), csamt: 0 })),
    };
    (paid ? wpay : wopay).push(inv);
  }
  return [...(wpay.length ? [{ exp_typ: "WPAY" as const, inv: wpay }] : []), ...(wopay.length ? [{ exp_typ: "WOPAY" as const, inv: wopay }] : [])];
}

// ------------------------------------------------------------------ table 11: advances

export interface AdvanceSrc {
  month: string;
  kind: "received" | "adjusted";
  pos: string;
  rate: number;
  /** Paise, gross (tax included). */
  amount: number;
  cess: number;
}
export interface AdvanceBlock {
  pos: string;
  sply_ty: "INTRA" | "INTER";
  itms: { rt: number; ad_amt: number; iamt?: number; camt?: number; samt?: number; csamt: number }[];
}

/** Tax inside a gross advance: the advance is taken as tax-inclusive (Section 12(2)/13(2) and the time-of-supply rules). */
export function advanceTax(gross: number, rate: number): number {
  return roundHalfUp((gross * rate) / (100 + rate));
}

/** Tables 11A(1) (`at`) and 11B(1) (`txpd`): advances per place of supply and rate. */
export function buildAdvances(rows: readonly AdvanceSrc[], kind: "received" | "adjusted", shopState: string | null): AdvanceBlock[] {
  const by = new Map<string, AdvanceBlock>();
  const sums = new Map<string, { gross: number; cess: number }>();
  for (const r of rows) {
    if (r.kind !== kind) continue;
    const pos = normalizeStateCode(r.pos) ?? r.pos;
    const inter = !!shopState && pos !== shopState;
    const key = `${pos}|${inter ? "INTER" : "INTRA"}`;
    const block = by.get(key) ?? { pos, sply_ty: inter ? ("INTER" as const) : ("INTRA" as const), itms: [] };
    by.set(key, block);
    const k = `${key}|${r.rate}`;
    const s = sums.get(k) ?? { gross: 0, cess: 0 };
    s.gross += r.amount;
    s.cess += r.cess;
    sums.set(k, s);
  }
  for (const [k, s] of sums) {
    const [pos, sply, rate] = k.split("|") as [string, string, string];
    const block = by.get(`${pos}|${sply}`)!;
    const tax = advanceTax(s.gross, Number(rate));
    const base = { rt: Number(rate), ad_amt: money(s.gross) };
    block.itms.push(sply === "INTER" ? { ...base, iamt: money(tax), csamt: money(s.cess) } : { ...base, camt: money(Math.ceil(tax / 2)), samt: money(Math.floor(tax / 2)), csamt: money(s.cess) });
  }
  const out = [...by.values()].sort((a, b) => a.pos.localeCompare(b.pos) || a.sply_ty.localeCompare(b.sply_ty));
  for (const b of out) b.itms.sort((a, c) => a.rt - c.rt);
  return out;
}

// ------------------------------------------------------------------ table 13: documents issued

const splitNumber = (no: string): { series: string; seq: number | null } => {
  const m = /^(.*?)(\d+)$/.exec(no);
  return m ? { series: m[1]!, seq: Number(m[2]) } : { series: no, seq: null };
};

export interface DocIssueRow {
  num: number;
  from: string;
  to: string;
  totnum: number;
  cancel: number;
  net_issue: number;
}
export interface DocIssueResult {
  doc_det: { doc_num: number; doc_typ: string; docs: DocIssueRow[] }[];
  /** Numbers inside a series' range that no bill, cancelled bill or voided number accounts for. */
  gaps: { series: string; missing: string[] }[];
  /** How many voided / unused offline numbers were counted. */
  voidedCounted: number;
}

/**
 * Table 13 for a period. Every numbered bill counts (cancelled ones as cancelled), and so does every offline-billing
 * number released in the period (unused numbers of a closed block, bills cancelled at the counter), so a range such as
 * INV/26-27/0100 to INV/26-27/0150 is complete. Credit notes are listed as "Credit Note" (doc_num 5).
 */
export function buildDocIssue(sales: readonly SalesDocSrc[], voided: readonly VoidedNumberSrc[], range: { from: string; to: string }): DocIssueResult {
  type Acc = { numbers: Map<string, boolean>; };
  const inv = new Map<string, Acc>();
  const crn = new Map<string, Acc>();
  const addTo = (m: Map<string, Acc>, no: string, cancelled: boolean) => {
    const { series } = splitNumber(no);
    const a = m.get(series) ?? { numbers: new Map<string, boolean>() };
    // A number is cancelled if any record of it says so.
    a.numbers.set(no, (a.numbers.get(no) ?? false) || cancelled);
    m.set(series, a);
  };
  for (const d of sales) {
    const no = (d.number ?? "").trim();
    if (!no || d.status === "draft" || d.date < range.from || d.date > range.to) continue;
    if (d.docType && d.docType !== "INV" && d.docType !== "CRN") continue;
    addTo(d.docType === "CRN" ? crn : inv, no, d.status === "cancelled");
  }
  let voidedCounted = 0;
  const issued = new Set([...inv.values()].flatMap((a) => [...a.numbers.keys()]));
  for (const v of voided) {
    if (v.date < range.from || v.date > range.to || issued.has(v.number)) continue;
    addTo(inv, v.number, true);
    voidedCounted += 1;
  }
  const gaps: DocIssueResult["gaps"] = [];
  const rows = (m: Map<string, Acc>, reportGaps: boolean): DocIssueRow[] =>
    [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([series, a], i) => {
        const nums = [...a.numbers.keys()];
        const withSeq = nums.map((n) => ({ n, s: splitNumber(n).seq })).filter((x): x is { n: string; s: number } => x.s !== null);
        let from: string;
        let to: string;
        if (withSeq.length === nums.length && withSeq.length > 0) {
          withSeq.sort((x, y) => x.s - y.s);
          from = withSeq[0]!.n;
          to = withSeq[withSeq.length - 1]!.n;
          if (reportGaps) {
            const have = new Set(withSeq.map((x) => x.s));
            const width = from.length - series.length;
            const missing: string[] = [];
            for (let s = withSeq[0]!.s; s <= withSeq[withSeq.length - 1]!.s && missing.length < 50; s++) if (!have.has(s)) missing.push(`${series}${String(s).padStart(width, "0")}`);
            if (missing.length) gaps.push({ series, missing });
          }
        } else {
          const s = [...nums].sort();
          from = s[0] ?? series;
          to = s[s.length - 1] ?? series;
        }
        const cancel = [...a.numbers.values()].filter(Boolean).length;
        return { num: i + 1, from, to, totnum: nums.length, cancel, net_issue: nums.length - cancel };
      });
  const invRows = rows(inv, true);
  const crnRows = rows(crn, false);
  return {
    doc_det: [
      ...(invRows.length ? [{ doc_num: 1, doc_typ: "Invoices for outward supply", docs: invRows }] : []),
      ...(crnRows.length ? [{ doc_num: 5, doc_typ: "Credit Note", docs: crnRows }] : []),
    ],
    gaps,
    voidedCounted,
  };
}

// ------------------------------------------------------------------ validation report

export type Severity = "error" | "warning";
export interface Gstr1Issue {
  code:
    | "seller_gstin_missing"
    | "seller_gstin_other"
    | "buyer_gstin_invalid"
    | "hsn_missing"
    | "hsn_short"
    | "hsn_invalid"
    | "unit_missing"
    | "pos_invalid"
    | "inter_flag_mismatch"
    | "tax_mismatch"
    | "rate_unusual"
    | "duplicate_number"
    | "number_gap"
    | "tax_on_bill_of_supply"
    | "negative_total"
    | "no_documents";
  severity: Severity;
  docType?: "invoice" | "credit_note";
  docId?: string;
  number?: string;
  /** Short English detail (buyer name, line text, expected digits ...). The UI translates the code and shows this beside it. */
  detail?: string;
}

const SLABS = new Set([0, 0.25, 1.5, 3, 5, 6, 7.5, 12, 18, 28]);

export interface ValidateOptions {
  gstin: string | null;
  range: { from: string; to: string };
  /** Required HSN digits: 4 up to 5 crore turnover, 6 above. */
  hsnDigits?: 4 | 6;
  config: GstConfig;
  gaps?: DocIssueResult["gaps"];
}

/** The "issues to fix before filing" for GSTR-1: what would be wrong, missing or silently reported under a different table. */
export function validateGstr1(sales: readonly SalesDocSrc[], opts: ValidateOptions): Gstr1Issue[] {
  const out: Gstr1Issue[] = [];
  const hsnDigits = opts.hsnDigits ?? 4;
  const seen = new Map<string, number>();
  let counted = 0;
  const own = opts.gstin ? normalizeGstin(opts.gstin) : null;
  for (const d of sales) {
    const no = (d.number ?? "").trim();
    if (!no || d.status === "draft" || d.date < opts.range.from || d.date > opts.range.to) continue;
    const docType = d.docType === "CRN" ? ("credit_note" as const) : ("invoice" as const);
    const at = { docType, docId: d.id, number: no };
    seen.set(no, (seen.get(no) ?? 0) + 1);
    if (d.status === "cancelled") continue;
    counted += 1;
    if (compositionOn(opts.config, d.date)) {
      if (d.totals.cgst + d.totals.sgst + d.totals.igst > 0) out.push({ ...at, code: "tax_on_bill_of_supply", severity: "warning" });
      continue;
    }
    const sellerGstin = d.seller.gstin ? normalizeGstin(d.seller.gstin) : null;
    if (!sellerGstin && !own) out.push({ ...at, code: "seller_gstin_missing", severity: "error" });
    else if (sellerGstin && own && sellerGstin !== own) out.push({ ...at, code: "seller_gstin_other", severity: "warning", detail: sellerGstin });
    if (d.buyer.gstin && !isValidGstin(d.buyer.gstin)) out.push({ ...at, code: "buyer_gstin_invalid", severity: "warning", detail: `${d.buyer.name ?? ""} ${d.buyer.gstin}`.trim() });
    const pos = normalizeStateCode(d.placeOfSupply);
    if (!pos || (!isValidStateCode(pos) && pos !== "96")) {
      out.push({ ...at, code: "pos_invalid", severity: "error", detail: d.placeOfSupply });
    } else if (own) {
      const sellerState = stateFromGstin(own);
      if (sellerState && (sellerState !== pos) !== d.interState) out.push({ ...at, code: "inter_flag_mismatch", severity: "warning" });
    }
    if (d.totals.total < 0) out.push({ ...at, code: "negative_total", severity: "error" });
    const flagged = new Set<string>();
    for (const l of d.lines) {
      const code = (l.hsn ?? "").replace(/\s+/g, "");
      const label = l.description.slice(0, 40);
      if (!code) {
        if (!flagged.has(`hsn:${label}`)) out.push({ ...at, code: "hsn_missing", severity: "error", detail: label });
        flagged.add(`hsn:${label}`);
      } else if (!/^\d+$/.test(code)) {
        if (!flagged.has(`hsn:${code}`)) out.push({ ...at, code: "hsn_invalid", severity: "error", detail: code });
        flagged.add(`hsn:${code}`);
      } else if (code.length < hsnDigits && !flagged.has(`short:${code}`)) {
        out.push({ ...at, code: "hsn_short", severity: "warning", detail: `${code} (${hsnDigits} digits needed)` });
        flagged.add(`short:${code}`);
      }
      if (!SLABS.has(l.gstRate) && !flagged.has(`rate:${l.gstRate}`)) {
        out.push({ ...at, code: "rate_unusual", severity: "warning", detail: `${l.gstRate}%` });
        flagged.add(`rate:${l.gstRate}`);
      }
      const expect = Math.round((l.taxable * l.gstRate) / 100);
      const got = l.cgst + l.sgst + l.igst;
      if (Math.abs(expect - got) > 100 && !flagged.has(`tax:${label}`)) {
        out.push({ ...at, code: "tax_mismatch", severity: "warning", detail: label });
        flagged.add(`tax:${label}`);
      }
      if (!l.unit && /^[0-8]/.test(code) && !/^(99|9[89])/.test(code) && !flagged.has("unit")) {
        out.push({ ...at, code: "unit_missing", severity: "warning", detail: label });
        flagged.add("unit");
      }
    }
  }
  for (const [no, n] of seen) if (n > 1) out.push({ code: "duplicate_number", severity: "error", number: no, detail: `${n}` });
  for (const g of opts.gaps ?? []) out.push({ code: "number_gap", severity: "warning", number: g.missing.slice(0, 5).join(", "), detail: `${g.series} (${g.missing.length})` });
  if (counted === 0) out.push({ code: "no_documents", severity: "warning" });
  return out;
}

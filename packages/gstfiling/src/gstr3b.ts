import { isValidGstin, normalizeGstin } from "@srirealtime/gst";
import { compositionOn, zeroClassOf, type GstConfig } from "./config";
import type { ItcDecision, ItcDoc } from "./itc";
import type { SalesDocSrc, SalesLineSrc } from "./ports";
import { addValue, monthRange, rupees, toFp, totalTax, zeroTax, zeroValue, type Tax, type TaxValue } from "./util";

/**
 * GSTR-3B for one month, built from the bills, credit notes, purchase bills, expenses and the owner's flags. Pure.
 * Every figure is a sum of `Contribution`s, so any cell can be opened to the documents behind it (drill-down).
 *
 * Cells: 3.1(a) outward taxable, 3.1(b) zero-rated, 3.1(c) nil / exempt, 3.1(d) inward reverse charge, 3.1(e) non-GST,
 * 3.2 inter-state supplies to unregistered buyers by place of supply, 4(A)(1..5) credit available, 4(B)(1..2) reversed,
 * 4(D) other details, 5 inward exempt / nil / non-GST, 5.1 interest and late fee.
 */

export const CELLS = [
  "3.1a",
  "3.1b",
  "3.1c",
  "3.1d",
  "3.1e",
  "3.2",
  "4A1",
  "4A2",
  "4A3",
  "4A4",
  "4A5",
  "4B1",
  "4B2",
  "4D1",
  "4D2",
  "5.exempt.inter",
  "5.exempt.intra",
  "5.nongst.inter",
  "5.nongst.intra",
  "5.1.interest",
  "5.1.latefee",
] as const;
export type CellId = (typeof CELLS)[number];

export interface Contribution {
  cell: CellId;
  docType: "invoice" | "credit_note" | "purchase" | "expense" | "debit_note" | "adjustment";
  docId: string;
  number: string;
  date: string;
  party: string;
  /** 3.2 only. */
  pos?: string;
  /** Signed amounts (credit notes are negative). */
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  note?: string;
}

export interface AdjustmentSrc {
  id: string;
  month: string;
  kind: string;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  note: string | null;
}

export interface ReturnSrc {
  doc: ItcDoc;
  /** The credit on the bill it returns was taken. */
  claimed: boolean;
}

export interface Gstr3bInput {
  /** The return month; for a quarterly (QRMP) return the last month of the quarter. */
  month: string;
  /** Months the return covers (default just `month`); a quarter lists its three. */
  months?: string[];
  gstin: string;
  shopState: string | null;
  config: GstConfig;
  sales: readonly SalesDocSrc[];
  decisions: readonly ItcDecision[];
  /** Purchase bills of the month (for Table 5: inward 0% lines). */
  purchases: readonly { id: string; billNumber: string; date: string; supplierName: string; interState: boolean; lines: readonly { gstRate: number; taxable: number }[] }[];
  returns: readonly ReturnSrc[];
  adjustments: readonly AdjustmentSrc[];
}

const ZERO_RATED_POS = "96";

/** The class of a sales line in GSTR-3B / GSTR-1: where its value goes. */
export type LineClass = "taxable" | "zero" | "nil" | "exempt" | "nongst";
export function classifyLine(doc: Pick<SalesDocSrc, "placeOfSupply">, line: Pick<SalesLineSrc, "gstRate" | "hsn">, config: Pick<GstConfig, "zeroRateClass" | "zeroRateRules">): LineClass {
  if (doc.placeOfSupply === ZERO_RATED_POS) return "zero";
  if (line.gstRate > 0) return "taxable";
  return zeroClassOf(config, line.hsn);
}

const hasBuyerGstin = (d: Pick<SalesDocSrc, "buyer" | "seller">) =>
  !!d.buyer.gstin && isValidGstin(d.buyer.gstin) && normalizeGstin(d.buyer.gstin) !== normalizeGstin(d.seller.gstin ?? "");

export interface SetOff {
  /** Paid with credit: [liability head][credit head]. */
  used: Record<"igst" | "cgst" | "sgst" | "cess", Record<"igst" | "cgst" | "sgst" | "cess", number>>;
  /** What is left to pay in cash. */
  cash: Tax;
  /** Credit left over to carry forward. */
  carry: Tax;
}

/**
 * Pays the output tax with the net credit in the order of Section 49A and Rule 88A: integrated tax credit first against
 * integrated, then central, then State tax; central tax credit against central tax and then integrated tax; State tax
 * credit against State tax and then integrated tax; cess only against cess. Negative liabilities count as nothing.
 */
export function setOff(liability: Tax, credit: Tax): SetOff {
  const L = { igst: Math.max(liability.igst, 0), cgst: Math.max(liability.cgst, 0), sgst: Math.max(liability.sgst, 0), cess: Math.max(liability.cess, 0) };
  const C = { igst: Math.max(credit.igst, 0), cgst: Math.max(credit.cgst, 0), sgst: Math.max(credit.sgst, 0), cess: Math.max(credit.cess, 0) };
  const heads = ["igst", "cgst", "sgst", "cess"] as const;
  const used = Object.fromEntries(heads.map((h) => [h, { igst: 0, cgst: 0, sgst: 0, cess: 0 }])) as SetOff["used"];
  const pay = (liab: (typeof heads)[number], cred: (typeof heads)[number]) => {
    const n = Math.min(L[liab], C[cred]);
    L[liab] -= n;
    C[cred] -= n;
    used[liab][cred] += n;
  };
  pay("cess", "cess");
  pay("igst", "igst");
  pay("cgst", "igst");
  pay("sgst", "igst");
  pay("cgst", "cgst");
  pay("sgst", "sgst");
  // Central and State credit may pay integrated tax only after integrated credit is gone (it is, if IGST liability remains).
  pay("igst", "cgst");
  pay("igst", "sgst");
  return { used, cash: { ...L }, carry: { ...C } };
}

export interface Gstr3bResult {
  month: string;
  /** "MMYYYY". */
  fp: string;
  gstin: string;
  /** False when the shop is a composition taxpayer for the whole month (it files CMP-08 and GSTR-4 instead). */
  applicable: boolean;
  cells: Record<CellId, TaxValue>;
  /** 3.2 by place of supply. */
  unregByPos: { pos: string; taxable: number; igst: number }[];
  /** Output tax on 3.1(a) and 3.1(b). */
  outputTax: Tax;
  /** Reverse-charge tax (3.1d), always paid in cash. */
  rcmTax: Tax;
  /** Net credit 4(C). */
  itcNet: Tax;
  /** Output tax paid with credit and in cash. */
  setOff: SetOff;
  /** Cash to pay: output tax after set-off + reverse charge + interest + late fee. */
  cashPayable: number;
  contributions: Contribution[];
  counts: { invoices: number; creditNotes: number; purchases: number; expenses: number; rcm: number; adjustments: number };
}

/** Which cell an owner-typed adjustment feeds. */
const ADJUSTMENT_CELL: Record<string, CellId> = {
  itc_impg: "4A1",
  itc_isd: "4A4",
  itc_other: "4A5",
  itc_rev_rules: "4B1",
  itc_rev_other: "4B2",
  itc_reclaim: "4D1",
  itc_ineligible: "4D2",
  inward_exempt_inter: "5.exempt.inter",
  inward_exempt_intra: "5.exempt.intra",
  inward_nongst_inter: "5.nongst.inter",
  inward_nongst_intra: "5.nongst.intra",
  interest: "5.1.interest",
  late_fee: "5.1.latefee",
  outward_zero: "3.1b",
};

const RULE_REVERSALS = new Set(["rule38", "rule42", "rule43", "section17_5"]);

export function buildGstr3b(input: Gstr3bInput): Gstr3bResult {
  const { month, config } = input;
  const months = input.months?.length ? input.months : [month];
  const range = { from: monthRange(months[0]!).from, to: monthRange(months[months.length - 1]!).to };
  const inPeriod = (m: string | null) => !!m && months.includes(m);
  const cells = Object.fromEntries(CELLS.map((c) => [c, zeroValue()])) as Record<CellId, TaxValue>;
  const contributions: Contribution[] = [];
  const counts = { invoices: 0, creditNotes: 0, purchases: 0, expenses: 0, rcm: 0, adjustments: 0 };
  const unreg = new Map<string, { pos: string; taxable: number; igst: number }>();

  const put = (c: Omit<Contribution, "cess"> & { cess?: number }) => {
    const full: Contribution = { cess: 0, ...c };
    if (!full.taxable && !full.igst && !full.cgst && !full.sgst && !full.cess) return;
    contributions.push(full);
    addValue(cells[full.cell], full);
    if (full.cell === "3.2" && full.pos) {
      const row = unreg.get(full.pos) ?? { pos: full.pos, taxable: 0, igst: 0 };
      row.taxable += full.taxable;
      row.igst += full.igst;
      unreg.set(full.pos, row);
    }
  };

  // ---- outward supplies (bills and credit notes dated in the month; cancelled ones count for nothing)
  for (const d of input.sales) {
    if (!d.number || d.status === "draft" || d.status === "cancelled") continue;
    if (d.date < range.from || d.date > range.to) continue;
    if (compositionOn(config, d.date)) continue;
    const note = d.docType === "CRN";
    if (d.docType && d.docType !== "INV" && !note) continue;
    const sign = note ? -1 : 1;
    if (note) counts.creditNotes += 1;
    else counts.invoices += 1;
    const per = new Map<CellId, TaxValue>();
    const unregPer = new Map<string, TaxValue>();
    for (const l of d.lines) {
      const klass = classifyLine(d, l, config);
      const cell: CellId = klass === "taxable" ? "3.1a" : klass === "zero" ? "3.1b" : klass === "nongst" ? "3.1e" : "3.1c";
      const v = per.get(cell) ?? zeroValue();
      addValue(v, { taxable: l.taxable, igst: l.igst, cgst: l.cgst, sgst: l.sgst });
      per.set(cell, v);
      if (klass === "taxable" && d.interState && !hasBuyerGstin(d)) {
        const u = unregPer.get(d.placeOfSupply) ?? zeroValue();
        addValue(u, { taxable: l.taxable, igst: l.igst });
        unregPer.set(d.placeOfSupply, u);
      }
    }
    const base = { docType: note ? ("credit_note" as const) : ("invoice" as const), docId: d.id, number: d.number, date: d.date, party: d.buyer.name ?? "" };
    for (const [cell, v] of per) {
      // 3.1(c) and 3.1(e) carry only the value.
      const valueOnly = cell === "3.1c" || cell === "3.1e";
      put({ ...base, cell, taxable: sign * v.taxable, igst: valueOnly ? 0 : sign * v.igst, cgst: valueOnly ? 0 : sign * v.cgst, sgst: valueOnly ? 0 : sign * v.sgst });
    }
    for (const [pos, v] of unregPer) put({ ...base, cell: "3.2", pos, taxable: sign * v.taxable, igst: sign * v.igst, cgst: 0, sgst: 0 });
  }

  // ---- inward supplies: reverse charge, credit available / reversed
  for (const dec of input.decisions) {
    const doc = dec.doc;
    const base = { docType: doc.docType as Contribution["docType"], docId: doc.docId, number: doc.number, date: doc.date, party: doc.party };
    if (dec.rcm && inPeriod(dec.rcm.month)) {
      counts.rcm += 1;
      put({ ...base, cell: "3.1d", taxable: dec.rcm.taxable, ...dec.rcm.tax, note: dec.rcm.category ?? undefined });
    }
    if (inPeriod(dec.claimMonth) && (dec.status === "eligible" || dec.status === "reversal")) {
      const cell: CellId = dec.rcm ? (dec.rcm.isImport ? "4A2" : "4A3") : dec.class === "impg" ? "4A1" : dec.class === "imps" ? "4A2" : dec.class === "isd" ? "4A4" : "4A5";
      if (doc.docType === "purchase") counts.purchases += 1;
      else counts.expenses += 1;
      put({ ...base, cell, taxable: dec.rcm ? dec.rcm.taxable : doc.taxable, ...dec.tax });
    }
    if (dec.status === "reversal" && inPeriod(dec.reversalMonth)) {
      const cell: CellId = dec.reversalReason && RULE_REVERSALS.has(dec.reversalReason) ? "4B1" : "4B2";
      put({ ...base, cell, taxable: doc.taxable, ...dec.tax, note: dec.reversalReason ?? undefined });
    }
    if (inPeriod(dec.lapsedMonth)) put({ ...base, cell: "4D2", taxable: doc.taxable, ...dec.tax, note: "16(4)" });
  }
  for (const r of input.returns) {
    if (!r.claimed || r.doc.date < range.from || r.doc.date > range.to) continue;
    put({ docType: "debit_note", docId: r.doc.docId, number: r.doc.number, date: r.doc.date, party: r.doc.party, cell: "4B2", taxable: r.doc.taxable, ...r.doc.tax, note: "debit note" });
  }

  // ---- Table 5: inward 0% lines (exempt, nil, composition suppliers)
  for (const p of input.purchases) {
    if (p.date < range.from || p.date > range.to) continue;
    const taxable = p.lines.filter((l) => l.gstRate === 0).reduce((s, l) => s + l.taxable, 0);
    if (taxable > 0) put({ docType: "purchase", docId: p.id, number: p.billNumber, date: p.date, party: p.supplierName, cell: p.interState ? "5.exempt.inter" : "5.exempt.intra", taxable, igst: 0, cgst: 0, sgst: 0 });
  }

  // ---- owner-typed figures
  for (const a of input.adjustments) {
    if (!inPeriod(a.month)) continue;
    const cell = ADJUSTMENT_CELL[a.kind];
    if (!cell) continue;
    counts.adjustments += 1;
    put({ docType: "adjustment", docId: a.id, number: a.kind, date: range.from, party: "", cell, taxable: a.taxable, igst: a.igst, cgst: a.cgst, sgst: a.sgst, cess: a.cess, note: a.note ?? undefined });
  }

  const sumCells = (...ids: CellId[]): Tax => {
    const t = zeroTax();
    for (const id of ids) {
      t.igst += cells[id].igst;
      t.cgst += cells[id].cgst;
      t.sgst += cells[id].sgst;
      t.cess += cells[id].cess;
    }
    return t;
  };
  const avl = sumCells("4A1", "4A2", "4A3", "4A4", "4A5");
  const rev = sumCells("4B1", "4B2");
  const itcNet: Tax = { igst: avl.igst - rev.igst, cgst: avl.cgst - rev.cgst, sgst: avl.sgst - rev.sgst, cess: avl.cess - rev.cess };
  const outputTax = sumCells("3.1a", "3.1b");
  const rcmTax = sumCells("3.1d");
  const so = setOff(outputTax, itcNet);
  const interest = cells["5.1.interest"];
  const late = cells["5.1.latefee"];
  const cashPayable = totalTax(so.cash) + totalTax(rcmTax) + totalTax(interest) + totalTax(late);

  return {
    month,
    fp: toFp(month),
    gstin: normalizeGstin(input.gstin),
    applicable: !compositionOn(config, range.from),
    cells,
    unregByPos: [...unreg.values()].sort((a, b) => a.pos.localeCompare(b.pos)),
    outputTax,
    rcmTax,
    itcNet,
    setOff: so,
    cashPayable,
    contributions,
    counts,
  };
}

const t4 = (v: Tax) => ({ iamt: rupees(v.igst), camt: rupees(v.cgst), samt: rupees(v.sgst), csamt: rupees(v.cess) });

/**
 * The GSTR-3B JSON in the GST portal's offline-tool layout (`gstin`, `ret_period`, `sup_details`, `inter_sup`,
 * `itc_elg`, `inward_sup`, `intr_ltfee`). Amounts in rupees with two decimals.
 */
export function gstr3bJson(r: Gstr3bResult) {
  const c = r.cells;
  const row = (id: CellId) => ({ txval: rupees(c[id].taxable), ...t4(c[id]) });
  const ty = (id: CellId, type: string) => ({ ty: type, ...t4(c[id]) });
  return {
    gstin: r.gstin,
    ret_period: r.fp,
    sup_details: {
      osup_det: row("3.1a"),
      osup_zero: { txval: rupees(c["3.1b"].taxable), iamt: rupees(c["3.1b"].igst), csamt: rupees(c["3.1b"].cess) },
      osup_nil_exmp: { txval: rupees(c["3.1c"].taxable) },
      isup_rev: row("3.1d"),
      osup_nongst: { txval: rupees(c["3.1e"].taxable) },
    },
    inter_sup: {
      unreg_details: r.unregByPos.filter((u) => u.taxable || u.igst).map((u) => ({ pos: u.pos, txval: rupees(u.taxable), iamt: rupees(u.igst) })),
      comp_details: [] as { pos: string; txval: number; iamt: number }[],
      uin_details: [] as { pos: string; txval: number; iamt: number }[],
    },
    itc_elg: {
      itc_avl: [ty("4A1", "IMPG"), ty("4A2", "IMPS"), ty("4A3", "ISRC"), ty("4A4", "ISD"), ty("4A5", "OTH")],
      itc_rev: [ty("4B1", "RUL"), ty("4B2", "OTH")],
      itc_net: t4(r.itcNet),
      itc_inelg: [{ ty: "RUL", iamt: 0, camt: 0, samt: 0, csamt: 0 }, ty("4D2", "OTH")],
    },
    inward_sup: {
      isup_details: [
        { ty: "GST", inter: rupees(c["5.exempt.inter"].taxable), intra: rupees(c["5.exempt.intra"].taxable) },
        { ty: "NONGST", inter: rupees(c["5.nongst.inter"].taxable), intra: rupees(c["5.nongst.intra"].taxable) },
      ],
    },
    intr_ltfee: { intr_details: t4(c["5.1.interest"]) },
  };
}

/** Rows for the CSV of a cell's drill-down or the whole return. */
export const CELL_LABELS: Record<CellId, string> = {
  "3.1a": "3.1(a) Outward taxable supplies (other than zero rated, nil rated and exempted)",
  "3.1b": "3.1(b) Outward taxable supplies (zero rated)",
  "3.1c": "3.1(c) Other outward supplies (nil rated, exempted)",
  "3.1d": "3.1(d) Inward supplies (liable to reverse charge)",
  "3.1e": "3.1(e) Non-GST outward supplies",
  "3.2": "3.2 Inter-State supplies to unregistered persons",
  "4A1": "4(A)(1) Import of goods",
  "4A2": "4(A)(2) Import of services",
  "4A3": "4(A)(3) Inward supplies liable to reverse charge",
  "4A4": "4(A)(4) Inward supplies from ISD",
  "4A5": "4(A)(5) All other ITC",
  "4B1": "4(B)(1) ITC reversed as per rules 38, 42, 43 and Section 17(5)",
  "4B2": "4(B)(2) ITC reversed, others",
  "4D1": "4(D)(1) ITC reclaimed which was reversed earlier",
  "4D2": "4(D)(2) Ineligible ITC (Section 16(4) / place of supply)",
  "5.exempt.inter": "5 Composition / exempt / nil rated inward supplies: inter-State",
  "5.exempt.intra": "5 Composition / exempt / nil rated inward supplies: intra-State",
  "5.nongst.inter": "5 Non-GST inward supplies: inter-State",
  "5.nongst.intra": "5 Non-GST inward supplies: intra-State",
  "5.1.interest": "5.1 Interest",
  "5.1.latefee": "5.1 Late fee",
};

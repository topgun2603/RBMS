import { isValidGstin, normalizeGstin, normalizeStateCode, roundTo, rupees, stateFromGstin, toGstr1Date } from "./gst";
import { isServiceHsn } from "./nic";
import type { EInvoiceSource } from "./ports";
import { toUqc } from "./units";

/**
 * HSN summary quantity and unit of a bill line: alternate-unit lines (2 boxes of 12 pcs) count in the item's base unit
 * (24 pcs → NOS), so one HSN keeps one UQC however the goods were packed (docs/price-lists-units.md).
 */
function hsnQty(l: { qty: number; unit?: string | null; unitFactor?: number | null; baseUnit?: string | null }): { qty: number; unit: string | null } {
  if (l.unitFactor && l.unitFactor !== 1 && l.baseUnit) return { qty: roundTo(l.qty * l.unitFactor, 3), unit: l.baseUnit };
  return { qty: l.qty, unit: l.unit ?? null };
}

/**
 * GSTR-1 JSON in the GSTN offline-tool / API layout: `gstin`, `fp` (MMYYYY) and the sections b2b, b2cl, b2cs, cdnr,
 * cdnur, hsn and doc_issue. Amounts are rupees with 2 decimals (summed in paise first). Credit notes (document type CRN,
 * note type "C") and debit notes to customers (DBN, note type "D") go to cdnr (registered buyers) or cdnur (B2CL bills);
 * notes on B2CS bills are netted into b2cs (credit notes take value off, debit notes add it), and the HSN summary
 * moves the same way. Nil-rated (Table 8) and advances are not produced here (packages/gstfiling adds them). Exports (place of supply 96
 * or an export supply type) are left out of B2B / B2CL / B2CS: they belong in table 6A (`exp`, built by
 * packages/gstfiling); their credit notes go to CDNUR as EXPWP / EXPWOP. Supplies to an SEZ are B2B with invoice type
 * SEWP / SEWOP (always IGST). Their HSN lines are in the HSN summary like any other supply.
 */

/** An export: an export supply type, or (bills before supply types existed) place of supply 96. */
export function isExportDoc(inv: Pick<EInvoiceSource, "supplyType" | "placeOfSupply">): boolean {
  if (inv.supplyType === "export_wpay" || inv.supplyType === "export_wopay") return true;
  if (inv.supplyType === "sez_wpay" || inv.supplyType === "sez_wopay") return false;
  return normalizeStateCode(inv.placeOfSupply) === "96";
}

/** With payment of IGST: the supply type says so, else IGST was charged. */
export const withIgstPaid = (inv: Pick<EInvoiceSource, "supplyType" | "totals">): boolean =>
  inv.supplyType === "export_wpay" || inv.supplyType === "sez_wpay" ? true : inv.supplyType === "export_wopay" || inv.supplyType === "sez_wopay" ? false : inv.totals.igst > 0;

/** GSTR-1 invoice type of a B2B document: SEZ with / without payment, else regular. */
export const b2bInvoiceType = (inv: Pick<EInvoiceSource, "supplyType">): Gstr1B2bInvoice["inv_typ"] =>
  inv.supplyType === "sez_wpay" ? "SEWP" : inv.supplyType === "sez_wopay" ? "SEWOP" : "R";

/** B2CL: inter-state supply to an unregistered buyer above ₹1,00,000 (from Aug 2024; was ₹2,50,000). */
export const B2CL_THRESHOLD_PAISE = 100_000_00;

export interface Gstr1ItemDetail {
  txval: number;
  rt: number;
  iamt?: number;
  camt?: number;
  samt?: number;
  csamt: number;
}
export interface Gstr1Item {
  num: number;
  itm_det: Gstr1ItemDetail;
}
export interface Gstr1B2bInvoice {
  inum: string;
  /** "DD-MM-YYYY". */
  idt: string;
  val: number;
  pos: string;
  rchrg: "N" | "Y";
  inv_typ: "R" | "SEWP" | "SEWOP" | "DE" | "CBW";
  itms: Gstr1Item[];
}
export interface Gstr1B2b {
  ctin: string;
  inv: Gstr1B2bInvoice[];
}
export interface Gstr1B2cl {
  pos: string;
  inv: { inum: string; idt: string; val: number; itms: Gstr1Item[] }[];
}
export interface Gstr1B2cs {
  sply_ty: "INTRA" | "INTER";
  rt: number;
  typ: "OE";
  pos: string;
  txval: number;
  iamt?: number;
  camt?: number;
  samt?: number;
  csamt: number;
}
export interface Gstr1HsnRow {
  num: number;
  hsn_sc: string;
  desc: string;
  uqc: string;
  qty: number;
  rt: number;
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
}
/** A credit / debit note (Table 9B). */
export interface Gstr1Note {
  /** "C" credit note, "D" debit note. */
  ntty: "C" | "D";
  nt_num: string;
  /** "DD-MM-YYYY". */
  nt_dt: string;
  pos: string;
  rchrg: "N" | "Y";
  inv_typ: "R" | "SEWP" | "SEWOP" | "DE" | "CBW";
  val: number;
  itms: Gstr1Item[];
}
export interface Gstr1Cdnr {
  ctin: string;
  nt: Gstr1Note[];
}
export interface Gstr1Cdnur {
  /** Supply type of the original bill. */
  typ: "B2CL" | "EXPWP" | "EXPWOP";
  ntty: "C" | "D";
  nt_num: string;
  nt_dt: string;
  pos: string;
  val: number;
  itms: Gstr1Item[];
}
export interface Gstr1DocIssue {
  doc_det: {
    doc_num: number;
    doc_typ: string;
    docs: { num: number; from: string; to: string; totnum: number; cancel: number; net_issue: number }[];
  }[];
}
export interface Gstr1Json {
  gstin: string;
  fp: string;
  version?: string;
  hash?: string;
  b2b: Gstr1B2b[];
  b2cl: Gstr1B2cl[];
  b2cs: Gstr1B2cs[];
  cdnr: Gstr1Cdnr[];
  cdnur: Gstr1Cdnur[];
  /** Table 12; split into B2B / B2C tabs since 2025 (`legacy` layout: `{ data }`). */
  hsn: { hsn_b2b: Gstr1HsnRow[]; hsn_b2c: Gstr1HsnRow[] } | { data: Gstr1HsnRow[] };
  doc_issue: Gstr1DocIssue;
}

export interface Gstr1Options {
  gstin: string;
  /** "MMYYYY". */
  period: string;
  /** Default "split" (`hsn_b2b` / `hsn_b2c`). */
  hsnLayout?: "split" | "legacy";
  /** Optional `version` string written into the file (e.g. the offline tool version). */
  version?: string;
  /** A wider range than the month of `period`: a quarter for QRMP shops, whose quarterly return is named by its last month. */
  range?: { from: string; to: string };
}

export interface Gstr1Result {
  json: Gstr1Json;
  warnings: string[];
  counts: { b2b: number; b2cl: number; b2cs: number; cdnr: number; cdnur: number; cancelled: number; skipped: number; exp: number };
}

/** "102026" → { from: "2026-10-01", to: "2026-10-31" }; null when malformed. */
export function periodRange(period: string): { from: string; to: string } | null {
  const m = /^(0[1-9]|1[0-2])(\d{4})$/.exec(period);
  if (!m) return null;
  const month = Number(m[1]);
  const year = Number(m[2]);
  if (year < 2017) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, "0")}` };
}

type Section = "b2b" | "b2cl" | "b2cs";

/** GSTR-1 section of a bill: registered buyer → B2B; inter-state unregistered above ₹1 lakh → B2CL; else B2CS. */
export function gstr1Section(inv: Pick<EInvoiceSource, "buyer" | "seller" | "interState" | "totals">): Section {
  const g = inv.buyer.gstin;
  if (g && isValidGstin(g) && normalizeGstin(g) !== normalizeGstin(inv.seller.gstin ?? "")) return "b2b";
  if (inv.interState && inv.totals.total > B2CL_THRESHOLD_PAISE) return "b2cl";
  return "b2cs";
}

interface Amounts {
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
}
const zero = (): Amounts => ({ taxable: 0, igst: 0, cgst: 0, sgst: 0 });
const add = (a: Amounts, l: Amounts) => {
  a.taxable += l.taxable;
  a.igst += l.igst;
  a.cgst += l.cgst;
  a.sgst += l.sgst;
};

function byRate(inv: EInvoiceSource): [number, Amounts][] {
  const m = new Map<number, Amounts>();
  for (const l of inv.lines) {
    const a = m.get(l.gstRate) ?? zero();
    add(a, l);
    m.set(l.gstRate, a);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

const itemDetail = (rt: number, a: Amounts, inter: boolean, onlyIgst = false): Gstr1ItemDetail =>
  inter || onlyIgst
    ? { txval: rupees(a.taxable), rt, iamt: rupees(a.igst), csamt: 0 }
    : { txval: rupees(a.taxable), rt, camt: rupees(a.cgst), samt: rupees(a.sgst), csamt: 0 };

/** Splits "INV/26-27/0042" into series "INV/26-27/" and sequence 42 (no trailing digits → the whole number). */
export function splitDocNumber(no: string): { series: string; seq: number | null } {
  const m = /^(.*?)(\d+)$/.exec(no);
  return m ? { series: m[1]!, seq: Number(m[2]) } : { series: no, seq: null };
}

/**
 * GSTR-1 section of a credit note: registered buyer → CDNR; unregistered buyer of a B2CL bill (inter-state, original
 * bill above the threshold) → CDNUR; otherwise it is netted into B2CS.
 */
export function noteSection(n: Pick<EInvoiceSource, "buyer" | "seller" | "interState" | "totals" | "precedingDoc">): "cdnr" | "cdnur" | "b2cs" {
  const g = n.buyer.gstin;
  if (g && isValidGstin(g) && normalizeGstin(g) !== normalizeGstin(n.seller.gstin ?? "")) return "cdnr";
  const original = n.precedingDoc?.total ?? n.totals.total;
  if (n.interState && original > B2CL_THRESHOLD_PAISE) return "cdnur";
  return "b2cs";
}

type HsnAcc = Gstr1HsnRow & { p: Amounts };
function mergeHsn(a: Map<string, HsnAcc>, b: Map<string, HsnAcc>): Map<string, HsnAcc> {
  const out = new Map<string, HsnAcc>();
  for (const [k, v] of [...a, ...b]) {
    const cur = out.get(k);
    if (!cur) out.set(k, { ...v, p: { ...v.p } });
    else {
      cur.qty = roundTo(cur.qty + v.qty, 3);
      add(cur.p, v.p);
    }
  }
  return out;
}

/** Builds the GSTR-1 JSON for one return period. Pure. */
export function buildGstr1(invoices: readonly EInvoiceSource[], opts: Gstr1Options): Gstr1Result {
  const range = opts.range ?? periodRange(opts.period);
  if (!range || !periodRange(opts.period)) throw new RangeError(`Invalid return period: ${opts.period} (use MMYYYY)`);
  const gstin = normalizeGstin(opts.gstin);
  const warnings: string[] = [];
  const counts = { b2b: 0, b2cl: 0, b2cs: 0, cdnr: 0, cdnur: 0, cancelled: 0, skipped: 0, exp: 0 };

  const b2b = new Map<string, Gstr1B2bInvoice[]>();
  const b2cl = new Map<string, Gstr1B2cl["inv"]>();
  const b2cs = new Map<string, { sply: "INTRA" | "INTER"; pos: string; rt: number; a: Amounts }>();
  const hsn = { b2b: new Map<string, Gstr1HsnRow & { p: Amounts }>(), b2c: new Map<string, Gstr1HsnRow & { p: Amounts }>() };
  const docs = new Map<string, { numbers: string[]; seqs: number[]; cancelled: number }>();
  const noteDocs = new Map<string, { numbers: string[]; seqs: number[]; cancelled: number }>();
  const debitDocs = new Map<string, { numbers: string[]; seqs: number[]; cancelled: number }>();
  const cdnr = new Map<string, Gstr1Note[]>();
  const cdnur: Gstr1Cdnur[] = [];

  const sorted = [...invoices].sort((a, b) => a.date.localeCompare(b.date) || (a.number ?? "").localeCompare(b.number ?? ""));
  for (const inv of sorted) {
    const no = (inv.number ?? "").trim();
    if (!no || inv.status === "draft") continue;
    const isDebit = inv.docType === "DBN";
    const isNote = inv.docType === "CRN" || isDebit;
    // Credit notes take value off B2CS / HSN; debit notes add it.
    const sign = isDebit ? 1 : -1;
    if (inv.date < range.from || inv.date > range.to) {
      warnings.push(`${no}: dated ${inv.date}, outside ${opts.period}`);
      counts.skipped += 1;
      continue;
    }
    if (inv.seller.gstin && normalizeGstin(inv.seller.gstin) !== gstin) {
      warnings.push(`${no}: issued under another GSTIN (${normalizeGstin(inv.seller.gstin)})`);
      counts.skipped += 1;
      continue;
    }

    // doc_issue counts every numbered bill (and credit / debit note), cancelled ones included.
    const { series, seq } = splitDocNumber(no);
    const docMap = isDebit ? debitDocs : isNote ? noteDocs : docs;
    const d = docMap.get(series) ?? { numbers: [], seqs: [], cancelled: 0 };
    d.numbers.push(no);
    if (seq !== null) d.seqs.push(seq);
    docMap.set(series, d);
    if (inv.status === "cancelled") {
      d.cancelled += 1;
      counts.cancelled += 1;
      continue;
    }

    const pos = normalizeStateCode(inv.placeOfSupply) ?? inv.placeOfSupply;
    const sellerState = stateFromGstin(gstin);
    const exportDoc = isExportDoc(inv);
    const sez = inv.supplyType === "sez_wpay" || inv.supplyType === "sez_wopay";
    // Exports and SEZ supplies are inter-State (IGST) whatever the States.
    const inter = exportDoc || sez ? true : sellerState ? sellerState !== pos : inv.interState;
    if (inter !== inv.interState) warnings.push(`${no}: inter-state flag does not match the place of supply; using ${inter ? "IGST" : "CGST/SGST"}`);

    if (isNote) {
      const ns = exportDoc ? "cdnur" : noteSection(inv);
      const rates = byRate(inv);
      const note = { ntty: isDebit ? ("D" as const) : ("C" as const), nt_num: no, nt_dt: toGstr1Date(inv.date), pos, val: rupees(inv.totals.total) };
      if (ns === "cdnr") {
        counts.cdnr += 1;
        const ctin = normalizeGstin(inv.buyer.gstin!);
        const list = cdnr.get(ctin) ?? [];
        list.push({ ...note, rchrg: "N", inv_typ: b2bInvoiceType(inv), itms: rates.map(([rt, a], i) => ({ num: i + 1, itm_det: itemDetail(rt, a, inter) })) });
        cdnr.set(ctin, list);
      } else if (ns === "cdnur") {
        counts.cdnur += 1;
        cdnur.push({ typ: exportDoc ? (withIgstPaid(inv) ? "EXPWP" : "EXPWOP") : "B2CL", ...note, itms: rates.map(([rt, a], i) => ({ num: i + 1, itm_det: itemDetail(rt, a, true, true) })) });
      } else {
        // Notes on small B2C bills change the B2CS figures of the period (credit notes down, debit notes up).
        counts.b2cs += 1;
        for (const [rt, a] of rates) {
          const sply = inter ? "INTER" : "INTRA";
          const key = `${sply}|${pos}|${rt}`;
          const row = b2cs.get(key) ?? { sply, pos, rt, a: zero() };
          add(row.a, { taxable: sign * a.taxable, igst: sign * a.igst, cgst: sign * a.cgst, sgst: sign * a.sgst });
          b2cs.set(key, row);
        }
      }
      const tab = ns === "cdnr" ? hsn.b2b : hsn.b2c;
      for (const l of inv.lines) {
        const code = (l.hsn ?? "").replace(/\s+/g, "");
        const service = isServiceHsn(code);
        const hq = hsnQty(l);
        const uqc = service ? "NA" : toUqc(hq.unit);
        const key = `${code}|${uqc}|${l.gstRate}`;
        const row = tab.get(key) ?? {
          num: 0,
          hsn_sc: code,
          desc: l.description.replace(/\s+/g, " ").trim().slice(0, 30),
          uqc,
          qty: 0,
          rt: l.gstRate,
          txval: 0,
          iamt: 0,
          camt: 0,
          samt: 0,
          csamt: 0,
          p: zero(),
        };
        if (!service) row.qty = roundTo(row.qty + sign * hq.qty, 3);
        add(row.p, { taxable: sign * l.taxable, igst: sign * l.igst, cgst: sign * l.cgst, sgst: sign * l.sgst });
        tab.set(key, row);
      }
      continue;
    }

    const rates = byRate(inv);
    const idt = toGstr1Date(inv.date);
    const val = rupees(inv.totals.total);
    // Table 6A (exports) is built by gstfiling; an SEZ supply is B2B (with the SEZ unit's GSTIN).
    let section: Section | "exp";
    if (exportDoc) section = "exp";
    else {
      section = gstr1Section(inv);
      if (sez && section !== "b2b") warnings.push(`${no}: supply to an SEZ without a valid buyer GSTIN; reported as B2C`);
    }
    counts[section] += 1;

    if (section === "exp") {
      // Reported in table 6A; only the HSN summary below.
    } else if (section === "b2b") {
      const ctin = normalizeGstin(inv.buyer.gstin!);
      const list = b2b.get(ctin) ?? [];
      list.push({
        inum: no,
        idt,
        val,
        pos,
        rchrg: "N",
        inv_typ: b2bInvoiceType(inv),
        itms: rates.map(([rt, a], i) => ({ num: i + 1, itm_det: itemDetail(rt, a, inter) })),
      });
      b2b.set(ctin, list);
    } else if (section === "b2cl") {
      const list = b2cl.get(pos) ?? [];
      list.push({ inum: no, idt, val, itms: rates.map(([rt, a], i) => ({ num: i + 1, itm_det: itemDetail(rt, a, true, true) })) });
      b2cl.set(pos, list);
    } else {
      for (const [rt, a] of rates) {
        const sply = inter ? "INTER" : "INTRA";
        const key = `${sply}|${pos}|${rt}`;
        const row = b2cs.get(key) ?? { sply, pos, rt, a: zero() };
        add(row.a, a);
        b2cs.set(key, row);
      }
    }

    const tab = section === "b2b" ? hsn.b2b : hsn.b2c;
    for (const l of inv.lines) {
      const code = (l.hsn ?? "").replace(/\s+/g, "");
      if (!code) warnings.push(`${no}: a line without HSN ("${l.description}") is reported under HSN "" — add HSN codes`);
      const service = isServiceHsn(code);
      const hq = hsnQty(l);
      const uqc = service ? "NA" : toUqc(hq.unit);
      const key = `${code}|${uqc}|${l.gstRate}`;
      const row = tab.get(key) ?? {
        num: 0,
        hsn_sc: code,
        desc: l.description.replace(/\s+/g, " ").trim().slice(0, 30),
        uqc,
        qty: 0,
        rt: l.gstRate,
        txval: 0,
        iamt: 0,
        camt: 0,
        samt: 0,
        csamt: 0,
        p: zero(),
      };
      if (!service) row.qty = roundTo(row.qty + hq.qty, 3);
      add(row.p, l);
      tab.set(key, row);
    }
  }

  const hsnRows = (m: Map<string, Gstr1HsnRow & { p: Amounts }>): Gstr1HsnRow[] =>
    [...m.values()]
      .sort((a, b) => a.hsn_sc.localeCompare(b.hsn_sc) || a.uqc.localeCompare(b.uqc) || a.rt - b.rt)
      .map(({ p, ...r }, i) => ({ ...r, num: i + 1, txval: rupees(p.taxable), iamt: rupees(p.igst), camt: rupees(p.cgst), samt: rupees(p.sgst) }));

  const docRowsOf = (m: typeof docs) => [...m.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([series, d], i) => {
      let from: string;
      let to: string;
      if (d.seqs.length === d.numbers.length && d.seqs.length > 0) {
        const pairs = d.numbers.map((n) => ({ n, s: splitDocNumber(n).seq! })).sort((a, b) => a.s - b.s);
        from = pairs[0]!.n;
        to = pairs[pairs.length - 1]!.n;
      } else {
        const s = [...d.numbers].sort();
        from = s[0] ?? series;
        to = s[s.length - 1] ?? series;
      }
      const totnum = d.numbers.length;
      return { num: i + 1, from, to, totnum, cancel: d.cancelled, net_issue: totnum - d.cancelled };
    });
  const docRows = docRowsOf(docs);
  const noteRows = docRowsOf(noteDocs);
  const debitRows = docRowsOf(debitDocs);

  const json: Gstr1Json = {
    gstin,
    fp: opts.period,
    ...(opts.version ? { version: opts.version } : {}),
    b2b: [...b2b.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([ctin, inv]) => ({ ctin, inv })),
    b2cl: [...b2cl.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([pos, inv]) => ({ pos, inv })),
    b2cs: [...b2cs.values()]
      .sort((a, b) => a.pos.localeCompare(b.pos) || a.sply.localeCompare(b.sply) || a.rt - b.rt)
      .map((r) => ({
        sply_ty: r.sply,
        rt: r.rt,
        typ: "OE" as const,
        pos: r.pos,
        txval: rupees(r.a.taxable),
        ...(r.sply === "INTER" ? { iamt: rupees(r.a.igst) } : { camt: rupees(r.a.cgst), samt: rupees(r.a.sgst) }),
        csamt: 0,
      })),
    cdnr: [...cdnr.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([ctin, nt]) => ({ ctin, nt })),
    cdnur,
    hsn:
      opts.hsnLayout === "legacy"
        ? { data: hsnRows(mergeHsn(hsn.b2b, hsn.b2c)) }
        : { hsn_b2b: hsnRows(hsn.b2b), hsn_b2c: hsnRows(hsn.b2c) },
    doc_issue: {
      doc_det: [
        ...(docRows.length ? [{ doc_num: 1, doc_typ: "Invoices for outward supply", docs: docRows }] : []),
        ...(debitRows.length ? [{ doc_num: 4, doc_typ: "Debit Note", docs: debitRows }] : []),
        ...(noteRows.length ? [{ doc_num: 5, doc_typ: "Credit Note", docs: noteRows }] : []),
      ],
    },
  };
  return { json, warnings, counts };
}

import { isValidGstin, normalizeGstin } from "@srirealtime/gst";
import { monthOf, parsePortalDate, type Tax } from "./util";

/**
 * GSTR-2B reconciliation, file based: the owner downloads the GSTR-2B JSON (or Excel) from the GST portal and uploads it
 * here. Nothing is fetched from the portal. Pure functions: parse the file into rows, then match the rows with the
 * purchase bills and expenses by supplier GSTIN + invoice number + date + amounts.
 *
 * The JSON layout parsed is the portal's GSTR-2B download: `data.data.docdata.{b2b,b2ba,cdnr,cdnra,isd,impg}` (with `ctin`,
 * `trdnm`, `inv[]` or `nt[]`, and per document `inum`/`ntnum`, `dt`, `val`, `pos`, `rev`, `itcavl`, `rsn`, `txval`, `igst`,
 * `cgst`, `sgst`, `cess`). Totals may also sit under `items[]`; both forms are read. See docs/gst-filing.md for what
 * was and was not checked against real portal files.
 */

export type Section2b = "b2b" | "b2ba" | "cdnr" | "cdnra" | "isd" | "impg";

export interface Row2b {
  section: Section2b;
  supplierGstin: string;
  supplierName: string | null;
  /** inv = invoice, cn = credit note, dn = debit note. */
  docKind: "inv" | "cn" | "dn";
  docNumber: string;
  docDate: string | null;
  docValue: number;
  pos: string | null;
  reverseCharge: boolean;
  itcAvailable: boolean;
  reason: string | null;
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export interface Parsed2b {
  gstin: string | null;
  /** "YYYY-MM". */
  month: string | null;
  generatedOn: string | null;
  rows: Row2b[];
  warnings: string[];
}

const paise = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "")) : 0;
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const yes = (v: unknown) => typeof v === "string" ? /^(y|yes|true)$/i.test(v.trim()) : v === true;

interface AmountSrc {
  txval?: unknown;
  igst?: unknown;
  cgst?: unknown;
  sgst?: unknown;
  cess?: unknown;
  iamt?: unknown;
  camt?: unknown;
  samt?: unknown;
  csamt?: unknown;
  items?: unknown;
}
function amountsOf(d: AmountSrc): Pick<Row2b, "taxable" | "igst" | "cgst" | "sgst" | "cess"> {
  const items = Array.isArray(d.items) ? (d.items as AmountSrc[]) : null;
  const src = items && items.length ? items : [d];
  let taxable = 0;
  let igst = 0;
  let cgst = 0;
  let sgst = 0;
  let cess = 0;
  for (const i of src) {
    taxable += paise(i.txval);
    igst += paise(i.igst ?? i.iamt);
    cgst += paise(i.cgst ?? i.camt);
    sgst += paise(i.sgst ?? i.samt);
    cess += paise(i.cess ?? i.csamt);
  }
  return { taxable, igst, cgst, sgst, cess };
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** Parses the downloaded GSTR-2B JSON (wrapped as the portal gives it, or just the inner object). */
export function parseGstr2bJson(raw: unknown): Parsed2b {
  const warnings: string[] = [];
  // The portal wraps the document data in one or two levels of "data"; walk down and take what each level has.
  const chain: Rec[] = [];
  for (let n: unknown = raw; isRec(n) && chain.length < 4; n = (n as Rec).data) chain.push(n as Rec);
  const root = chain.find((n) => "rtnprd" in n || "gstin" in n) ?? chain[0];
  if (!root) throw new Error("This does not look like a GSTR-2B JSON file");
  const docdata = chain.map((n) => n.docdata).find(isRec) ?? null;
  if (!docdata) throw new Error("This JSON has no GSTR-2B document data (docdata)");
  const rtnprd = str(root.rtnprd);
  const month = /^(0[1-9]|1[0-2])(\d{4})$/.test(rtnprd) ? `${rtnprd.slice(2)}-${rtnprd.slice(0, 2)}` : null;
  const gstin = str(root.gstin) ? normalizeGstin(str(root.gstin)) : null;
  const rows: Row2b[] = [];

  const invoices = (section: "b2b" | "b2ba") => {
    for (const sup of Array.isArray(docdata[section]) ? (docdata[section] as Rec[]) : []) {
      const ctin = normalizeGstin(str(sup.ctin));
      for (const d of Array.isArray(sup.inv) ? (sup.inv as Rec[]) : []) {
        const number = str(d.inum);
        if (!number) {
          warnings.push(`${ctin}: an invoice without a number was skipped`);
          continue;
        }
        rows.push({
          section,
          supplierGstin: ctin,
          supplierName: str(sup.trdnm) || null,
          docKind: "inv",
          docNumber: number,
          docDate: parsePortalDate(d.dt),
          docValue: paise(d.val),
          pos: str(d.pos) || null,
          reverseCharge: yes(d.rev),
          itcAvailable: d.itcavl === undefined ? true : yes(d.itcavl),
          reason: str(d.rsn) || null,
          ...amountsOf(d as AmountSrc),
        });
      }
    }
  };
  const notes = (section: "cdnr" | "cdnra") => {
    for (const sup of Array.isArray(docdata[section]) ? (docdata[section] as Rec[]) : []) {
      const ctin = normalizeGstin(str(sup.ctin));
      for (const d of Array.isArray(sup.nt) ? (sup.nt as Rec[]) : []) {
        const number = str(d.ntnum);
        if (!number) continue;
        rows.push({
          section,
          supplierGstin: ctin,
          supplierName: str(sup.trdnm) || null,
          docKind: str(d.typ).toUpperCase().startsWith("D") ? "dn" : "cn",
          docNumber: number,
          docDate: parsePortalDate(d.dt),
          docValue: paise(d.val),
          pos: str(d.pos) || null,
          reverseCharge: yes(d.rev),
          itcAvailable: d.itcavl === undefined ? true : yes(d.itcavl),
          reason: str(d.rsn) || null,
          ...amountsOf(d as AmountSrc),
        });
      }
    }
  };
  invoices("b2b");
  invoices("b2ba");
  notes("cdnr");
  notes("cdnra");
  for (const sup of Array.isArray(docdata.isd) ? (docdata.isd as Rec[]) : []) {
    // ISD documents sit in a doclist under the distributor; a flat record is also read.
    const docs = Array.isArray(sup.doclist) ? (sup.doclist as Rec[]) : [sup];
    for (const d of docs) {
      const number = str(d.docnum) || str(d.docno);
      if (!number) continue;
      rows.push({
        section: "isd",
        supplierGstin: normalizeGstin(str(sup.ctin)),
        supplierName: str(sup.trdnm) || null,
        docKind: "inv",
        docNumber: number,
        docDate: parsePortalDate(d.docdt),
        docValue: 0,
        pos: null,
        reverseCharge: false,
        itcAvailable: d.itcelg === undefined ? true : yes(d.itcelg),
        reason: null,
        ...amountsOf(d as AmountSrc),
      });
    }
  }
  for (const d of Array.isArray(docdata.impg) ? (docdata.impg as Rec[]) : []) {
    const number = str(d.boenum);
    if (!number) continue;
    rows.push({
      section: "impg",
      supplierGstin: "",
      supplierName: str(d.portcode) ? `Port ${str(d.portcode)}` : "Customs",
      docKind: "inv",
      docNumber: number,
      docDate: parsePortalDate(d.boedt),
      docValue: 0,
      pos: null,
      reverseCharge: false,
      itcAvailable: true,
      reason: null,
      ...amountsOf(d as AmountSrc),
    });
  }
  return { gstin, month, generatedOn: str(root.gendt) || null, rows, warnings };
}

/** Header names of the portal's Excel (sheet "B2B" / "B2B-CDNR"), lower-cased and stripped of punctuation. */
const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const HEADER_ALIASES: Record<string, string> = {
  "gstin of supplier": "gstin",
  "trade legal name": "name",
  "trade legal name of the supplier": "name",
  "invoice number": "number",
  "note number": "number",
  "invoice type": "type",
  "note type": "type",
  "invoice date": "date",
  "note date": "date",
  "invoice value": "value",
  "note value": "value",
  "place of supply": "pos",
  "supply attract reverse charge": "rev",
  "taxable value": "taxable",
  "integrated tax": "igst",
  "central tax": "cgst",
  "state ut tax": "sgst",
  "cess": "cess",
  "itc availability": "avl",
  "reason": "reason",
};
const cleanHeader = (h: string) => norm(h).replace(/ ?\([^)]*\)/g, "").replace(/\s+/g, " ").trim();

/**
 * Reads the rows of the portal's GSTR-2B Excel: the first worksheet named like B2B (invoices) and the one like CDNR
 * (credit / debit notes). `sheets` maps a sheet name to its rows of cell text. The header row is the first row that has
 * both "GSTIN of supplier" and an invoice / note number column.
 */
export function parseGstr2bSheets(sheets: Record<string, string[][]>): Parsed2b {
  const warnings: string[] = [];
  const rows: Row2b[] = [];
  let gstin: string | null = null;
  let month: string | null = null;
  for (const [name, data] of Object.entries(sheets)) {
    const lower = name.toLowerCase();
    if (lower.includes("read me") || lower.includes("summary")) {
      for (const r of data) {
        const line = r.join(" ");
        const g = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/.exec(line);
        if (g && !gstin) gstin = g[0];
        const p = /(?:tax period|return period)[^A-Za-z0-9]*([A-Za-z]+)[^A-Za-z0-9]*(\d{4})/i.exec(line);
        if (p && !month) {
          const mi = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].findIndex((m) => m.startsWith(p[1]!.toLowerCase().slice(0, 3)));
          if (mi >= 0) month = `${p[2]}-${String(mi + 1).padStart(2, "0")}`;
        }
      }
      continue;
    }
    const isNotes = /cdn/.test(lower);
    const isInv = /^b2b$/.test(lower.trim()) || lower.trim() === "b2ba" || (/b2b/.test(lower) && !isNotes);
    if (!isNotes && !isInv) continue;
    if (/a$/.test(lower.trim()) && !/b2ba|cdnra/.test(lower.trim())) continue;
    let headerAt = -1;
    let cols: Record<string, number> = {};
    for (let i = 0; i < Math.min(data.length, 12); i++) {
      const c: Record<string, number> = {};
      data[i]!.forEach((cell, idx) => {
        const key = HEADER_ALIASES[cleanHeader(cell)];
        if (key && !(key in c)) c[key] = idx;
      });
      if ("gstin" in c && "number" in c) {
        headerAt = i;
        cols = c;
        break;
      }
    }
    if (headerAt < 0) {
      warnings.push(`Sheet "${name}": header row not found`);
      continue;
    }
    for (const r of data.slice(headerAt + 1)) {
      const g = normalizeGstin(r[cols.gstin!] ?? "");
      const number = (r[cols.number!] ?? "").trim();
      if (!number || !/^\d{2}[A-Z0-9]{13}$/.test(g)) continue;
      const typ = (r[cols.type ?? -1] ?? "").trim().toLowerCase();
      rows.push({
        section: isNotes ? "cdnr" : "b2b",
        supplierGstin: g,
        supplierName: (cols.name !== undefined ? r[cols.name] : "")?.trim() || null,
        docKind: isNotes ? (typ.startsWith("debit") || typ === "d" ? "dn" : "cn") : "inv",
        docNumber: number,
        docDate: parsePortalDate(r[cols.date ?? -1] ?? ""),
        docValue: paise(r[cols.value ?? -1] ?? ""),
        pos: (r[cols.pos ?? -1] ?? "").trim().slice(0, 2) || null,
        reverseCharge: yes(r[cols.rev ?? -1] ?? ""),
        itcAvailable: cols.avl === undefined ? true : yes(r[cols.avl] ?? "Yes"),
        reason: (r[cols.reason ?? -1] ?? "").trim() || null,
        taxable: paise(r[cols.taxable ?? -1] ?? ""),
        igst: paise(r[cols.igst ?? -1] ?? ""),
        cgst: paise(r[cols.cgst ?? -1] ?? ""),
        sgst: paise(r[cols.sgst ?? -1] ?? ""),
        cess: paise(r[cols.cess ?? -1] ?? ""),
      });
    }
  }
  // The portal's Excel lists one row per rate; fold rows of the same document together.
  const folded = new Map<string, Row2b>();
  for (const r of rows) {
    const key = `${r.docKind}|${r.supplierGstin}|${r.docNumber}`;
    const cur = folded.get(key);
    if (!cur) folded.set(key, { ...r });
    else {
      cur.taxable += r.taxable;
      cur.igst += r.igst;
      cur.cgst += r.cgst;
      cur.sgst += r.sgst;
      cur.cess += r.cess;
    }
  }
  return { gstin, month, generatedOn: null, rows: [...folded.values()], warnings };
}

// ------------------------------------------------------------------ matching

/** A purchase bill, expense or debit note of the books that can be matched to a 2B row. */
export interface BookDoc {
  key: string;
  docType: "purchase" | "expense" | "debit_note";
  docId: string;
  gstin: string | null;
  party: string;
  number: string;
  date: string;
  taxable: number;
  tax: Tax;
  total: number;
}

export type MatchKind = "matched" | "fuzzy" | "amount_mismatch" | "missing_in_books";

export interface MatchOptions {
  /** Paise: two amounts within this are equal. Default 100 (one rupee). */
  tolerance?: number;
  /** Days apart two dates may be for a fuzzy match. Default 5. */
  dateDays?: number;
}

export interface RowMatch {
  index: number;
  status: MatchKind;
  doc: BookDoc | null;
  /** Which fields differ: [value in 2B, value in books]. */
  diff: Record<string, [unknown, unknown]>;
  /** 0..100, how sure the match is. */
  score: number;
}

/** "INV/26-27/0042" -> "INV26270042"; zeros after a non-digit and leading zeros are dropped: "INV/0042" -> "INV42". */
export function normalizeNumber(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "|")
    .replace(/(^|[^0-9])0+(?=[0-9])/g, "$1")
    .replace(/\|/g, "");
}

export function levenshtein(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let min = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < min) min = v;
    }
    if (min > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

const sameNumber = (a: string, b: string) => normalizeNumber(a) === normalizeNumber(b);
function similarNumber(a: string, b: string): boolean {
  const x = normalizeNumber(a);
  const y = normalizeNumber(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  if (s.length >= 2 && l.endsWith(s)) return true;
  return levenshtein(x, y, 2) <= 2;
}

const dayDiff = (a: string | null, b: string | null) => (a && b ? Math.abs(Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000)) : 999);

/**
 * Matches 2B rows (a supplier's reported documents) to the books. One book document matches at most one row. Order of
 * preference: same GSTIN and same number with matching amounts (matched), same GSTIN and a similar number or a
 * matching amount and date (fuzzy), same GSTIN and number but different amounts or date (amount mismatch), else
 * missing in the books. Credit and debit notes match on amounts, not numbers (the supplier numbers its own notes).
 */
export function matchRows(rows: readonly Row2b[], docs: readonly BookDoc[], opts: MatchOptions = {}): { matches: RowMatch[]; missingIn2b: BookDoc[] } {
  const tol = opts.tolerance ?? 100;
  const dateDays = opts.dateDays ?? 5;
  const byGstin = new Map<string, BookDoc[]>();
  for (const d of docs) {
    if (!d.gstin) continue;
    const list = byGstin.get(d.gstin) ?? [];
    list.push(d);
    byGstin.set(d.gstin, list);
  }
  const used = new Set<string>();
  const out: RowMatch[] = rows.map((_, index) => ({ index, status: "missing_in_books" as MatchKind, doc: null, diff: {}, score: 0 }));

  const amountsEqual = (r: Row2b, d: BookDoc) =>
    Math.abs(r.taxable - d.taxable) <= tol &&
    Math.abs(r.igst - d.tax.igst) <= tol &&
    Math.abs(r.cgst - d.tax.cgst) <= tol &&
    Math.abs(r.sgst - d.tax.sgst) <= tol &&
    Math.abs(r.cess - d.tax.cess) <= tol;
  const diffOf = (r: Row2b, d: BookDoc) => {
    const diff: Record<string, [unknown, unknown]> = {};
    if (Math.abs(r.taxable - d.taxable) > tol) diff.taxable = [r.taxable, d.taxable];
    if (Math.abs(r.igst - d.tax.igst) > tol) diff.igst = [r.igst, d.tax.igst];
    if (Math.abs(r.cgst - d.tax.cgst) > tol) diff.cgst = [r.cgst, d.tax.cgst];
    if (Math.abs(r.sgst - d.tax.sgst) > tol) diff.sgst = [r.sgst, d.tax.sgst];
    if (Math.abs(r.cess - d.tax.cess) > tol) diff.cess = [r.cess, d.tax.cess];
    if (r.docDate && r.docDate !== d.date) diff.date = [r.docDate, d.date];
    if (!sameNumber(r.docNumber, d.number)) diff.number = [r.docNumber, d.number];
    return diff;
  };

  // Pass 1: exact (same number, same amounts, date within a day); pass 2: same number but different figures;
  // pass 3: fuzzy by similar number or by amounts and date; credit/debit notes by amounts only.
  const passes: ((r: Row2b, d: BookDoc) => { status: MatchKind; score: number } | null)[] = [
    (r, d) => (r.docKind === "inv" && d.docType !== "debit_note" && sameNumber(r.docNumber, d.number) && amountsEqual(r, d) && dayDiff(r.docDate, d.date) <= 1 ? { status: "matched", score: 100 } : null),
    (r, d) => (r.docKind === "inv" && d.docType !== "debit_note" && sameNumber(r.docNumber, d.number) && amountsEqual(r, d) ? { status: "matched", score: 95 } : null),
    (r, d) => (r.docKind === "inv" && d.docType !== "debit_note" && similarNumber(r.docNumber, d.number) && amountsEqual(r, d) && dayDiff(r.docDate, d.date) <= dateDays ? { status: "fuzzy", score: 80 } : null),
    (r, d) => (r.docKind === "inv" && d.docType !== "debit_note" && amountsEqual(r, d) && r.taxable > 0 && dayDiff(r.docDate, d.date) <= dateDays ? { status: "fuzzy", score: 60 } : null),
    (r, d) => (r.docKind !== "inv" && d.docType === "debit_note" && amountsEqual(r, d) && dayDiff(r.docDate, d.date) <= 31 ? { status: "fuzzy", score: 70 } : null),
    (r, d) => (r.docKind === "inv" && d.docType !== "debit_note" && sameNumber(r.docNumber, d.number) ? { status: "amount_mismatch", score: 50 } : null),
  ];
  for (const pass of passes) {
    rows.forEach((r, i) => {
      if (out[i]!.doc) return;
      const cands = (byGstin.get(r.supplierGstin) ?? []).filter((d) => !used.has(d.key));
      let best: { d: BookDoc; status: MatchKind; score: number } | null = null;
      for (const d of cands) {
        const res = pass(r, d);
        if (res && (!best || dayDiff(r.docDate, d.date) < dayDiff(r.docDate, best.d.date))) best = { d, ...res };
      }
      if (best) {
        used.add(best.d.key);
        out[i] = { index: i, status: best.status, doc: best.d, diff: best.status === "matched" ? {} : diffOf(r, best.d), score: best.score };
      }
    });
  }
  const missingIn2b = docs.filter((d) => d.gstin && !used.has(d.key));
  return { matches: out, missingIn2b };
}

export const validSupplier = (g: string | null | undefined) => !!g && isValidGstin(g);
export const rowMonth = (r: Row2b) => (r.docDate ? monthOf(r.docDate) : null);

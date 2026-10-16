/** Pure report shaping: GST return summaries, zero-filled trends and CSV (no database). */
import { isValidGstin, type GstRate, type LineTotals, type TaxBreakupRow } from "@srirealtime/gst";
import { addDaysISO, daysBetween } from "./ledger";

/** GSTR-1 B2CL threshold: inter-state invoices to unregistered buyers above ₹1,00,000. */
export const B2CL_THRESHOLD_PAISE = 100_000_00;
/** Longest allowed report period (one year plus a day, so 1 Apr → 1 Apr works). */
export const MAX_REPORT_DAYS = 366;

// ------------------------------------------------------------------ dates

/** Every date from `from` to `to`, inclusive, oldest first. */
export function dateList(from: string, to: string): string[] {
  const n = daysBetween(from, to);
  return Array.from({ length: Math.max(n + 1, 0) }, (_, i) => addDaysISO(from, i));
}

/** The last `days` IST dates ending today: { from, to }. */
export function trendRange(today: string, days: number): { from: string; to: string } {
  return { from: addDaysISO(today, -(Math.max(days, 1) - 1)), to: today };
}

/** A problem with a report period, or null when it is fine. */
export function rangeProblem(from: string, to: string): string | null {
  if (to < from) return "'to' must be on or after 'from'";
  if (daysBetween(from, to) > MAX_REPORT_DAYS) return "Reports cover at most one year";
  return null;
}

export interface TrendPoint {
  date: string;
  invoiced: number;
  collected: number;
  count: number;
}

/** One point per day from `from` to `to`; days without data are zeros. */
export function zeroFillTrend(
  from: string,
  to: string,
  invoiced: readonly { date: string; amount: number; count: number }[],
  collected: readonly { date: string; amount: number }[],
): TrendPoint[] {
  const inv = new Map<string, { amount: number; count: number }>();
  for (const r of invoiced) {
    const cur = inv.get(r.date) ?? { amount: 0, count: 0 };
    inv.set(r.date, { amount: cur.amount + r.amount, count: cur.count + r.count });
  }
  const col = new Map<string, number>();
  for (const r of collected) col.set(r.date, (col.get(r.date) ?? 0) + r.amount);
  return dateList(from, to).map((date) => ({
    date,
    invoiced: inv.get(date)?.amount ?? 0,
    collected: col.get(date) ?? 0,
    count: inv.get(date)?.count ?? 0,
  }));
}

// ------------------------------------------------------------------ GST summary

export interface GstInvoice {
  id: string;
  number: string | null;
  customerName: string;
  customerGstin: string | null;
  placeOfSupply: string;
  interState: boolean;
  /** Invoice grand total (after round-off), paise. */
  total: number;
  lines: readonly Pick<LineTotals, "description" | "hsn" | "unit" | "qty" | "gstRate" | "taxable" | "cgst" | "sgst" | "igst">[];
}

export type GstSection = "b2b" | "b2cl" | "b2cs";

/** An issued credit note in the period, with what GSTR-1 needs of its original invoice. */
export interface GstCreditNote {
  id: string;
  number: string;
  /** Note date "YYYY-MM-DD". */
  date: string;
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  customerGstin: string | null;
  placeOfSupply: string;
  interState: boolean;
  /** The original invoice's grand total (decides B2CL vs B2CS for unregistered buyers). */
  invoiceTotal: number;
  /** Note value (paise). */
  total: number;
  lines: GstInvoice["lines"];
}

/** GSTR-1 Table 9B, registered buyers: one row per note and rate. */
export interface CdnrRow {
  gstin: string;
  name: string;
  noteNumber: string;
  noteDate: string;
  invoiceNumber: string;
  invoiceDate: string;
  /** "C" = credit note. */
  noteType: "C";
  placeOfSupply: string;
  rate: GstRate;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** Whole note value (the same on each rate row of a note). */
  noteValue: number;
}

/** GSTR-1 Table 9B, unregistered buyers: notes against B2CL (large inter-state) invoices, per note and rate. */
export interface CdnurRow {
  noteNumber: string;
  noteDate: string;
  invoiceNumber: string;
  invoiceDate: string;
  noteType: "C";
  /** Original supply type; only "B2CL" here (notes on B2CS bills are netted into B2CS). */
  type: "B2CL";
  placeOfSupply: string;
  rate: GstRate;
  taxable: number;
  igst: number;
  noteValue: number;
}

export interface B2bRow {
  gstin: string;
  name: string;
  invoices: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}
export interface B2clRow {
  placeOfSupply: string;
  rate: GstRate;
  taxable: number;
  igst: number;
}
export interface B2csRow {
  placeOfSupply: string;
  rate: GstRate;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
}
export interface HsnRow {
  hsn: string;
  description: string;
  unit: string;
  /** GST rate of the group (HSN summary is per HSN + unit + rate). */
  rate: GstRate;
  qty: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface GstSummary {
  b2b: B2bRow[];
  b2cl: B2clRow[];
  /** Net of credit notes on B2CS bills. */
  b2cs: B2csRow[];
  /** Credit notes to registered buyers. */
  cdnr: CdnrRow[];
  /** Credit notes to unregistered buyers on B2CL bills. */
  cdnur: CdnurRow[];
  /** Net of credit notes. */
  hsn: HsnRow[];
  /** Net of credit notes. */
  byRate: TaxBreakupRow[];
  /** Net of credit notes. */
  gstr3b: { outwardTaxable: number; igst: number; cgst: number; sgst: number; nilRated: number };
  /** Invoices count; amounts net of credit notes. */
  totals: { invoices: number; creditNotes: number; taxable: number; cgst: number; sgst: number; igst: number; total: number };
  /** The credit notes' own totals (positive). */
  creditNoteTotals: { count: number; taxable: number; cgst: number; sgst: number; igst: number; total: number };
}

/**
 * GSTR-1 section of an invoice: B2B when the buyer has a valid GSTIN; B2CL when inter-state to an unregistered
 * buyer and the invoice is above ₹1,00,000; otherwise B2CS.
 */
export function gstSection(inv: Pick<GstInvoice, "customerGstin" | "interState" | "total">): GstSection {
  if (inv.customerGstin && isValidGstin(inv.customerGstin)) return "b2b";
  if (inv.interState && inv.total > B2CL_THRESHOLD_PAISE) return "b2cl";
  return "b2cs";
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function getOrAdd<K, V>(map: Map<K, V>, key: K, make: () => V): V {
  let v = map.get(key);
  if (!v) {
    v = make();
    map.set(key, v);
  }
  return v;
}

/** GSTR-1 section of a credit note: CDNR for registered buyers, CDNUR for large inter-state B2C bills, else netted into B2CS. */
export function creditNoteSection(n: Pick<GstCreditNote, "customerGstin" | "interState" | "invoiceTotal">): "cdnr" | "cdnur" | "b2cs" {
  if (n.customerGstin && isValidGstin(n.customerGstin)) return "cdnr";
  if (n.interState && n.invoiceTotal > B2CL_THRESHOLD_PAISE) return "cdnur";
  return "b2cs";
}

/**
 * Builds the GSTR-1 / GSTR-3B style summary from issued (non-cancelled) invoices and the issued credit notes of the
 * period (by note date). Credit notes are listed in CDNR / CDNUR and taken off B2CS, HSN, the rate breakup, GSTR-3B
 * and the totals.
 */
export function gstSummary(invoices: readonly GstInvoice[], creditNotes: readonly GstCreditNote[] = []): GstSummary {
  const b2b = new Map<string, B2bRow>();
  const b2cl = new Map<string, B2clRow>();
  const b2cs = new Map<string, B2csRow>();
  const hsn = new Map<string, HsnRow>();
  const byRate = new Map<GstRate, TaxBreakupRow>();
  const gstr3b = { outwardTaxable: 0, igst: 0, cgst: 0, sgst: 0, nilRated: 0 };
  const totals = { invoices: 0, creditNotes: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
  const creditNoteTotals = { count: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
  const cdnr: CdnrRow[] = [];
  const cdnur: CdnurRow[] = [];

  for (const inv of invoices) {
    const section = gstSection(inv);
    totals.invoices += 1;
    totals.total += inv.total;
    if (section === "b2b") {
      const gstin = inv.customerGstin!.replace(/\s+/g, "").toUpperCase();
      const row = getOrAdd(b2b, gstin, () => ({ gstin, name: inv.customerName, invoices: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 }));
      row.invoices += 1;
      row.total += inv.total;
    }
    for (const l of inv.lines) {
      const rate = l.gstRate;
      totals.taxable += l.taxable;
      totals.cgst += l.cgst;
      totals.sgst += l.sgst;
      totals.igst += l.igst;
      if (rate > 0) gstr3b.outwardTaxable += l.taxable;
      else gstr3b.nilRated += l.taxable;
      gstr3b.igst += l.igst;
      gstr3b.cgst += l.cgst;
      gstr3b.sgst += l.sgst;

      const br = getOrAdd(byRate, rate, () => ({ gstRate: rate, taxable: 0, cgst: 0, sgst: 0, igst: 0 }));
      br.taxable += l.taxable;
      br.cgst += l.cgst;
      br.sgst += l.sgst;
      br.igst += l.igst;

      if (section === "b2b") {
        const row = b2b.get(inv.customerGstin!.replace(/\s+/g, "").toUpperCase())!;
        row.taxable += l.taxable;
        row.cgst += l.cgst;
        row.sgst += l.sgst;
        row.igst += l.igst;
      } else if (section === "b2cl") {
        const row = getOrAdd(b2cl, `${inv.placeOfSupply}|${rate}`, () => ({ placeOfSupply: inv.placeOfSupply, rate, taxable: 0, igst: 0 }));
        row.taxable += l.taxable;
        row.igst += l.igst;
      } else {
        const row = getOrAdd(b2cs, `${inv.placeOfSupply}|${rate}`, () => ({
          placeOfSupply: inv.placeOfSupply,
          rate,
          taxable: 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
        }));
        row.taxable += l.taxable;
        row.cgst += l.cgst;
        row.sgst += l.sgst;
        row.igst += l.igst;
      }

      const code = l.hsn ?? "";
      const unit = (l.unit ?? "").trim().toLowerCase();
      const h = getOrAdd(hsn, `${code}|${unit}|${rate}`, () => ({
        hsn: code,
        description: l.description,
        unit,
        rate,
        qty: 0,
        taxable: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        total: 0,
      }));
      h.qty = round3(h.qty + l.qty);
      h.taxable += l.taxable;
      h.cgst += l.cgst;
      h.sgst += l.sgst;
      h.igst += l.igst;
      h.total += l.taxable + l.cgst + l.sgst + l.igst;
    }
  }

  for (const n of creditNotes) {
    const section = creditNoteSection(n);
    totals.creditNotes += 1;
    totals.total -= n.total;
    creditNoteTotals.count += 1;
    creditNoteTotals.total += n.total;
    const perRate = new Map<GstRate, { taxable: number; cgst: number; sgst: number; igst: number }>();
    for (const l of n.lines) {
      const rate = l.gstRate;
      totals.taxable -= l.taxable;
      totals.cgst -= l.cgst;
      totals.sgst -= l.sgst;
      totals.igst -= l.igst;
      creditNoteTotals.taxable += l.taxable;
      creditNoteTotals.cgst += l.cgst;
      creditNoteTotals.sgst += l.sgst;
      creditNoteTotals.igst += l.igst;
      if (rate > 0) gstr3b.outwardTaxable -= l.taxable;
      else gstr3b.nilRated -= l.taxable;
      gstr3b.igst -= l.igst;
      gstr3b.cgst -= l.cgst;
      gstr3b.sgst -= l.sgst;

      const br = getOrAdd(byRate, rate, () => ({ gstRate: rate, taxable: 0, cgst: 0, sgst: 0, igst: 0 }));
      br.taxable -= l.taxable;
      br.cgst -= l.cgst;
      br.sgst -= l.sgst;
      br.igst -= l.igst;

      const pr = getOrAdd(perRate, rate, () => ({ taxable: 0, cgst: 0, sgst: 0, igst: 0 }));
      pr.taxable += l.taxable;
      pr.cgst += l.cgst;
      pr.sgst += l.sgst;
      pr.igst += l.igst;

      if (section === "b2cs") {
        const row = getOrAdd(b2cs, `${n.placeOfSupply}|${rate}`, () => ({ placeOfSupply: n.placeOfSupply, rate, taxable: 0, cgst: 0, sgst: 0, igst: 0 }));
        row.taxable -= l.taxable;
        row.cgst -= l.cgst;
        row.sgst -= l.sgst;
        row.igst -= l.igst;
      }

      const code = l.hsn ?? "";
      const unit = (l.unit ?? "").trim().toLowerCase();
      const h = getOrAdd(hsn, `${code}|${unit}|${rate}`, () => ({
        hsn: code,
        description: l.description,
        unit,
        rate,
        qty: 0,
        taxable: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        total: 0,
      }));
      h.qty = round3(h.qty - l.qty);
      h.taxable -= l.taxable;
      h.cgst -= l.cgst;
      h.sgst -= l.sgst;
      h.igst -= l.igst;
      h.total -= l.taxable + l.cgst + l.sgst + l.igst;
    }
    const base = { noteNumber: n.number, noteDate: n.date, invoiceNumber: n.invoiceNumber, invoiceDate: n.invoiceDate, noteType: "C" as const };
    for (const [rate, a] of [...perRate.entries()].sort((x, y) => x[0] - y[0])) {
      if (section === "cdnr") {
        cdnr.push({
          gstin: n.customerGstin!.replace(/\s+/g, "").toUpperCase(),
          name: n.customerName,
          ...base,
          placeOfSupply: n.placeOfSupply,
          rate,
          ...a,
          noteValue: n.total,
        });
      } else if (section === "cdnur") {
        cdnur.push({ ...base, type: "B2CL", placeOfSupply: n.placeOfSupply, rate, taxable: a.taxable, igst: a.igst, noteValue: n.total });
      }
    }
  }

  const byPosRate = (a: { placeOfSupply: string; rate: number }, b: { placeOfSupply: string; rate: number }) =>
    a.placeOfSupply.localeCompare(b.placeOfSupply) || a.rate - b.rate;
  const byNote = (a: { noteDate: string; noteNumber: string; rate: number }, b: { noteDate: string; noteNumber: string; rate: number }) =>
    a.noteDate.localeCompare(b.noteDate) || a.noteNumber.localeCompare(b.noteNumber) || a.rate - b.rate;
  return {
    b2b: [...b2b.values()].sort((a, b) => a.gstin.localeCompare(b.gstin)),
    b2cl: [...b2cl.values()].sort(byPosRate),
    b2cs: [...b2cs.values()].sort(byPosRate),
    cdnr: cdnr.sort((a, b) => a.gstin.localeCompare(b.gstin) || byNote(a, b)),
    cdnur: cdnur.sort(byNote),
    hsn: [...hsn.values()].sort((a, b) => a.hsn.localeCompare(b.hsn) || a.unit.localeCompare(b.unit) || a.rate - b.rate),
    byRate: [...byRate.values()].sort((a, b) => a.gstRate - b.gstRate),
    gstr3b,
    totals,
    creditNoteTotals,
  };
}

// ------------------------------------------------------------------ CSV

export type CsvValue = string | number | boolean | null | undefined;

/** Paise → "1234.50" for spreadsheets. */
export const rupees = (paise: number | null | undefined) => ((paise ?? 0) / 100).toFixed(2);

const csvCell = (v: CsvValue): string => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Spreadsheet formula injection: text starting with = + - @ is shown as text.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** RFC 4180 CSV with CRLF line ends and a UTF-8 BOM (so Excel shows ₹ and Tamil correctly). */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [headers, ...rows].map((r) => r.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** `attachment; filename="sales-register-2026-04-01-2026-04-30.csv"` (name sanitised). */
export function csvDisposition(name: string, from?: string | null, to?: string | null): string {
  const parts = [name, from, to].filter(Boolean).join("-").replace(/[^A-Za-z0-9._-]/g, "_");
  return `attachment; filename="${parts}.csv"`;
}

// ------------------------------------------------------------------ CSV builders for each report (money in rupees)

export const csvBuilders = {
  salesRegister: (items: readonly {
    number: string | null; date: string; customer: string; gstin: string | null; placeOfSupply: string;
    taxable: number; cgst: number; sgst: number; igst: number; total: number; paid: number; status: string;
    type?: string; against?: string | null;
  }[]) =>
    toCsv(
      ["Date", "Type", "Number", "Against", "Customer", "GSTIN", "Place of supply", "Taxable", "CGST", "SGST", "IGST", "Total", "Paid", "Status"],
      items.map((i) => [
        i.date,
        i.type === "credit_note" ? "Credit note" : "Invoice",
        i.number,
        i.against ?? null,
        i.customer,
        i.gstin,
        i.placeOfSupply,
        rupees(i.taxable),
        rupees(i.cgst),
        rupees(i.sgst),
        rupees(i.igst),
        rupees(i.total),
        rupees(i.paid),
        i.status,
      ]),
    ),

  gst: (summary: GstSummary, section: "hsn" | "b2b" | "b2cl" | "b2cs" | "cdnr" | "cdnur") => {
    switch (section) {
      case "cdnr":
        return toCsv(
          ["GSTIN", "Name", "Note number", "Note date", "Invoice", "Invoice date", "Note type", "Place of supply", "Rate", "Taxable", "CGST", "SGST", "IGST", "Note value"],
          summary.cdnr.map((r) => [r.gstin, r.name, r.noteNumber, r.noteDate, r.invoiceNumber, r.invoiceDate, r.noteType, r.placeOfSupply, r.rate, rupees(r.taxable), rupees(r.cgst), rupees(r.sgst), rupees(r.igst), rupees(r.noteValue)]),
        );
      case "cdnur":
        return toCsv(
          ["Note number", "Note date", "Invoice", "Invoice date", "Note type", "UR type", "Place of supply", "Rate", "Taxable", "IGST", "Note value"],
          summary.cdnur.map((r) => [r.noteNumber, r.noteDate, r.invoiceNumber, r.invoiceDate, r.noteType, r.type, r.placeOfSupply, r.rate, rupees(r.taxable), rupees(r.igst), rupees(r.noteValue)]),
        );
      case "b2b":
        return toCsv(
          ["GSTIN", "Name", "Invoices", "Taxable", "CGST", "SGST", "IGST", "Total"],
          summary.b2b.map((r) => [r.gstin, r.name, r.invoices, rupees(r.taxable), rupees(r.cgst), rupees(r.sgst), rupees(r.igst), rupees(r.total)]),
        );
      case "b2cl":
        return toCsv(
          ["Place of supply", "Rate", "Taxable", "IGST"],
          summary.b2cl.map((r) => [r.placeOfSupply, r.rate, rupees(r.taxable), rupees(r.igst)]),
        );
      case "b2cs":
        return toCsv(
          ["Place of supply", "Rate", "Taxable", "CGST", "SGST", "IGST"],
          summary.b2cs.map((r) => [r.placeOfSupply, r.rate, rupees(r.taxable), rupees(r.cgst), rupees(r.sgst), rupees(r.igst)]),
        );
      default:
        return toCsv(
          ["HSN", "Description", "Unit", "Rate", "Quantity", "Taxable", "CGST", "SGST", "IGST", "Total"],
          summary.hsn.map((r) => [r.hsn, r.description, r.unit, r.rate, r.qty, rupees(r.taxable), rupees(r.cgst), rupees(r.sgst), rupees(r.igst), rupees(r.total)]),
        );
    }
  },

  payments: (items: readonly { date: string; number: string | null; customer: string; method: string; amount: number; reference: string | null; source: string }[]) =>
    toCsv(
      ["Date", "Invoice", "Customer", "Method", "Amount", "Reference", "Source"],
      items.map((i) => [i.date, i.number, i.customer, i.method, rupees(i.amount), i.reference, i.source]),
    ),

  ageing: (customers: readonly { name: string; current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number; total: number }[]) =>
    toCsv(
      ["Customer", "Current", "1-30 days", "31-60 days", "61-90 days", "90+ days", "Total"],
      customers.map((c) => [c.name, rupees(c.current), rupees(c.d1_30), rupees(c.d31_60), rupees(c.d61_90), rupees(c.d90_plus), rupees(c.total)]),
    ),

  trend: (items: readonly TrendPoint[]) =>
    toCsv(["Date", "Invoiced", "Collected", "Bills"], items.map((i) => [i.date, rupees(i.invoiced), rupees(i.collected), i.count])),

  topItems: (items: readonly { description: string; qty: number; unit: string; taxable: number }[]) =>
    toCsv(["Item", "Quantity", "Unit", "Taxable"], items.map((i) => [i.description, i.qty, i.unit, rupees(i.taxable)])),

  topCustomers: (items: readonly { name: string; invoices: number; total: number }[]) =>
    toCsv(["Customer", "Invoices", "Total"], items.map((i) => [i.name, i.invoices, rupees(i.total)])),

  ledger: (entries: readonly { date: string; type: string; number: string | null; description: string; debit: number; credit: number; balance: number }[]) =>
    toCsv(
      ["Date", "Type", "Invoice", "Description", "Debit", "Credit", "Balance"],
      entries.map((e) => [e.date, e.type, e.number, e.description, rupees(e.debit), rupees(e.credit), rupees(e.balance)]),
    ),

  creditNotes: (items: readonly { date: string; number: string; invoiceNumber: string; customerName: string; reason: string; refundMode: string; refundAmount: number; total: number; status: string }[]) =>
    toCsv(
      ["Date", "Credit note", "Against invoice", "Customer", "Reason", "Refund mode", "Refunded", "Total", "Status"],
      items.map((i) => [i.date, i.number, i.invoiceNumber, i.customerName, i.reason, i.refundMode, rupees(i.refundAmount), rupees(i.total), i.status]),
    ),

  creditBook: (items: readonly { customer: { name: string; phone: string | null }; balance: number; overdue: number; lastActivity: string | null }[]) =>
    toCsv(
      ["Customer", "Phone", "Balance", "Overdue", "Last activity"],
      items.map((i) => [i.customer.name, i.customer.phone, rupees(i.balance), rupees(i.overdue), i.lastActivity]),
    ),
};

import { badRequest, notFound } from "@rbms/core";
import { isValidGstin, normalizeGstin } from "@rbms/gst";
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { ItcDoc } from "./itc";
import { matchRows, normalizeNumber, parseGstr2bJson, parseGstr2bSheets, type BookDoc, type Parsed2b, type Row2b } from "./reco2b";
import { gst2bImports, gst2bRows, MATCH_ACTIONS, type Gst2bRowRow, type MatchStatus } from "./schema";
import type { GstFilingService } from "./service";
import { addMonths, isMonth, monthRange, rupeesText, toCsv, type Tax } from "./util";

const WINDOW_MONTHS = 12;

const taxSum = (t: Tax) => t.igst + t.cgst + t.sgst + t.cess;

const bookDoc = (d: ItcDoc): BookDoc => ({ key: d.key, docType: d.docType, docId: d.docId, gstin: d.gstin, party: d.party, number: d.number, date: d.date, taxable: d.taxable, tax: d.tax, total: d.total });

export const actionInput = z.object({ action: z.enum(MATCH_ACTIONS), note: z.string().trim().max(300).nullable().optional() });

export interface RowView {
  id: string;
  section: string;
  supplierGstin: string;
  supplierName: string | null;
  docKind: string;
  docNumber: string;
  docDate: string | null;
  docValue: number;
  itcAvailable: boolean;
  reverseCharge: boolean;
  reason: string | null;
  taxable: number;
  tax: Tax;
  /** The computed match. */
  status: MatchStatus;
  /** What the owner did on top (accept / ignore). */
  action: string | null;
  actionNote: string | null;
  match: { type: string; id: string; number: string | null; date: string | null; taxable: number; tax: Tax } | null;
  diff: Record<string, unknown>;
}

/** GSTR-2B import and reconciliation with the purchase bills and expenses (file based: nothing is fetched from the portal). */
export class Gstr2bService {
  constructor(private readonly svc: GstFilingService) {}

  private get db() {
    return this.svc.db;
  }

  /** Reads an uploaded JSON object or .xlsx workbook rows into rows, without saving anything. */
  parse(input: { json?: unknown; sheets?: Record<string, string[][]> }): Parsed2b {
    try {
      if (input.json !== undefined) return parseGstr2bJson(input.json);
      if (input.sheets) return parseGstr2bSheets(input.sheets);
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    throw badRequest("Upload the GSTR-2B JSON or Excel file downloaded from the GST portal");
  }

  async import(tenantId: string, userId: string | null, input: { parsed: Parsed2b; month?: string | null; filename?: string | null; format: "json" | "xlsx" }) {
    const month = input.parsed.month ?? input.month ?? null;
    if (!month || !isMonth(month)) throw badRequest("The file does not say which month it is for. Choose the month and upload again.");
    if (input.month && input.parsed.month && input.month !== input.parsed.month) throw badRequest(`This file is for ${input.parsed.month}, not ${input.month}`);
    const rows = input.parsed.rows.filter((r) => r.supplierGstin ? isValidGstin(r.supplierGstin) || r.section === "impg" : r.section === "impg");
    if (!rows.length) throw badRequest("No supplier documents were found in this file");
    const profile = await this.svc.sources.profile(tenantId);
    const ours = this.svc ? (await this.svc.getConfig(tenantId)).gstin ?? profile.gstin : profile.gstin;
    const warnings = [...input.parsed.warnings];
    if (ours && input.parsed.gstin && normalizeGstin(ours) !== normalizeGstin(input.parsed.gstin)) warnings.push(`This 2B is for GSTIN ${input.parsed.gstin}, the shop's is ${normalizeGstin(ours)}`);
    if (rows.length < input.parsed.rows.length) warnings.push(`${input.parsed.rows.length - rows.length} rows without a valid supplier GSTIN were skipped`);

    // Keep what the owner already decided for documents that appear again.
    const old = await this.db.select().from(gst2bRows).where(and(eq(gst2bRows.tenantId, tenantId), eq(gst2bRows.month, month)));
    const keep = new Map(old.filter((o) => o.action).map((o) => [rowKey(o.docKind, o.supplierGstin, o.docNumber), o]));
    await this.db.delete(gst2bRows).where(and(eq(gst2bRows.tenantId, tenantId), eq(gst2bRows.month, month)));
    await this.db.delete(gst2bImports).where(and(eq(gst2bImports.tenantId, tenantId), eq(gst2bImports.month, month)));
    const itc = rows.filter((r) => r.itcAvailable).reduce((s, r) => s + sign(r) * (r.igst + r.cgst + r.sgst + r.cess), 0);
    const [imp] = await this.db
      .insert(gst2bImports)
      .values({ tenantId, month, gstin: input.parsed.gstin, filename: input.filename ?? null, format: input.format, generatedOn: input.parsed.generatedOn, rowCount: rows.length, summary: { itcAvailable: itc, warnings }, importedBy: userId })
      .returning();
    for (let i = 0; i < rows.length; i += 500) {
      await this.db.insert(gst2bRows).values(
        rows.slice(i, i + 500).map((r) => {
          const k = keep.get(rowKey(r.docKind, r.supplierGstin, r.docNumber));
          return { tenantId, importId: imp!.id, month, ...r, action: k?.action ?? null, actionNote: k?.actionNote ?? null, actionBy: k?.actionBy ?? null, actionAt: k?.actionAt ?? null };
        }),
      );
    }
    const summary = await this.rematch(tenantId, month);
    return { importId: imp!.id, month, rows: rows.length, warnings, summary };
  }

  private async books(tenantId: string, month: string) {
    const range = { from: `${addMonths(month, -WINDOW_MONTHS)}-01`, to: monthRange(month).to };
    const { decisions } = await this.svc.decisions(tenantId, range, [month]);
    const docs: BookDoc[] = decisions
      .filter((d) => d.doc.docType !== "debit_note" && isValidGstin(d.doc.gstin))
      .map((d) => bookDoc(d.doc));
    const notes = (await this.svc.sources.purchaseReturns(tenantId, range)).filter((n) => n.status === "issued" && !n.imported && isValidGstin(n.supplierGstin));
    for (const n of notes) docs.push({ key: `debit_note:${n.id}`, docType: "debit_note", docId: n.id, gstin: normalizeGstin(n.supplierGstin!), party: n.supplierName, number: n.number, date: n.date, taxable: n.taxable, tax: { igst: n.igst, cgst: n.cgst, sgst: n.sgst, cess: 0 }, total: n.total });
    return { docs, decisions, range };
  }

  /** Matches the saved rows of a month with the books again (after bills were added). Owner actions stay. */
  async rematch(tenantId: string, month: string) {
    const rows = await this.db.select().from(gst2bRows).where(and(eq(gst2bRows.tenantId, tenantId), eq(gst2bRows.month, month))).orderBy(asc(gst2bRows.supplierGstin), asc(gst2bRows.docNumber));
    if (!rows.length) throw notFound("GSTR-2B import for this month");
    const { docs } = await this.books(tenantId, month);
    // Documents already matched by another month's 2B are not offered again.
    const taken = await this.db
      .select({ type: gst2bRows.matchedType, id: gst2bRows.matchedId })
      .from(gst2bRows)
      .where(and(eq(gst2bRows.tenantId, tenantId), ne(gst2bRows.month, month), isNotNull(gst2bRows.matchedId), inArray(gst2bRows.status, ["matched", "fuzzy"])));
    const takenKeys = new Set(taken.map((t) => `${t.type}:${t.id}`));
    const free = docs.filter((d) => !takenKeys.has(d.key));
    const src: Row2b[] = rows.map((r) => ({ section: r.section as Row2b["section"], supplierGstin: r.supplierGstin, supplierName: r.supplierName, docKind: r.docKind as Row2b["docKind"], docNumber: r.docNumber, docDate: r.docDate, docValue: r.docValue, pos: r.pos, reverseCharge: r.reverseCharge, itcAvailable: r.itcAvailable, reason: r.reason, taxable: r.taxable, igst: r.igst, cgst: r.cgst, sgst: r.sgst, cess: r.cess }));
    const { matches } = matchRows(src, free);
    for (const m of matches) {
      const row = rows[m.index]!;
      await this.db
        .update(gst2bRows)
        .set({ status: m.status, matchedType: m.doc?.docType ?? null, matchedId: (m.doc?.docId as string | undefined) ?? null, diff: m.diff as Record<string, unknown>, updatedAt: new Date() })
        .where(eq(gst2bRows.id, row.id));
    }
    return this.summary(tenantId, month);
  }

  private async viewRows(tenantId: string, month: string): Promise<{ rows: RowView[]; docs: Map<string, BookDoc>; raw: Gst2bRowRow[] }> {
    const raw = await this.db.select().from(gst2bRows).where(and(eq(gst2bRows.tenantId, tenantId), eq(gst2bRows.month, month))).orderBy(asc(gst2bRows.supplierGstin), asc(gst2bRows.docNumber));
    const { docs } = raw.length ? await this.books(tenantId, month) : { docs: [] as BookDoc[] };
    const byKey = new Map(docs.map((d) => [d.key, d]));
    const rows = raw.map((r): RowView => {
      const doc = r.matchedType && r.matchedId ? byKey.get(`${r.matchedType}:${r.matchedId}`) ?? null : null;
      return {
        id: r.id,
        section: r.section,
        supplierGstin: r.supplierGstin,
        supplierName: r.supplierName,
        docKind: r.docKind,
        docNumber: r.docNumber,
        docDate: r.docDate,
        docValue: r.docValue,
        itcAvailable: r.itcAvailable,
        reverseCharge: r.reverseCharge,
        reason: r.reason,
        taxable: r.taxable,
        tax: { igst: r.igst, cgst: r.cgst, sgst: r.sgst, cess: r.cess },
        status: r.status,
        action: r.action,
        actionNote: r.actionNote,
        match: doc ? { type: doc.docType, id: doc.docId, number: doc.number, date: doc.date, taxable: doc.taxable, tax: doc.tax } : null,
        diff: r.diff,
      };
    });
    return { rows, docs: byKey, raw };
  }

  /** Books documents whose credit is claimed in `month` but that no 2B row (this month's or another's) is matched to. */
  private async missingIn2b(tenantId: string, month: string, matchedKeys: Set<string>) {
    const { decisions } = await this.svc.decisions(tenantId, monthRange(month), [month]);
    const others = await this.db
      .select({ type: gst2bRows.matchedType, id: gst2bRows.matchedId })
      .from(gst2bRows)
      .where(and(eq(gst2bRows.tenantId, tenantId), isNotNull(gst2bRows.matchedId)));
    const all = new Set([...matchedKeys, ...others.map((o) => `${o.type}:${o.id}`)]);
    return decisions.filter((d) => d.claimMonth === month && d.status === "eligible" && !d.rcm && d.doc.docType !== "debit_note" && isValidGstin(d.doc.gstin) && taxSum(d.tax) > 0 && !all.has(d.key));
  }

  async summary(tenantId: string, month: string) {
    if (!isMonth(month)) throw badRequest("Use a month as YYYY-MM");
    const [imp] = await this.db.select().from(gst2bImports).where(and(eq(gst2bImports.tenantId, tenantId), eq(gst2bImports.month, month))).limit(1);
    if (!imp) return { month, imported: false as const };
    const { rows, docs } = await this.viewRows(tenantId, month);
    const counts: Record<string, number> = { matched: 0, fuzzy: 0, amount_mismatch: 0, missing_in_books: 0, accepted: 0, ignored: 0 };
    let tax2b = 0;
    let taxBooks = 0;
    let open = 0;
    for (const r of rows) {
      const eff = effective(r);
      counts[eff] = (counts[eff] ?? 0) + 1;
      const sgn = r.docKind === "inv" ? 1 : -1;
      if (r.itcAvailable) tax2b += sgn * taxSum(r.tax);
      if (r.match && (eff === "matched" || eff === "accepted" || eff === "fuzzy")) taxBooks += sgn * taxSum(r.match.tax);
      if (eff === "fuzzy" || eff === "amount_mismatch" || eff === "missing_in_books") open += 1;
    }
    const matchedKeys = new Set(rows.filter((r) => r.match).map((r) => `${r.match!.type}:${r.match!.id}`));
    const missing = await this.missingIn2b(tenantId, month, matchedKeys);
    const atRisk = missing.reduce((s, d) => s + taxSum(d.tax), 0);
    void docs;
    return {
      month,
      imported: true as const,
      import: { id: imp.id, filename: imp.filename, format: imp.format, gstin: imp.gstin, generatedOn: imp.generatedOn, rowCount: imp.rowCount, importedAt: imp.createdAt, summary: imp.summary },
      counts: { ...counts, missing_in_2b: missing.length } as Record<string, number>,
      open,
      tax2b,
      taxBooks,
      itcAtRisk: atRisk,
      missingIn2b: missing.slice(0, 200).map((d) => ({ docType: d.doc.docType, docId: d.doc.docId, number: d.doc.number, date: d.doc.date, party: d.doc.party, gstin: d.doc.gstin, taxable: d.doc.taxable, tax: d.tax })),
    };
  }

  async list(tenantId: string, month: string, q: { status?: string; q?: string; supplier?: string; limit?: number; offset?: number }) {
    const { rows } = await this.viewRows(tenantId, month);
    let out = rows;
    if (q.status) {
      const want = new Set(q.status.split(","));
      out = out.filter((r) => want.has(effective(r)));
    }
    if (q.supplier) out = out.filter((r) => r.supplierGstin === normalizeGstin(q.supplier!));
    if (q.q?.trim()) {
      const n = q.q.trim().toLowerCase();
      out = out.filter((r) => `${r.docNumber} ${r.supplierName ?? ""} ${r.supplierGstin}`.toLowerCase().includes(n));
    }
    const facets: Record<string, number> = {};
    for (const r of rows) facets[effective(r)] = (facets[effective(r)] ?? 0) + 1;
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 500);
    const offset = Math.max(q.offset ?? 0, 0);
    return { items: out.slice(offset, offset + limit), total: out.length, limit, offset, facets: { status: facets } };
  }

  /** Supplier-wise totals: what the portal shows, what the books have, the difference. */
  async suppliers(tenantId: string, month: string) {
    const { rows } = await this.viewRows(tenantId, month);
    const by = new Map<string, { gstin: string; name: string | null; docs: number; tax2b: number; taxBooks: number; matched: number; open: number; missingInBooks: number }>();
    for (const r of rows) {
      const s = by.get(r.supplierGstin) ?? { gstin: r.supplierGstin, name: r.supplierName, docs: 0, tax2b: 0, taxBooks: 0, matched: 0, open: 0, missingInBooks: 0 };
      const sgn = r.docKind === "inv" ? 1 : -1;
      const eff = effective(r);
      s.docs += 1;
      if (r.itcAvailable) s.tax2b += sgn * taxSum(r.tax);
      if (r.match) s.taxBooks += sgn * taxSum(r.match.tax);
      if (eff === "matched" || eff === "accepted") s.matched += 1;
      else if (eff !== "ignored") s.open += 1;
      if (eff === "missing_in_books") s.missingInBooks += 1;
      by.set(r.supplierGstin, s);
    }
    const items = [...by.values()].map((s) => ({ ...s, diff: s.tax2b - s.taxBooks })).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.gstin.localeCompare(b.gstin));
    return { items };
  }

  async act(tenantId: string, userId: string | null, rowId: string, raw: unknown) {
    const { action, note } = actionInput.parse(raw ?? {});
    const [row] = await this.db.select().from(gst2bRows).where(and(eq(gst2bRows.tenantId, tenantId), eq(gst2bRows.id, rowId))).limit(1);
    if (!row) throw notFound("GSTR-2B row");
    const set =
      action === "reopen"
        ? { action: null, actionNote: null, actionBy: userId, actionAt: new Date() }
        : { action, actionNote: note ?? null, actionBy: userId, actionAt: new Date() };
    await this.db.update(gst2bRows).set({ ...set, updatedAt: new Date() }).where(eq(gst2bRows.id, rowId));
    return { ok: true, action: set.action };
  }

  async imports(tenantId: string) {
    const rows = await this.db.select().from(gst2bImports).where(eq(gst2bImports.tenantId, tenantId)).orderBy(desc(gst2bImports.month)).limit(60);
    return { items: rows.map((r) => ({ id: r.id, month: r.month, filename: r.filename, format: r.format, rowCount: r.rowCount, importedAt: r.createdAt })) };
  }

  async remove(tenantId: string, month: string) {
    await this.db.delete(gst2bRows).where(and(eq(gst2bRows.tenantId, tenantId), eq(gst2bRows.month, month)));
    await this.db.delete(gst2bImports).where(and(eq(gst2bImports.tenantId, tenantId), eq(gst2bImports.month, month)));
    return { ok: true };
  }

  async csv(tenantId: string, month: string, kind: "rows" | "suppliers"): Promise<string> {
    if (kind === "suppliers") {
      const { items } = await this.suppliers(tenantId, month);
      return toCsv(["Supplier GSTIN", "Supplier", "Documents", "Tax in GSTR-2B", "Tax in books", "Difference", "Matched", "Open", "Missing in books"], items.map((s) => [s.gstin, s.name ?? "", s.docs, rupeesText(s.tax2b), rupeesText(s.taxBooks), rupeesText(s.diff), s.matched, s.open, s.missingInBooks]));
    }
    const { rows } = await this.viewRows(tenantId, month);
    const summary = await this.summary(tenantId, month);
    const missing = summary.imported ? summary.missingIn2b : [];
    return toCsv(
      ["Result", "Supplier GSTIN", "Supplier", "Document", "Date", "Taxable (2B)", "Tax (2B)", "ITC available per 2B", "Matched with", "Taxable (books)", "Tax (books)", "Differences", "Action", "Note"],
      [
        ...rows.map((r) => [effective(r), r.supplierGstin, r.supplierName ?? "", r.docNumber, r.docDate ?? "", rupeesText(r.taxable), rupeesText(taxSum(r.tax)), r.itcAvailable ? "Yes" : `No ${r.reason ?? ""}`.trim(), r.match?.number ?? "", r.match ? rupeesText(r.match.taxable) : "", r.match ? rupeesText(taxSum(r.match.tax)) : "", Object.keys(r.diff).join(" "), r.action ?? "", r.actionNote ?? ""]),
        ...missing.map((m) => ["missing_in_2b", m.gstin ?? "", m.party, m.number, m.date, "", "", "", m.number, rupeesText(m.taxable), rupeesText(taxSum(m.tax)), "", "", ""]),
      ],
    );
  }
}

const sign = (r: Row2b) => (r.docKind === "inv" ? 1 : -1);
const rowKey = (kind: string, gstin: string, number: string) => `${kind}|${gstin}|${normalizeNumber(number)}`;
export const effective = (r: Pick<RowView, "status" | "action">): MatchStatus => (r.action === "accept" ? "accepted" : r.action === "ignore" ? "ignored" : r.status);
void sql;

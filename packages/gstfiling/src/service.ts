import { badRequest, notFound } from "@rbms/core";
import type { Db } from "@rbms/db";
import { isValidGstin, normalizeGstin, stateFromGstin, todayIST } from "@rbms/gst";
import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { filingCalendar, type DueItem } from "./calendar";
import { buildCmp08, buildGstr4, COMPOSITION_LIMITS, quartersOfFy, type CompositionQuarter, type Gstr4Annual } from "./composition";
import { DEFAULT_CONFIG, compositionOn, settingsPatch, type GstConfig, type SettingsPatch } from "./config";
import { buildAdvances, buildDocIssue, buildExp, buildNil, validateGstr1, type Gstr1Issue } from "./gstr1x";
import { buildGstr3b, CELLS, CELL_LABELS, gstr3bJson, type CellId, type Contribution, type Gstr3bResult, type ReturnSrc } from "./gstr3b";
import {
  decideItc,
  expenseDoc,
  purchaseDoc,
  returnDoc,
  rule37Candidates,
  type DocFlagSrc,
  type ItcDecision,
  type ItcDoc,
} from "./itc";
import {
  noopLogger,
  type ExpenseSrc,
  type Gstr1BasePort,
  type GstSourcesPort,
  type LedgerPort,
  type LoggerPort,
  type PurchaseSrc,
  type SalesDocSrc,
  type ShopProfile,
} from "./ports";
import {
  ADJUSTMENT_KINDS,
  ADVANCE_KINDS,
  FLAG_DOC_TYPES,
  ITC_CLASSES,
  ITC_STATUSES,
  REVERSAL_REASONS,
  RETURN_TYPES,
  TAX_PAYMENT_KINDS,
  gstAdjustments,
  gstAdvances,
  gstDocFlags,
  gstFilings,
  gstSettings,
  gstTaxPayments,
  type FlagDocType,
  type GstDocFlagRow,
} from "./schema";
import {
  addMonths,
  fyStartYear,
  isMonth,
  monthOf,
  monthRange,
  parseQuarter,
  quarterOfMonth,
  toCsv,
  fyLabel,
  fyRange,
  rupeesText,
  toFp,
  totalTax,
  type Tax,
} from "./util";

export interface GstFilingDeps {
  db: Db;
  sources: GstSourcesPort;
  gstr1: Gstr1BasePort;
  ledger?: LedgerPort;
  log?: LoggerPort;
  now?: () => Date;
}

/** A return period: one month, or a quarter (QRMP and composition). */
export interface PeriodRef {
  key: string;
  kind: "month" | "quarter";
  /** The return month (a quarter's last). */
  month: string;
  months: string[];
  from: string;
  to: string;
}

export function parsePeriod(key: string): PeriodRef {
  if (isMonth(key)) {
    const r = monthRange(key);
    return { key, kind: "month", month: key, months: [key], ...r };
  }
  const q = parseQuarter(key);
  if (q) return { key, kind: "quarter", month: q.months[2], months: [...q.months], from: q.from, to: q.to };
  throw badRequest("Use a month as YYYY-MM or a quarter as YYYY-Qn (Q1 = April to June)");
}

const date = z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date as YYYY-MM-DD").nullable().optional());
const monthStr = z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use a month as YYYY-MM").nullable().optional());
const paise = z.number().int().min(0).max(1e13);

export const flagPatch = z.object({
  itcStatus: z.enum(ITC_STATUSES).nullable().optional(),
  itcClass: z.enum(ITC_CLASSES).nullable().optional(),
  reversalReason: z.enum(REVERSAL_REASONS).nullable().optional(),
  reason: z.string().trim().max(300).nullable().optional(),
  claimMonth: monthStr,
  reversalMonth: monthStr,
  rcm: z.boolean().optional(),
  rcmCategory: z.string().trim().max(60).nullable().optional(),
  rcmRate: z.number().min(0).max(100).nullable().optional(),
  rcmTaxable: paise.nullable().optional(),
  rcmImport: z.boolean().optional(),
  rcmPaidOn: date,
  rcmPaidAmount: paise.nullable().optional(),
  rcmChallan: z.string().trim().max(60).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  /** Remove the owner's decision: the defaults apply again. */
  reset: z.boolean().optional(),
});
export type FlagPatch = z.infer<typeof flagPatch>;

export const adjustmentInput = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  kind: z.enum(ADJUSTMENT_KINDS),
  taxable: z.number().int().min(-1e13).max(1e13).default(0),
  igst: z.number().int().min(-1e13).max(1e13).default(0),
  cgst: z.number().int().min(-1e13).max(1e13).default(0),
  sgst: z.number().int().min(-1e13).max(1e13).default(0),
  cess: z.number().int().min(-1e13).max(1e13).default(0),
  note: z.string().trim().max(300).nullable().optional(),
});

export const advanceInput = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  kind: z.enum(ADVANCE_KINDS),
  pos: z.string().regex(/^\d{2}$/),
  rate: z.number().min(0).max(100),
  amount: z.number().int().min(1).max(1e13),
  cess: z.number().int().min(0).max(1e13).default(0),
  note: z.string().trim().max(300).nullable().optional(),
});

export const taxPaymentInput = z.object({
  kind: z.enum(TAX_PAYMENT_KINDS),
  period: z.string().regex(/^(\d{4}-(0[1-9]|1[0-2])|\d{4}-Q[1-4])$/),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  igst: paise.default(0),
  cgst: paise.default(0),
  sgst: paise.default(0),
  cess: paise.default(0),
  interest: paise.default(0),
  lateFee: paise.default(0),
  method: z.enum(["bank", "cash", "upi", "cheque", "other"]).default("bank"),
  challan: z.string().trim().max(60).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
});

export const filingInput = z.object({
  returnType: z.enum(RETURN_TYPES),
  period: z.string().regex(/^(\d{4}-(0[1-9]|1[0-2])|\d{4}-Q[1-4]|FY\d{4}-\d{2})$/),
  filedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  arn: z.string().trim().max(40).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
});

const toSrc = (r: GstDocFlagRow): DocFlagSrc => ({
  docType: r.docType,
  docId: r.docId,
  itcStatus: r.itcStatus,
  itcClass: r.itcClass,
  reversalReason: r.reversalReason,
  reason: r.reason,
  claimMonth: r.claimMonth,
  reversalMonth: r.reversalMonth,
  rcm: r.rcm,
  rcmCategory: r.rcmCategory,
  rcmRate: r.rcmRate,
  rcmTaxable: r.rcmTaxable,
  rcmImport: r.rcmImport,
  rcmPaidOn: r.rcmPaidOn,
  rcmPaidAmount: r.rcmPaidAmount,
  rcmChallan: r.rcmChallan,
  note: r.note,
});

export type IssueSeverity = "error" | "warning" | "info";
/** One line of the "fix before filing" list. The UI translates `code` and fills `params`. */
export interface FilingIssue {
  id: string;
  severity: IssueSeverity;
  area: "profile" | "gstr1" | "gstr3b" | "itc" | "gstr2b" | "rcm" | "composition" | "calendar";
  code: string;
  params?: Record<string, string | number>;
  /** Where to go: tab and optional month / filter. */
  link?: { tab: "gstr1" | "gstr3b" | "itc" | "gstr2b" | "rcm" | "composition" | "settings" | "calendar"; period?: string; filter?: string };
  count?: number;
}

export interface ItcRegisterRow {
  key: string;
  docType: ItcDoc["docType"];
  docId: string;
  number: string;
  date: string;
  party: string;
  gstin: string | null;
  taxable: number;
  tax: Tax;
  total: number;
  status: ItcDecision["status"];
  reason: ItcDecision["reason"];
  source: ItcDecision["source"];
  class: ItcDecision["class"];
  claimMonth: string | null;
  lapsed: boolean;
  rcm: ItcDecision["rcm"];
  flag: DocFlagSrc | null;
}

const rowOf = (d: ItcDecision): ItcRegisterRow => ({
  key: d.key,
  docType: d.doc.docType,
  docId: d.doc.docId,
  number: d.doc.number,
  date: d.doc.date,
  party: d.doc.party,
  gstin: d.doc.gstin,
  taxable: d.doc.taxable,
  tax: d.tax,
  total: d.doc.total,
  status: d.status,
  reason: d.reason,
  source: d.source,
  class: d.class,
  claimMonth: d.claimMonth,
  lapsed: d.lapsed,
  rcm: d.rcm,
  flag: d.doc.flag,
});

export class GstFilingService {
  readonly db: Db;
  readonly sources: GstSourcesPort;
  private readonly gstr1Base: Gstr1BasePort;
  private readonly ledger?: LedgerPort;
  readonly log: LoggerPort;
  private readonly now: () => Date;
  private configCache = new Map<string, { at: number; config: GstConfig }>();

  constructor(deps: GstFilingDeps) {
    this.db = deps.db;
    this.sources = deps.sources;
    this.gstr1Base = deps.gstr1;
    this.ledger = deps.ledger;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  today() {
    return todayIST(this.now());
  }

  // ---------------------------------------------------------------- settings

  async getConfig(tenantId: string): Promise<GstConfig> {
    const hit = this.configCache.get(tenantId);
    if (hit && Date.now() - hit.at < 20_000) return hit.config;
    const [row] = await this.db.select().from(gstSettings).where(eq(gstSettings.tenantId, tenantId)).limit(1);
    const config: GstConfig = row
      ? {
          composition: row.composition,
          compositionFrom: row.compositionFrom,
          compositionType: row.compositionType,
          qrmp: row.qrmp,
          qrmpFrom: row.qrmpFrom,
          rcmCategories: row.rcmCategories,
          zeroRateClass: row.zeroRateClass,
          zeroRateRules: row.zeroRateRules,
          gstin: row.gstin,
          priorTurnover: row.priorTurnover,
        }
      : { ...DEFAULT_CONFIG };
    this.configCache.set(tenantId, { at: Date.now(), config });
    return config;
  }

  async saveConfig(tenantId: string, raw: unknown): Promise<GstConfig> {
    const patch: SettingsPatch = settingsPatch.parse(raw ?? {});
    const cur = await this.getConfig(tenantId);
    const next: GstConfig = {
      ...cur,
      ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    } as GstConfig;
    if (next.composition && !next.compositionFrom) next.compositionFrom = this.today();
    if (next.qrmp && !next.qrmpFrom) next.qrmpFrom = `${quarterOfMonth(this.today().slice(0, 7)).from}`;
    const values = {
      composition: next.composition,
      compositionFrom: next.compositionFrom,
      compositionType: next.compositionType,
      qrmp: next.qrmp,
      qrmpFrom: next.qrmpFrom,
      rcmCategories: next.rcmCategories,
      zeroRateClass: next.zeroRateClass,
      zeroRateRules: next.zeroRateRules,
      gstin: next.gstin,
      priorTurnover: next.priorTurnover,
    };
    await this.db
      .insert(gstSettings)
      .values({ tenantId, ...values })
      .onConflictDoUpdate({ target: gstSettings.tenantId, set: { ...values, updatedAt: new Date() } });
    this.configCache.delete(tenantId);
    return this.getConfig(tenantId);
  }

  /**
   * What switching to composition from `from` would meet: bills already issued on or after that date that carry tax.
   * They stay exactly as issued (the switch only changes new bills); they are listed so the owner can decide on the date.
   */
  async compositionPreview(tenantId: string, from: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw badRequest("Use a date as YYYY-MM-DD");
    const today = this.today();
    if (from > today) return { from, taxedBills: 0, taxedTotal: 0, bills: 0 };
    const sales = await this.sources.sales(tenantId, { from, to: today });
    let taxed = 0;
    let taxedTotal = 0;
    let bills = 0;
    for (const d of sales) {
      if (!d.number || d.status === "draft" || d.status === "cancelled" || (d.docType && d.docType !== "INV")) continue;
      bills += 1;
      const t = d.totals.cgst + d.totals.sgst + d.totals.igst;
      if (t > 0) {
        taxed += 1;
        taxedTotal += t;
      }
    }
    return { from, taxedBills: taxed, taxedTotal, bills };
  }

  /** What the invoice engine needs for a bill dated `date`: the tax scheme of the shop. */
  async schemeFor(tenantId: string): Promise<{ taxScheme: "regular" | "composition"; compositionFrom: string | null }> {
    const c = await this.getConfig(tenantId);
    return { taxScheme: c.composition ? "composition" : "regular", compositionFrom: c.composition ? c.compositionFrom : null };
  }

  // ---------------------------------------------------------------- flags and decisions

  private async allFlags(tenantId: string): Promise<GstDocFlagRow[]> {
    return this.db.select().from(gstDocFlags).where(eq(gstDocFlags.tenantId, tenantId)).limit(50_000);
  }

  /**
   * The credit decision of every purchase bill and expense dated in the range, plus the documents outside the range that
   * the owner flagged to be claimed or reversed in one of `months`.
   */
  async decisions(tenantId: string, range: { from: string; to: string }, months: string[] = []): Promise<{ decisions: ItcDecision[]; config: GstConfig; profile: ShopProfile }> {
    const [config, profile, flags] = await Promise.all([this.getConfig(tenantId), this.sources.profile(tenantId), this.allFlags(tenantId)]);
    const flagBy = new Map(flags.map((f) => [`${f.docType}:${f.docId}`, toSrc(f)]));
    const [purchases, expenses] = await Promise.all([this.sources.purchases(tenantId, range), this.sources.expenses(tenantId, range)]);
    const seen = new Set<string>();
    const decisions: ItcDecision[] = [];
    const ctx = { compositionOn: (d: string) => compositionOn(config, d), shopState: profile.stateCode ?? stateFromGstin(profile.gstin) };
    const add = (doc: ItcDoc) => {
      if (seen.has(doc.key)) return;
      seen.add(doc.key);
      decisions.push(decideItc(doc, ctx));
    };
    for (const p of purchases) if (p.status === "recorded" && !p.imported) add(purchaseDoc(p, flagBy.get(`purchase:${p.id}`) ?? null));
    for (const e of expenses) if (e.status === "recorded") add(expenseDoc(e, ctx.shopState, flagBy.get(`expense:${e.id}`) ?? null));
    // Flagged documents from other dates that land in these months.
    if (months.length) {
      const inMonths = (m: string | null) => !!m && months.includes(m);
      const extra = flags.filter(
        (f) =>
          !seen.has(`${f.docType}:${f.docId}`) &&
          (inMonths(f.claimMonth) || inMonths(f.reversalMonth) || (f.rcmPaidOn && inMonths(monthOf(f.rcmPaidOn)))),
      );
      const pIds = extra.filter((f) => f.docType === "purchase").map((f) => f.docId);
      const eIds = extra.filter((f) => f.docType === "expense").map((f) => f.docId);
      const [ps, es] = await Promise.all([
        pIds.length && this.sources.purchasesByIds ? this.sources.purchasesByIds(tenantId, pIds) : Promise.resolve([] as PurchaseSrc[]),
        eIds.length && this.sources.expensesByIds ? this.sources.expensesByIds(tenantId, eIds) : Promise.resolve([] as ExpenseSrc[]),
      ]);
      for (const p of ps) if (p.status === "recorded" && !p.imported) add(purchaseDoc(p, flagBy.get(`purchase:${p.id}`) ?? null));
      for (const e of es) if (e.status === "recorded") add(expenseDoc(e, ctx.shopState, flagBy.get(`expense:${e.id}`) ?? null));
    }
    return { decisions, config, profile };
  }

  private async returnsFor(tenantId: string, range: { from: string; to: string }, config: GstConfig, shopState: string | null): Promise<ReturnSrc[]> {
    const notes = (await this.sources.purchaseReturns(tenantId, range)).filter((n) => n.status === "issued" && !n.imported);
    if (!notes.length) return [];
    const ids = [...new Set(notes.map((n) => n.purchaseId))];
    const bills = this.sources.purchasesByIds ? await this.sources.purchasesByIds(tenantId, ids) : [];
    const flags = await this.db.select().from(gstDocFlags).where(and(eq(gstDocFlags.tenantId, tenantId), eq(gstDocFlags.docType, "purchase"), inArray(gstDocFlags.docId, ids)));
    const flagBy = new Map(flags.map((f) => [f.docId, toSrc(f)]));
    const ctx = { compositionOn: (d: string) => compositionOn(config, d), shopState };
    const claimed = new Map(bills.map((b) => [b.id, decideItc(purchaseDoc(b, flagBy.get(b.id) ?? null), ctx)]));
    return notes.map((n) => {
      const dec = claimed.get(n.purchaseId);
      return { doc: returnDoc(n), claimed: !!dec && (dec.status === "eligible" || dec.status === "reversal") && !dec.rcm && !dec.lapsed };
    });
  }

  // ---------------------------------------------------------------- GSTR-3B

  async gstr3bBuild(tenantId: string, key: string): Promise<{ result: Gstr3bResult; period: PeriodRef; config: GstConfig; profile: ShopProfile; decisions: ItcDecision[]; sales: SalesDocSrc[] }> {
    const period = parsePeriod(key);
    const { decisions, config, profile } = await this.decisions(tenantId, period, period.months);
    const shopState = profile.stateCode ?? stateFromGstin(profile.gstin);
    const [sales, purchases, returns, adjustments] = await Promise.all([
      this.sources.sales(tenantId, period),
      this.sources.purchases(tenantId, period),
      this.returnsFor(tenantId, period, config, shopState),
      this.db.select().from(gstAdjustments).where(and(eq(gstAdjustments.tenantId, tenantId), inArray(gstAdjustments.month, period.months))),
    ]);
    const gstin = config.gstin ?? profile.gstin ?? "";
    const result = buildGstr3b({
      month: period.month,
      months: period.months,
      gstin,
      shopState,
      config,
      sales,
      decisions,
      purchases: purchases.filter((p) => p.status === "recorded" && !p.imported),
      returns,
      adjustments,
    });
    return { result, period, config, profile, decisions, sales };
  }

  /** GSTR-3B summary for a month or quarter, the portal JSON, the checks and the comparison with the books' GST ledger. */
  async gstr3b(tenantId: string, key: string) {
    const { result, period, config, profile, decisions } = await this.gstr3bBuild(tenantId, key);
    const { contributions: _c, ...summary } = result;
    const gstin = result.gstin;
    const warnings: string[] = [];
    if (!gstin) warnings.push("no_gstin");
    else if (!isValidGstin(gstin)) warnings.push("invalid_gstin");
    if (!result.applicable) warnings.push("composition");
    const lapsed = decisions.filter((d) => d.lapsedMonth && period.months.includes(d.lapsedMonth)).length;
    if (lapsed) warnings.push("lapsed_16_4");
    return {
      period: { key: period.key, kind: period.kind, months: period.months, from: period.from, to: period.to },
      ...summary,
      json: gstr3bJson(result),
      filename: `GSTR3B_${gstin || "GSTIN"}_${result.fp}.json`,
      qrmp: config.qrmp,
      warnings,
      ledger: await this.ledgerCompare(tenantId, period, result),
      shopState: profile.stateCode,
    };
  }

  async gstr3bCell(tenantId: string, key: string, cell: string, limit = 500): Promise<{ cell: CellId; label: string; total: Contribution; items: Contribution[]; truncated: boolean }> {
    if (!(CELLS as readonly string[]).includes(cell)) throw badRequest(`Unknown GSTR-3B cell: ${cell}`);
    const { result } = await this.gstr3bBuild(tenantId, key);
    const rows = result.contributions.filter((c) => c.cell === cell);
    const total: Contribution = { cell: cell as CellId, docType: "adjustment", docId: "", number: "", date: "", party: "", taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    for (const r of rows) {
      total.taxable += r.taxable;
      total.igst += r.igst;
      total.cgst += r.cgst;
      total.sgst += r.sgst;
      total.cess += r.cess;
    }
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
    return { cell: cell as CellId, label: CELL_LABELS[cell as CellId], total, items: rows.slice(0, limit), truncated: rows.length > limit };
  }

  gstr3bCsv(r: Awaited<ReturnType<GstFilingService["gstr3b"]>>): string {
    const rows = CELLS.map((id) => {
      const c = r.cells[id];
      return [CELL_LABELS[id], rupeesText(c.taxable), rupeesText(c.igst), rupeesText(c.cgst), rupeesText(c.sgst), rupeesText(c.cess)];
    });
    rows.push(["Net ITC 4(C)", "", rupeesText(r.itcNet.igst), rupeesText(r.itcNet.cgst), rupeesText(r.itcNet.sgst), rupeesText(r.itcNet.cess)]);
    rows.push(["Cash to pay (after credit)", "", rupeesText(r.setOff.cash.igst), rupeesText(r.setOff.cash.cgst), rupeesText(r.setOff.cash.sgst), rupeesText(r.setOff.cash.cess)]);
    return toCsv(["Table", "Taxable value", "Integrated tax", "Central tax", "State/UT tax", "Cess"], rows);
  }

  private async ledgerCompare(tenantId: string, period: PeriodRef, result: Gstr3bResult) {
    if (!this.ledger || !(await this.ledger.isEnabled(tenantId).catch(() => false))) return null;
    const books = await this.ledger.gstLedger(tenantId, period).catch(() => null);
    if (!books) return null;
    const grossItc: Tax = { igst: 0, cgst: 0, sgst: 0, cess: 0 };
    for (const id of ["4A1", "4A2", "4A3", "4A4", "4A5"] as const) {
      grossItc.igst += result.cells[id].igst;
      grossItc.cgst += result.cells[id].cgst;
      grossItc.sgst += result.cells[id].sgst;
    }
    const diff = (a: Tax, b: Tax) => ({ igst: a.igst - b.igst, cgst: a.cgst - b.cgst, sgst: a.sgst - b.sgst, cess: a.cess - b.cess });
    return {
      books,
      returnOutput: result.outputTax,
      returnItc: grossItc,
      outputDiff: diff(books.output, result.outputTax),
      itcDiff: diff(books.input, grossItc),
    };
  }

  // ---------------------------------------------------------------- ITC register, flags, RCM

  async itcRegister(
    tenantId: string,
    q: { from?: string; to?: string; month?: string; status?: string; docType?: string; q?: string; rcm?: string; limit?: number; offset?: number },
  ) {
    const month = q.month && isMonth(q.month) ? q.month : undefined;
    const range = month ? monthRange(month) : { from: q.from ?? addMonths(this.today().slice(0, 7), -2) + "-01", to: q.to ?? monthRange(this.today().slice(0, 7)).to };
    const { decisions } = await this.decisions(tenantId, range, month ? [month] : []);
    const needle = q.q?.trim().toLowerCase();
    const wanted = q.status ? new Set(q.status.split(",")) : null;
    let rows = decisions.map(rowOf).filter((r) => (r.docType === "expense" ? r.tax.igst + r.tax.cgst + r.tax.sgst > 0 || !!r.rcm || !!r.flag : true));
    if (q.docType) rows = rows.filter((r) => r.docType === q.docType);
    if (q.rcm === "1" || q.rcm === "true") rows = rows.filter((r) => !!r.rcm);
    const totals = new Map<string, { count: number; tax: number }>();
    for (const r of rows) {
      const t = totals.get(r.status) ?? { count: 0, tax: 0 };
      t.count += 1;
      t.tax += r.tax.igst + r.tax.cgst + r.tax.sgst + r.tax.cess;
      totals.set(r.status, t);
    }
    if (wanted) rows = rows.filter((r) => wanted.has(r.status));
    if (needle) rows = rows.filter((r) => `${r.number} ${r.party} ${r.gstin ?? ""}`.toLowerCase().includes(needle));
    rows.sort((a, b) => b.date.localeCompare(a.date) || a.number.localeCompare(b.number));
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 500);
    const offset = Math.max(q.offset ?? 0, 0);
    const [stock37] = [rule37Candidates(decisions, this.today())];
    return {
      items: rows.slice(offset, offset + limit),
      total: rows.length,
      limit,
      offset,
      facets: { status: Object.fromEntries([...totals].map(([k, v]) => [k, v.count])) },
      totals: Object.fromEntries(totals),
      range,
      rule37: stock37.map((c) => ({ key: c.decision.key, docId: c.decision.doc.docId, number: c.decision.doc.number, party: c.decision.doc.party, date: c.decision.doc.date, days: c.days, unpaid: c.unpaid, credit: c.credit })),
    };
  }

  itcRegisterCsv(items: ItcRegisterRow[]): string {
    return toCsv(
      ["Type", "Number", "Date", "Supplier", "GSTIN", "Taxable value", "IGST", "CGST", "SGST", "Cess", "Credit status", "Why", "Claim month", "Reverse charge tax", "RCM paid on"],
      items.map((r) => [r.docType, r.number, r.date, r.party, r.gstin ?? "", rupeesText(r.taxable), rupeesText(r.tax.igst), rupeesText(r.tax.cgst), rupeesText(r.tax.sgst), rupeesText(r.tax.cess), r.status, r.reason, r.claimMonth ?? "", r.rcm ? rupeesText(r.rcm.due) : "", r.rcm?.paidOn ?? ""]),
    );
  }

  /** Saves the owner's decision about one purchase bill or expense. */
  async setFlag(tenantId: string, userId: string | null, docType: string, docId: string, raw: unknown) {
    if (!(FLAG_DOC_TYPES as readonly string[]).includes(docType)) throw badRequest("Document type must be purchase or expense");
    const type = docType as FlagDocType;
    const patch = flagPatch.parse(raw ?? {});
    // The document must exist in this shop.
    const found =
      type === "purchase"
        ? this.sources.purchasesByIds
          ? (await this.sources.purchasesByIds(tenantId, [docId])).length
          : 1
        : this.sources.expensesByIds
          ? (await this.sources.expensesByIds(tenantId, [docId])).length
          : 1;
    if (!found) throw notFound(type === "purchase" ? "Purchase bill" : "Expense");
    if (patch.reset) {
      await this.db.delete(gstDocFlags).where(and(eq(gstDocFlags.tenantId, tenantId), eq(gstDocFlags.docType, type), eq(gstDocFlags.docId, docId)));
      return { flag: null };
    }
    const { reset: _r, ...fields } = patch;
    const values = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    if (values.rcm === false) Object.assign(values, { rcmCategory: null, rcmRate: null, rcmTaxable: null, rcmImport: false, rcmPaidOn: null, rcmPaidAmount: null, rcmChallan: null });
    if (values.itcStatus === "reversal" && !values.reversalReason) {
      // fine: defaults to "other"
    }
    const [row] = await this.db
      .insert(gstDocFlags)
      .values({ tenantId, docType: type, docId, ...values, updatedBy: userId })
      .onConflictDoUpdate({ target: [gstDocFlags.tenantId, gstDocFlags.docType, gstDocFlags.docId], set: { ...values, updatedBy: userId, updatedAt: new Date() } })
      .returning();
    return { flag: row ? toSrc(row) : null };
  }

  /** Reverse-charge register for a range: what is due, what is paid, and documents that look like reverse charge but are not flagged. */
  async rcmRegister(tenantId: string, q: { from?: string; to?: string }) {
    const range = { from: q.from ?? `${fyStartYear(this.today())}-04-01`, to: q.to ?? this.today() };
    const { decisions, config } = await this.decisions(tenantId, range, []);
    const rcm = decisions.filter((d) => d.rcm).map(rowOf);
    const due: Tax = { igst: 0, cgst: 0, sgst: 0, cess: 0 };
    let paid = 0;
    let dueTotal = 0;
    for (const r of rcm) {
      due.igst += r.rcm!.tax.igst;
      due.cgst += r.rcm!.tax.cgst;
      due.sgst += r.rcm!.tax.sgst;
      dueTotal += r.rcm!.due;
      if (r.rcm!.paid) paid += r.rcm!.paidAmount ?? r.rcm!.due;
    }
    const keywords: [RegExp, string][] = [
      [/transport|freight|lorry|cartage|courier|logistic/i, "gta"],
      [/legal|advocate|lawyer/i, "legal"],
      [/security|watchman/i, "security"],
      [/sponsor/i, "sponsorship"],
      [/director/i, "director"],
      [/rent/i, "rent_residential"],
    ];
    const suggestions = decisions
      .filter((d) => d.doc.docType === "expense" && !d.doc.flag?.rcm && d.tax.igst + d.tax.cgst + d.tax.sgst === 0 && !isValidGstin(d.doc.gstin))
      .flatMap((d) => {
        const hit = keywords.find(([re]) => re.test(d.doc.number) || re.test(d.doc.party));
        return hit ? [{ ...rowOf(d), suggestedCategory: hit[1] }] : [];
      })
      .slice(0, 100);
    return { items: rcm.sort((a, b) => b.date.localeCompare(a.date)), due, dueTotal, paid, unpaid: Math.max(dueTotal - paid, 0), suggestions, categories: config.rcmCategories, range };
  }

  // ---------------------------------------------------------------- adjustments, advances, payments, filings

  async listAdjustments(tenantId: string, month?: string) {
    const rows = await this.db.select().from(gstAdjustments).where(and(eq(gstAdjustments.tenantId, tenantId), month ? eq(gstAdjustments.month, month) : undefined)).orderBy(desc(gstAdjustments.month), desc(gstAdjustments.createdAt)).limit(500);
    return { items: rows };
  }
  async addAdjustment(tenantId: string, userId: string | null, raw: unknown) {
    const v = adjustmentInput.parse(raw);
    const [row] = await this.db.insert(gstAdjustments).values({ tenantId, ...v, note: v.note ?? null, createdBy: userId }).returning();
    return row!;
  }
  async deleteAdjustment(tenantId: string, id: string) {
    const res = await this.db.delete(gstAdjustments).where(and(eq(gstAdjustments.tenantId, tenantId), eq(gstAdjustments.id, id))).returning({ id: gstAdjustments.id });
    if (!res.length) throw notFound("Adjustment");
    return { ok: true };
  }

  async listAdvances(tenantId: string, month?: string) {
    const rows = await this.db.select().from(gstAdvances).where(and(eq(gstAdvances.tenantId, tenantId), month ? eq(gstAdvances.month, month) : undefined)).orderBy(desc(gstAdvances.month), desc(gstAdvances.createdAt)).limit(500);
    return { items: rows };
  }
  async addAdvance(tenantId: string, userId: string | null, raw: unknown) {
    const v = advanceInput.parse(raw);
    const [row] = await this.db.insert(gstAdvances).values({ tenantId, ...v, note: v.note ?? null, createdBy: userId }).returning();
    return row!;
  }
  async deleteAdvance(tenantId: string, id: string) {
    const res = await this.db.delete(gstAdvances).where(and(eq(gstAdvances.tenantId, tenantId), eq(gstAdvances.id, id))).returning({ id: gstAdvances.id });
    if (!res.length) throw notFound("Advance");
    return { ok: true };
  }

  async listTaxPayments(tenantId: string, q: { from?: string; to?: string; kind?: string } = {}) {
    const rows = await this.db
      .select()
      .from(gstTaxPayments)
      .where(and(eq(gstTaxPayments.tenantId, tenantId), eq(gstTaxPayments.status, "paid"), q.from ? gte(gstTaxPayments.paidOn, q.from) : undefined, q.to ? lte(gstTaxPayments.paidOn, q.to) : undefined, q.kind ? eq(gstTaxPayments.kind, q.kind as never) : undefined))
      .orderBy(desc(gstTaxPayments.paidOn))
      .limit(500);
    return { items: rows };
  }
  async addTaxPayment(tenantId: string, userId: string | null, raw: unknown) {
    const v = taxPaymentInput.parse(raw);
    const [row] = await this.db.insert(gstTaxPayments).values({ tenantId, ...v, challan: v.challan ?? null, note: v.note ?? null, createdBy: userId }).returning();
    return row!;
  }
  async deleteTaxPayment(tenantId: string, id: string) {
    const res = await this.db.update(gstTaxPayments).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(gstTaxPayments.tenantId, tenantId), eq(gstTaxPayments.id, id))).returning({ id: gstTaxPayments.id });
    if (!res.length) throw notFound("Payment");
    return { ok: true };
  }

  async listFilings(tenantId: string) {
    const rows = await this.db.select().from(gstFilings).where(eq(gstFilings.tenantId, tenantId)).orderBy(desc(gstFilings.filedOn)).limit(500);
    return { items: rows };
  }
  async markFiled(tenantId: string, userId: string | null, raw: unknown) {
    const v = filingInput.parse(raw);
    const [row] = await this.db
      .insert(gstFilings)
      .values({ tenantId, ...v, arn: v.arn ?? null, note: v.note ?? null, filedBy: userId })
      .onConflictDoUpdate({ target: [gstFilings.tenantId, gstFilings.returnType, gstFilings.period], set: { filedOn: v.filedOn, arn: v.arn ?? null, note: v.note ?? null, filedBy: userId, updatedAt: new Date() } })
      .returning();
    return row!;
  }
  async unmarkFiled(tenantId: string, returnType: string, period: string) {
    await this.db.delete(gstFilings).where(and(eq(gstFilings.tenantId, tenantId), eq(gstFilings.returnType, returnType as never), eq(gstFilings.period, period)));
    return { ok: true };
  }

  // ---------------------------------------------------------------- GSTR-1

  /**
   * GSTR-1 for a month (`period` MMYYYY) or a quarter (`quarter` "2026-Q3", QRMP): the existing tables from the
   * e-invoice module plus Table 6A, 8, 11 and 13, and the list of things to fix before the file is uploaded.
   */
  async gstr1(tenantId: string, opts: { period?: string; quarter?: string; gstin?: string | null }) {
    let ref: PeriodRef;
    if (opts.quarter) ref = parsePeriod(opts.quarter);
    else if (opts.period && /^(0[1-9]|1[0-2])\d{4}$/.test(opts.period)) ref = parsePeriod(`${opts.period.slice(2)}-${opts.period.slice(0, 2)}`);
    else throw badRequest("Use the return period as MMYYYY (e.g. 102026) or a quarter as YYYY-Qn");
    const [config, profile] = await Promise.all([this.getConfig(tenantId), this.sources.profile(tenantId)]);
    const gstin = opts.gstin ?? config.gstin ?? profile.gstin ?? null;
    const shopState = (gstin ? stateFromGstin(gstin) : null) ?? profile.stateCode;
    const fp = toFp(ref.month);
    const [base, sales, voided, advances] = await Promise.all([
      this.gstr1Base.build(tenantId, { period: fp, ...(ref.kind === "quarter" ? { from: ref.from, to: ref.to } : {}), gstin }),
      this.sources.sales(tenantId, ref),
      this.sources.voidedNumbers ? this.sources.voidedNumbers(tenantId, ref).catch(() => []) : Promise.resolve([]),
      this.db.select().from(gstAdvances).where(and(eq(gstAdvances.tenantId, tenantId), inArray(gstAdvances.month, ref.months))),
    ]);
    const nil = buildNil(sales, config, ref);
    const exp = buildExp(sales, ref);
    const docs = buildDocIssue(sales, voided, ref);
    const at = buildAdvances(advances, "received", shopState);
    const txpd = buildAdvances(advances, "adjusted", shopState);
    const json: Record<string, unknown> = { ...base.json, ...(exp.length ? { exp } : {}), ...(nil.inv.length ? { nil: { inv: nil.inv } } : {}), ...(at.length ? { at } : {}), ...(txpd.length ? { txpd } : {}), doc_issue: { doc_det: docs.doc_det } };
    const priorHigh = (config.priorTurnover ?? 0) > 5_00_00_000_00;
    const issues: Gstr1Issue[] = validateGstr1(sales, { gstin, range: ref, config, hsnDigits: priorHigh ? 6 : 4, gaps: docs.gaps });
    if (compositionOn(config, ref.from)) issues.unshift({ code: "tax_on_bill_of_supply", severity: "warning", detail: "composition" });
    const counts = { ...base.counts, exp: exp.reduce((s, b) => s + b.inv.length, 0), nil: nil.inv.length, at: at.length, txpd: txpd.length, voided: docs.voidedCounted };
    return {
      period: { key: ref.key, kind: ref.kind, months: ref.months, from: ref.from, to: ref.to, fp },
      gstin,
      json,
      warnings: base.warnings,
      issues,
      counts,
      tables: { nil: nil.paise },
      applicable: !compositionOn(config, ref.from),
      filename: `GSTR1_${gstin ? normalizeGstin(gstin) : "GSTIN"}_${fp}.json`,
    };
  }

  gstr1IssuesCsv(issues: Gstr1Issue[]): string {
    return toCsv(["Severity", "Problem", "Document", "Detail"], issues.map((i) => [i.severity, i.code, i.number ?? "", i.detail ?? ""]));
  }

  // ---------------------------------------------------------------- composition

  async cmp08(tenantId: string, quarterKey: string) {
    const q = parseQuarter(quarterKey);
    if (!q) throw badRequest("Use a quarter as YYYY-Qn (Q1 = April to June)");
    const [config, sales, { decisions }, pay] = await Promise.all([this.getConfig(tenantId), this.sources.sales(tenantId, q), this.decisions(tenantId, q, []), this.listTaxPayments(tenantId, { from: q.from, to: addDaysStr(q.to, 60), kind: "composition" })]);
    const data = buildCmp08(quarterKey, sales, decisions, config);
    const paid = pay.items.filter((p) => p.period === quarterKey).reduce((s, p) => s + p.cgst + p.sgst + p.igst, 0);
    return { ...data!, paid, balance: data!.tax.total - paid, applicable: config.composition, config: { type: config.compositionType, from: config.compositionFrom } };
  }

  cmp08Csv(c: Awaited<ReturnType<GstFilingService["cmp08"]>>): string {
    return toCsv(
      ["Quarter", "Rate %", "Turnover", "Inter-State turnover", "Central tax", "State/UT tax", "Composition tax", "Reverse charge value", "Reverse charge tax", "Paid", "Balance"],
      [[c.quarter, c.rate, rupeesText(c.turnover), rupeesText(c.interStateTurnover), rupeesText(c.tax.cgst), rupeesText(c.tax.sgst), rupeesText(c.tax.total), rupeesText(c.rcm.taxable), rupeesText(c.rcm.tax.igst + c.rcm.tax.cgst + c.rcm.tax.sgst), rupeesText(c.paid), rupeesText(c.balance)]],
    );
  }

  async gstr4(tenantId: string, fy: number): Promise<Gstr4Annual & { applicable: boolean }> {
    const range = fyRange(fy);
    const quarters: CompositionQuarter[] = [];
    const config = await this.getConfig(tenantId);
    const { decisions } = await this.decisions(tenantId, range, []);
    const sales = await this.sources.sales(tenantId, range);
    for (const q of quartersOfFy(fy)) {
      const c = buildCmp08(q.key, sales.filter((s) => s.date >= q.from && s.date <= q.to), decisions.filter((d) => d.doc.date >= q.from && d.doc.date <= q.to), config);
      if (c) quarters.push(c);
    }
    const inward = { registered: 0, rcmRegistered: 0, rcmUnregistered: 0, imports: 0 };
    for (const d of decisions) {
      if (d.doc.docType === "debit_note") continue;
      if (d.rcm) {
        if (d.rcm.isImport) inward.imports += d.rcm.taxable;
        else if (isValidGstin(d.doc.gstin)) inward.rcmRegistered += d.rcm.taxable;
        else inward.rcmUnregistered += d.rcm.taxable;
      } else if (isValidGstin(d.doc.gstin)) inward.registered += d.doc.taxable;
    }
    const pay = await this.listTaxPayments(tenantId, { from: range.from, to: addDaysStr(range.to, 60), kind: "composition" });
    const paid = pay.items.filter((p) => quarters.some((q) => q.quarter === p.period)).reduce((s, p) => s + p.cgst + p.sgst + p.igst, 0);
    return { ...buildGstr4(fy, quarters, inward, paid), applicable: config.composition };
  }

  // ---------------------------------------------------------------- overview: calendar and issues

  async overview(tenantId: string) {
    const today = this.today();
    const [config, profile, filings] = await Promise.all([this.getConfig(tenantId), this.sources.profile(tenantId), this.db.select().from(gstFilings).where(eq(gstFilings.tenantId, tenantId)).limit(500)]);
    const state = stateFromGstin(config.gstin ?? profile.gstin) ?? profile.stateCode;
    const calendar: DueItem[] = filingCalendar(today, config, state, filings);
    const issues = await this.issues(tenantId, today, config, profile, calendar);
    return {
      today,
      config,
      profile: { gstin: config.gstin ?? profile.gstin, legalName: profile.legalName, stateCode: profile.stateCode },
      calendar,
      issues,
      filings: filings.map((f) => ({ returnType: f.returnType, period: f.period, filedOn: f.filedOn, arn: f.arn })),
    };
  }

  /** Cheap checks only (profile, overdue returns, composition): the overview must open fast even for a shop with thousands of bills. */
  private async issues(tenantId: string, today: string, config: GstConfig, profile: ShopProfile, calendar: DueItem[]): Promise<FilingIssue[]> {
    const out: FilingIssue[] = [];
    const gstin = config.gstin ?? profile.gstin;
    if (!gstin) out.push({ id: "profile:gstin", severity: "error", area: "profile", code: "no_gstin", link: { tab: "settings" } });
    else if (!isValidGstin(gstin)) out.push({ id: "profile:gstin_invalid", severity: "error", area: "profile", code: "invalid_gstin", params: { gstin }, link: { tab: "settings" } });
    if (!profile.stateCode && !gstin) out.push({ id: "profile:state", severity: "error", area: "profile", code: "no_state", link: { tab: "settings" } });
    for (const d of calendar) {
      if (d.status === "overdue") {
        const tab = d.returnType === "gstr1" ? "gstr1" : d.returnType === "gstr3b" ? "gstr3b" : d.returnType === "cmp08" || d.returnType === "gstr4" ? "composition" : "calendar";
        out.push({ id: `cal:${d.returnType}:${d.period}`, severity: "error", area: "calendar", code: "overdue", params: { returnType: d.returnType, period: d.period, due: d.dueDate, days: -(d.daysLeft ?? 0) }, link: { tab, period: d.period } });
      }
    }
    if (config.qrmp && (config.priorTurnover ?? 0) > 5_00_00_000_00) out.push({ id: "qrmp:ineligible", severity: "warning", area: "calendar", code: "qrmp_over_5cr", link: { tab: "settings" } });
    if (!config.qrmp && !config.composition && (config.priorTurnover ?? 0) > 5_00_00_000_00) out.push({ id: "qrmp:turnover", severity: "info", area: "calendar", code: "turnover_over_5cr", link: { tab: "settings" } });
    void today;
    return out;
  }

  /**
   * The "fix before filing" list for one return period (a month, or a quarter for QRMP / composition): everything in the
   * GSTR-1 file that is missing or would be reported under another table, credit that cannot be claimed, reverse charge
   * not paid, credit past its time limit and bills unpaid for 180 days. Loads the period's bills, so it is its own call.
   */
  async periodIssues(tenantId: string, key: string): Promise<{ period: string; issues: FilingIssue[] }> {
    const ref = parsePeriod(key);
    const [config, profile] = await Promise.all([this.getConfig(tenantId), this.sources.profile(tenantId)]);
    const gstin = config.gstin ?? profile.gstin;
    const out: FilingIssue[] = [];
    const today = this.today();
    if (config.composition && compositionOn(config, ref.from)) {
      const q = quarterOfMonth(ref.month);
      const c = await this.cmp08(tenantId, q.key);
      if (c.interStateTurnover > 0) out.push({ id: "comp:inter", severity: "warning", area: "composition", code: "composition_inter_state", params: { amount: c.interStateTurnover }, link: { tab: "composition", period: q.key } });
      if (c.taxCharged.count > 0) out.push({ id: "comp:taxed", severity: "warning", area: "composition", code: "composition_tax_charged", count: c.taxCharged.count, link: { tab: "composition", period: q.key } });
      if (c.turnover > COMPOSITION_LIMITS.goods) out.push({ id: "comp:limit", severity: "warning", area: "composition", code: "composition_limit", params: { amount: c.turnover }, link: { tab: "composition", period: q.key } });
      return { period: key, issues: out };
    }
    const g1 = await this.gstr1(tenantId, ref.kind === "quarter" ? { quarter: key, gstin } : { period: toFp(ref.month), gstin });
    const tally = (list: Gstr1Issue[], severity: "error" | "warning") => {
      const by = new Map<string, number>();
      for (const i of list.filter((x) => x.severity === severity)) by.set(i.code, (by.get(i.code) ?? 0) + 1);
      for (const [code, n] of by) out.push({ id: `g1:${severity}:${key}:${code}`, severity, area: "gstr1", code: `g1_${code}`, count: n, params: { period: key }, link: { tab: "gstr1", period: key } });
    };
    tally(g1.issues, "error");
    tally(g1.issues, "warning");
    const b = await this.gstr3bBuild(tenantId, key);
    const noGstin = b.decisions.filter((d) => d.reason === "no_gstin");
    if (noGstin.length) out.push({ id: `itc:${key}:nogstin`, severity: "warning", area: "itc", code: "itc_no_gstin", count: noGstin.length, params: { period: key, amount: noGstin.reduce((s, d) => s + totalTax(d.tax), 0) }, link: { tab: "itc", period: ref.month, filter: "ineligible" } });
    const unpaid = b.decisions.filter((d) => d.rcm && !d.rcm.paid && b.period.months.includes(d.rcm.month));
    if (unpaid.length) out.push({ id: `rcm:${key}`, severity: "warning", area: "rcm", code: "rcm_unpaid", count: unpaid.length, params: { period: key, amount: unpaid.reduce((s, d) => s + d.rcm!.due, 0) }, link: { tab: "rcm", period: ref.month } });
    const lapsed = b.decisions.filter((d) => d.lapsed);
    if (lapsed.length) out.push({ id: `itc:${key}:lapsed`, severity: "warning", area: "itc", code: "itc_lapsed", count: lapsed.length, link: { tab: "itc", period: ref.month } });
    const r37 = rule37Candidates(b.decisions, today);
    if (r37.length) out.push({ id: `itc:${key}:rule37`, severity: "warning", area: "itc", code: "itc_rule37", count: r37.length, params: { amount: r37.reduce((s, c) => s + totalTax(c.credit), 0) }, link: { tab: "itc", period: ref.month } });
    return { period: key, issues: out };
  }

  // ---------------------------------------------------------------- misc for the adapters

  async hasFlags(tenantId: string) {
    const [r] = await this.db.select({ n: sql<number>`count(*)::int` }).from(gstDocFlags).where(eq(gstDocFlags.tenantId, tenantId));
    return (r?.n ?? 0) > 0;
  }

  /** Composition tax and other challans as the books need them (paid ones only). */
  async taxPaymentsForBooks(tenantId: string) {
    return this.db.select().from(gstTaxPayments).where(and(eq(gstTaxPayments.tenantId, tenantId), or(eq(gstTaxPayments.kind, "composition"), eq(gstTaxPayments.kind, "liability"))));
  }
}

const addDaysStr = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export { fyLabel };

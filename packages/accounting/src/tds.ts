/**
 * TDS / TCS (Part B): settings and sections, PAN of suppliers and customers, tax deducted on supplier bills, payments
 * and expenses, tax collected on sales, challans, the payable register, quarterly statement data (26Q / 27EQ style),
 * certificate summaries and the due-date calendar. Postings go through AccountingService; nothing here files a return.
 */
import { badRequest, conflict, notFound } from "@rbms/core";
import type { Db } from "@rbms/db";
import { isValidDate } from "@rbms/gst";
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SYS } from "./chart";
import type { ExpenseSrc, PartyRef, SourcesPort } from "./ports";
import type { ReportTable } from "./reports-logic";
import { acctAccounts } from "./schema";
import { acctPartyTax, acctTdsChallans, acctTdsEntries, acctTdsSettings, DEDUCTEE_TYPES, TAX_KINDS, type AcctTdsEntry } from "./schema-b";
import type { AccountingService } from "./service";
import {
  computeTds,
  deducteeTypeOfPan,
  depositDueDate,
  financialYearOf,
  isValidPan,
  lateInterest,
  mergedSections,
  panFromGstin,
  parseFy,
  parseQuarter,
  quarterDueDates,
  quarterOf,
  SECTION_BY_KEY,
  type TdsSectionDef,
} from "./tds-rules";

const date = z.string().refine(isValidDate, "Use a YYYY-MM-DD date");
const uuid = z.string().uuid();
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const panSchema = z
  .string()
  .trim()
  .toUpperCase()
  .nullish()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isValidPan(v), "A PAN is 5 letters, 4 digits and a letter (ABCDE1234F)");

const overrideSchema = z
  .object({
    rate: z.number().int().min(0).max(5000).nullish(),
    rateOther: z.number().int().min(0).max(5000).nullish(),
    noPanRate: z.number().int().min(0).max(5000).nullish(),
    single: z.number().int().min(0).max(2_000_000_000).nullish(),
    annual: z.number().int().min(0).max(2_000_000_000).nullish(),
    enabled: z.boolean().nullish(),
  })
  .strict();

export const tdsSettingsPatch = z
  .object({
    enabled: z.boolean().optional(),
    tcsEnabled: z.boolean().optional(),
    tan: z
      .string()
      .trim()
      .toUpperCase()
      .nullish()
      .refine((v) => !v || /^[A-Z]{4}[0-9]{5}[A-Z]$/.test(v), "A TAN is 4 letters, 5 digits and a letter (CHEA12345B)"),
    deductorName: optText(120),
    responsiblePerson: optText(120),
    buyerTurnoverAbove10Cr: z.boolean().optional(),
    overrides: z.record(z.string(), overrideSchema).optional(),
  })
  .strict();

export const partyTaxInput = z
  .object({
    pan: panSchema,
    deducteeType: z.enum(DEDUCTEE_TYPES).nullish(),
    defaultSection: z.string().trim().max(20).nullish(),
    lowerRate: z.number().int().min(0).max(5000).nullish(),
    certificateNo: optText(40),
    certificateUntil: date.nullish(),
  })
  .strict();

export const TDS_SOURCE_KINDS = ["purchase", "supplier", "expense", "invoice", "customer", "other"] as const;
export const tdsEntryInput = z
  .object({
    kind: z.enum(TAX_KINDS).default("tds"),
    section: z.string().trim().min(1).max(20),
    date,
    partyType: z.enum(["supplier", "customer", "other"]),
    partyId: uuid.nullish(),
    partyName: z.string().trim().max(120).optional(),
    pan: panSchema.optional(),
    base: z.number().int().positive().max(2_000_000_000),
    rate: z.number().int().min(0).max(5000),
    amount: z.number().int().positive().max(2_000_000_000),
    sourceType: z.enum(TDS_SOURCE_KINDS),
    sourceId: z.string().trim().max(80).nullish(),
    sourceRef: optText(80),
    /** For "other": the account debited (an expense, Salaries payable, a loan ...). */
    otherAccountId: uuid.nullish(),
    note: optText(300),
    /** Supplier entries: also settle the tax on the bill in Payables (default yes). */
    settle: z.boolean().default(true),
  })
  .strict();

export const challanInput = z
  .object({
    kind: z.enum(TAX_KINDS).default("tds"),
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month as YYYY-MM"),
    section: z.string().trim().max(20).nullish(),
    bsrCode: z.string().trim().regex(/^\d{7}$/, "The BSR code has 7 digits"),
    challanNo: z.string().trim().regex(/^\d{1,5}$/, "The challan serial number has up to 5 digits"),
    date,
    tax: z.number().int().positive().max(2_000_000_000),
    interest: z.number().int().min(0).max(2_000_000_000).default(0),
    fee: z.number().int().min(0).max(2_000_000_000).default(0),
    paidFromAccountId: uuid,
    /** The deductions this challan pays (default: the month's unpaid ones). */
    entryIds: z.array(uuid).max(2000).optional(),
    note: optText(300),
  })
  .strict();

const num = (v: unknown) => Number(v ?? 0);
const rupees = (p: number) => (p / 100).toFixed(2);

export interface TdsDeps {
  db: Db;
  acct: AccountingService;
  sources: SourcesPort;
  shopName?: (tenantId: string) => Promise<string>;
}

export class TdsService {
  constructor(private readonly deps: TdsDeps) {}
  private get db() {
    return this.deps.db;
  }
  private today() {
    return this.deps.acct.today();
  }

  // ================================================================ settings and sections

  async getSettings(tenantId: string) {
    const [s] = await this.db.select().from(acctTdsSettings).where(eq(acctTdsSettings.tenantId, tenantId)).limit(1);
    const row = s ?? { enabled: false, tcsEnabled: false, tan: null, deductorName: null, responsiblePerson: null, buyerTurnoverAbove10Cr: false, overrides: {} };
    return { ...row, sections: mergedSections(row.overrides) };
  }

  async updateSettings(tenantId: string, input: z.input<typeof tdsSettingsPatch>) {
    const p = tdsSettingsPatch.parse(input);
    for (const k of Object.keys(p.overrides ?? {})) if (!SECTION_BY_KEY[k]) throw badRequest(`Unknown section ${k}`);
    const cur = await this.getSettings(tenantId);
    const overrides = p.overrides ? { ...cur.overrides, ...p.overrides } : cur.overrides;
    const values = {
      enabled: p.enabled ?? cur.enabled,
      tcsEnabled: p.tcsEnabled ?? cur.tcsEnabled,
      tan: p.tan !== undefined ? (p.tan ?? null) : cur.tan,
      deductorName: p.deductorName !== undefined ? p.deductorName : cur.deductorName,
      responsiblePerson: p.responsiblePerson !== undefined ? p.responsiblePerson : cur.responsiblePerson,
      buyerTurnoverAbove10Cr: p.buyerTurnoverAbove10Cr ?? cur.buyerTurnoverAbove10Cr,
      overrides: overrides as Record<string, Record<string, number | boolean | null>>,
    };
    await this.db.insert(acctTdsSettings).values({ tenantId, ...values }).onConflictDoUpdate({ target: acctTdsSettings.tenantId, set: values });
    return this.getSettings(tenantId);
  }

  private async section(tenantId: string, key: string): Promise<TdsSectionDef & { enabled: boolean }> {
    const s = (await this.getSettings(tenantId)).sections.find((x) => x.key === key);
    if (!s) throw badRequest(`Unknown section ${key}`, { sections: Object.keys(SECTION_BY_KEY) });
    return s;
  }

  // ================================================================ parties

  /** Suppliers or customers with their PAN (typed, or read from the GSTIN) and TDS details. */
  async parties(tenantId: string, type: "supplier" | "customer", q: { search?: string; limit?: number; ids?: string[] } = {}) {
    const list: PartyRef[] = this.deps.sources.parties ? await this.deps.sources.parties(tenantId, type, q) : [];
    const ids = list.map((p) => p.id);
    const tax = ids.length
      ? await this.db.select().from(acctPartyTax).where(and(eq(acctPartyTax.tenantId, tenantId), eq(acctPartyTax.partyType, type), inArray(acctPartyTax.partyId, ids)))
      : [];
    return {
      items: list.map((p) => {
        const t = tax.find((x) => x.partyId === p.id);
        const fromGstin = panFromGstin(p.gstin);
        const pan = t?.pan ?? null;
        return {
          ...p,
          pan,
          panFromGstin: fromGstin,
          effectivePan: pan ?? fromGstin,
          deducteeType: t?.deducteeType ?? deducteeTypeOfPan(pan ?? fromGstin),
          defaultSection: t?.defaultSection ?? null,
          lowerRate: t?.lowerRate ?? null,
          certificateNo: t?.certificateNo ?? null,
          certificateUntil: t?.certificateUntil ?? null,
        };
      }),
    };
  }

  async party(tenantId: string, type: "supplier" | "customer", id: string) {
    const r = await this.parties(tenantId, type, { ids: [id] });
    return r.items[0] ?? null;
  }

  async setParty(tenantId: string, type: "supplier" | "customer", partyId: string, input: z.input<typeof partyTaxInput>) {
    const p = partyTaxInput.parse(input);
    if (p.defaultSection && !SECTION_BY_KEY[p.defaultSection]) throw badRequest(`Unknown section ${p.defaultSection}`);
    if (this.deps.sources.parties && !(await this.party(tenantId, type, partyId))) throw notFound(type === "supplier" ? "Supplier" : "Customer");
    const values = {
      pan: p.pan ?? null,
      deducteeType: p.deducteeType ?? deducteeTypeOfPan(p.pan) ?? null,
      defaultSection: p.defaultSection ?? null,
      lowerRate: p.lowerRate ?? null,
      certificateNo: p.certificateNo,
      certificateUntil: p.certificateUntil ?? null,
    };
    await this.db
      .insert(acctPartyTax)
      .values({ tenantId, partyType: type, partyId, ...values })
      .onConflictDoUpdate({ target: [acctPartyTax.tenantId, acctPartyTax.partyType, acctPartyTax.partyId], set: values });
    return this.party(tenantId, type, partyId);
  }

  // ================================================================ computing

  /** Bills of a supplier in the financial year (value without GST), for 194Q and the "earlier this year" figure. */
  private async supplierPurchases(tenantId: string, supplierId: string, fy: { from: string; to: string }) {
    const all = await this.deps.sources.purchases(tenantId);
    return all
      .filter((p) => p.supplierId === supplierId && p.status === "recorded" && !p.imported && p.date >= fy.from && p.date <= fy.to)
      .map((p) => ({ id: p.id, billNumber: p.billNumber, date: p.date, total: p.total, taxable: p.total - p.cgst - p.sgst - p.igst - p.roundOff }));
  }

  /** Suggested tax for a payment or bill: rate by PAN and deductee type, thresholds against this year's figures. */
  async compute(tenantId: string, q: { section: string; partyType: string; partyId?: string | null; base: number; date?: string; sourceType?: string; sourceId?: string | null; pan?: string | null; deducteeType?: string | null }) {
    const s = await this.section(tenantId, q.section);
    const when = q.date && isValidDate(q.date) ? q.date : this.today();
    const fy = financialYearOf(when);
    const settings = await this.getSettings(tenantId);
    const party = q.partyId && (q.partyType === "supplier" || q.partyType === "customer") ? await this.party(tenantId, q.partyType, q.partyId) : null;
    const pan = q.pan ?? party?.effectivePan ?? null;
    const deducteeType = q.deducteeType ?? party?.deducteeType ?? deducteeTypeOfPan(pan);
    const lower = party?.lowerRate !== null && party?.lowerRate !== undefined && (!party.certificateUntil || party.certificateUntil >= when) ? party.lowerRate : null;
    const prior = q.partyId
      ? await this.db
          .select({ base: acctTdsEntries.base, sourceType: acctTdsEntries.sourceType, sourceId: acctTdsEntries.sourceId })
          .from(acctTdsEntries)
          .where(
            and(
              eq(acctTdsEntries.tenantId, tenantId),
              eq(acctTdsEntries.partyId, q.partyId),
              eq(acctTdsEntries.section, s.key),
              eq(acctTdsEntries.status, "active"),
              gte(acctTdsEntries.date, fy.from),
              lte(acctTdsEntries.date, when),
            ),
          )
      : [];
    let earlier = prior.reduce((t, r) => t + r.base, 0);
    let earlierUntaxed = 0;
    let purchasesThisYear: { id: string; billNumber: string; date: string; taxable: number }[] = [];
    if (q.partyType === "supplier" && q.partyId && (s.key === "194Q" || s.key === "194C")) {
      purchasesThisYear = (await this.supplierPurchases(tenantId, q.partyId, fy)).filter((p) => p.date <= when && p.id !== q.sourceId);
      const taxedBills = new Set(prior.filter((r) => r.sourceType === "purchase").map((r) => r.sourceId));
      const bills = purchasesThisYear.reduce((t, p) => t + p.taxable, 0);
      earlierUntaxed = purchasesThisYear.filter((p) => !taxedBills.has(p.id)).reduce((t, p) => t + p.taxable, 0);
      // For purchases the bills are the measure of "paid or credited this year".
      earlier = Math.max(earlier, bills);
    }
    const result = computeTds({ section: s, deducteeType, pan, base: Math.max(0, Math.round(q.base)), earlier, earlierUntaxed, lowerRate: lower, date: when, turnoverAbove10Cr: settings.buyerTurnoverAbove10Cr });
    const due = depositDueDate(when.slice(0, 7), s.kind);
    return { ...result, section: s, pan, deducteeType, earlier, earlierUntaxed, purchasesThisYear: purchasesThisYear.length, depositDue: due, fy: fy.fy };
  }

  // ================================================================ entries

  async entries(tenantId: string, q: { kind?: string; from?: string; to?: string; quarter?: string; section?: string; partyId?: string; status?: string; limit?: number; offset?: number } = {}) {
    const quarter = q.quarter ? parseQuarter(q.quarter) : null;
    const from = quarter?.from ?? (q.from && isValidDate(q.from) ? q.from : undefined);
    const to = quarter?.to ?? (q.to && isValidDate(q.to) ? q.to : undefined);
    const where = and(
      eq(acctTdsEntries.tenantId, tenantId),
      q.kind === "tds" || q.kind === "tcs" ? eq(acctTdsEntries.kind, q.kind) : undefined,
      from ? gte(acctTdsEntries.date, from) : undefined,
      to ? lte(acctTdsEntries.date, to) : undefined,
      q.section ? eq(acctTdsEntries.section, q.section) : undefined,
      q.partyId && uuid.safeParse(q.partyId).success ? eq(acctTdsEntries.partyId, q.partyId) : undefined,
      q.status === "active" || q.status === "cancelled" ? eq(acctTdsEntries.status, q.status) : undefined,
    );
    const limit = Math.min(Math.max(Number(q.limit ?? 100) || 100, 1), 500);
    const offset = Math.max(Number(q.offset ?? 0) || 0, 0);
    const [items, [tot]] = await Promise.all([
      this.db.select().from(acctTdsEntries).where(where).orderBy(desc(acctTdsEntries.date), desc(acctTdsEntries.createdAt)).limit(limit).offset(offset),
      this.db
        .select({ n: sql<string>`count(*)`, amount: sql<string>`coalesce(sum(${acctTdsEntries.amount}) filter (where ${acctTdsEntries.status} = 'active'), 0)` })
        .from(acctTdsEntries)
        .where(where),
    ]);
    return { items, total: num(tot?.n), amount: num(tot?.amount), limit, offset };
  }

  /** Records tax deducted or collected and posts it. Supplier bills also get the tax settled in Payables. */
  async createEntry(tenantId: string, input: z.input<typeof tdsEntryInput>, userId: string | null) {
    const p = tdsEntryInput.parse(input);
    const s = await this.section(tenantId, p.section);
    if (s.kind !== p.kind) throw badRequest(`Section ${s.section} is ${s.kind.toUpperCase()}, not ${p.kind.toUpperCase()}`);
    const settings = await this.getSettings(tenantId);
    if (p.kind === "tcs" && !settings.tcsEnabled) throw badRequest("Switch on TCS in the TDS settings first");
    if (p.amount > p.base) throw badRequest("The tax can't be more than the amount it is charged on");
    if (p.kind === "tcs" && p.partyType !== "customer") throw badRequest("TCS is collected from a customer");
    if (p.kind === "tds" && p.partyType === "customer") throw badRequest("TDS is deducted from a supplier or another payee");
    if ((p.sourceType === "purchase" || p.sourceType === "supplier") && p.partyType !== "supplier") throw badRequest("Choose the supplier");
    if (p.sourceType === "purchase" && !p.sourceId) throw badRequest("Choose the purchase bill");
    if (p.sourceType === "expense" && !p.sourceId) throw badRequest("Choose the expense");
    if (p.sourceType === "other" && !p.otherAccountId) throw badRequest("Choose the account the tax is taken from");
    if ((p.partyType === "supplier" || p.partyType === "customer") && !p.partyId) throw badRequest("Choose the party");
    const s0 = await this.deps.acct.settings(tenantId);
    this.deps.acct.assertOpen(s0.lockedThrough, p.date);

    if (p.sourceId) {
      const [dup] = await this.db
        .select({ id: acctTdsEntries.id })
        .from(acctTdsEntries)
        .where(and(eq(acctTdsEntries.tenantId, tenantId), eq(acctTdsEntries.sourceType, p.sourceType), eq(acctTdsEntries.sourceId, p.sourceId), eq(acctTdsEntries.section, s.key), eq(acctTdsEntries.status, "active")))
        .limit(1);
      if (dup) throw conflict("Tax under this section is already recorded for this document");
    }

    // Who and which accounts.
    let partyName = p.partyName ?? "";
    let pan = p.pan ?? null;
    if (p.partyId && (p.partyType === "supplier" || p.partyType === "customer")) {
      const party = await this.party(tenantId, p.partyType, p.partyId);
      if (!party && this.deps.sources.parties) throw notFound(p.partyType === "supplier" ? "Supplier" : "Customer");
      partyName = party?.name ?? partyName;
      pan = pan ?? party?.effectivePan ?? null;
    }
    if (!partyName) throw badRequest("Name the party");
    let debitAccountId: string;
    let debitParty: { partyType: "customer" | "supplier"; partyId: string } | null = null;
    let sourceRef = p.sourceRef ?? null;
    let expenseOnCredit: ExpenseSrc | null = null;
    if (p.kind === "tcs") {
      debitAccountId = await this.deps.acct.accountIdByKey(tenantId, SYS.debtors);
      debitParty = { partyType: "customer", partyId: p.partyId! };
    } else if (p.sourceType === "purchase" || p.sourceType === "supplier") {
      debitAccountId = await this.deps.acct.accountIdByKey(tenantId, SYS.creditors);
      debitParty = { partyType: "supplier", partyId: p.partyId! };
      if (p.sourceType === "purchase") {
        const bill = (await this.deps.sources.purchases(tenantId)).find((b) => b.id === p.sourceId);
        if (!bill || bill.supplierId !== p.partyId) throw badRequest("That purchase bill is not from this supplier");
        if (bill.status !== "recorded") throw badRequest("The purchase bill is cancelled");
        sourceRef = sourceRef ?? bill.billNumber;
      }
    } else if (p.sourceType === "expense") {
      const e = (await this.deps.sources.expenses(tenantId)).find((x) => x.id === p.sourceId);
      if (!e || e.status !== "recorded") throw badRequest("That expense was not found");
      if (e.onCredit && e.supplierId) {
        // Bought on credit: the supplier is owed the expense less the tax kept (Dr Creditors, like a supplier bill).
        debitAccountId = await this.deps.acct.accountIdByKey(tenantId, SYS.creditors);
        debitParty = { partyType: "supplier", partyId: e.supplierId };
        expenseOnCredit = e;
      } else {
        // The expense was recorded at the full amount from its money account; the deducted part stays in the shop.
        debitAccountId = await this.deps.acct.methodAccountId(tenantId, e.paymentMethod);
      }
      sourceRef = sourceRef ?? `${e.categoryName}${e.vendorName ? ` - ${e.vendorName}` : ""}`;
    } else {
      debitAccountId = (await this.deps.acct.getAccount(tenantId, p.otherAccountId!)).id;
    }
    const creditAccountId = await this.deps.acct.accountIdByKey(tenantId, p.kind === "tcs" ? SYS.tcsPayable : SYS.tdsPayable);

    const id = randomUUID();
    let settlementId: string | null = null;
    const settleOn = p.sourceType === "purchase" || p.sourceType === "supplier" || (p.sourceType === "expense" && expenseOnCredit);
    if (p.kind === "tds" && p.settle && settleOn && this.deps.sources.settleSupplierTds) {
      try {
        settlementId = await this.deps.sources.settleSupplierTds(tenantId, {
          tdsId: id,
          supplierId: expenseOnCredit?.supplierId ?? p.partyId!,
          purchaseId: p.sourceType === "purchase" ? p.sourceId! : null,
          expenseId: expenseOnCredit ? expenseOnCredit.id : null,
          amount: p.amount,
          date: p.date,
          note: `TDS u/s ${s.section} deducted (${(p.rate / 100).toFixed(2)}% of ₹${rupees(p.base)})`,
        });
      } catch (err) {
        throw badRequest(`Couldn't record the tax on the bill in Payables: ${(err as Error).message}. Record the TDS before paying the bill in full, or untick "settle on the bill".`);
      }
    }
    try {
      await this.db.transaction(async (tx) => {
        const what = p.kind === "tcs" ? "TCS collected" : "TDS deducted";
        const entryId = await this.deps.acct.postModuleEntry(
          tenantId,
          {
            sourceType: p.kind === "tcs" ? "tcs_collection" : "tds_deduction",
            sourceId: id,
            date: p.date,
            narration: `${what} u/s ${s.section} - ${partyName}${sourceRef ? ` (${sourceRef})` : ""}`,
            reference: sourceRef,
            lines: [
              { accountId: debitAccountId, debit: p.amount, credit: 0, ...(debitParty ?? {}) },
              { accountId: creditAccountId, debit: 0, credit: p.amount },
            ],
          },
          { tx, userId },
        );
        await tx.insert(acctTdsEntries).values({
          id,
          tenantId,
          kind: p.kind,
          date: p.date,
          section: s.key,
          partyType: p.partyType,
          partyId: p.partyId ?? null,
          partyName,
          pan,
          base: p.base,
          rate: p.rate,
          amount: p.amount,
          noPan: !isValidPan(pan),
          sourceType: p.sourceType,
          sourceId: p.sourceId ?? null,
          sourceRef,
          otherAccountId: p.otherAccountId ?? null,
          entryId,
          settlementId,
          note: p.note,
          createdBy: userId,
        });
      });
    } catch (err) {
      if (settlementId && this.deps.sources.unsettleSupplierTds) await this.deps.sources.unsettleSupplierTds(tenantId, settlementId, "TDS entry not saved").catch(() => undefined);
      throw err;
    }
    const [row] = await this.db.select().from(acctTdsEntries).where(eq(acctTdsEntries.id, id)).limit(1);
    return row!;
  }

  async cancelEntry(tenantId: string, id: string, input: { reason?: string; date?: string }, userId: string | null) {
    const reason = z.string().trim().min(1, "Say why").max(300).parse(input.reason ?? "");
    const [e] = await this.db.select().from(acctTdsEntries).where(and(eq(acctTdsEntries.tenantId, tenantId), eq(acctTdsEntries.id, id))).limit(1);
    if (!e) throw notFound("TDS entry");
    if (e.status !== "active") throw conflict("Already cancelled");
    if (e.challanId) throw conflict("This tax is already paid by a challan. Cancel the challan first.");
    const when = input.date && isValidDate(input.date) ? input.date : this.today();
    await this.db.transaction(async (tx) => {
      const rev = e.entryId
        ? await this.deps.acct.reverseModuleEntry(tenantId, e.entryId, { date: when, reason, sourceType: e.kind === "tcs" ? "tcs_collection_reversal" : "tds_deduction_reversal" }, { tx, userId })
        : null;
      await tx.update(acctTdsEntries).set({ status: "cancelled", reversalEntryId: rev, cancelledAt: new Date(), cancelReason: reason }).where(eq(acctTdsEntries.id, id));
    });
    if (e.settlementId && this.deps.sources.unsettleSupplierTds) await this.deps.sources.unsettleSupplierTds(tenantId, e.settlementId, `TDS cancelled: ${reason}`);
    return { ok: true as const };
  }

  /**
   * Purchase bills that may need TDS: from suppliers with a default section, or 194Q purchases past Rs 50 lakh this
   * year, with no tax recorded yet.
   */
  async candidates(tenantId: string, q: { fy?: string } = {}) {
    const fy = (q.fy && parseFy(q.fy)) || financialYearOf(this.today());
    const settings = await this.getSettings(tenantId);
    const tax = await this.db.select().from(acctPartyTax).where(and(eq(acctPartyTax.tenantId, tenantId), eq(acctPartyTax.partyType, "supplier")));
    const purchases = (await this.deps.sources.purchases(tenantId)).filter((p) => p.status === "recorded" && !p.imported && p.supplierId && p.date >= fy.from && p.date <= fy.to);
    const done = new Set(
      (
        await this.db
          .select({ sourceId: acctTdsEntries.sourceId })
          .from(acctTdsEntries)
          .where(and(eq(acctTdsEntries.tenantId, tenantId), eq(acctTdsEntries.sourceType, "purchase"), eq(acctTdsEntries.status, "active")))
      ).map((r) => r.sourceId),
    );
    const bySupplier = new Map<string, typeof purchases>();
    for (const p of purchases) bySupplier.set(p.supplierId!, [...(bySupplier.get(p.supplierId!) ?? []), p]);
    const out: { purchaseId: string; billNumber: string; date: string; supplierId: string; supplierName: string; taxable: number; section: string; reason: string }[] = [];
    for (const [supplierId, bills] of bySupplier) {
      const t = tax.find((x) => x.partyId === supplierId);
      const sorted = [...bills].sort((a, b) => a.date.localeCompare(b.date));
      let running = 0;
      for (const b of sorted) {
        const taxable = b.total - b.cgst - b.sgst - b.igst - b.roundOff;
        running += taxable;
        if (done.has(b.id)) continue;
        if (t?.defaultSection) out.push({ purchaseId: b.id, billNumber: b.billNumber, date: b.date, supplierId, supplierName: b.supplierName, taxable, section: t.defaultSection, reason: "Supplier's default section" });
        else if (settings.buyerTurnoverAbove10Cr && running > 50 * 100_000 * 100)
          out.push({ purchaseId: b.id, billNumber: b.billNumber, date: b.date, supplierId, supplierName: b.supplierName, taxable, section: "194Q", reason: "Purchases from this supplier passed Rs 50 lakh this year" });
      }
    }
    return { fy: fy.fy, items: out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 300) };
  }

  // ================================================================ challans

  async challans(tenantId: string, q: { kind?: string; fy?: string } = {}) {
    const fy = q.fy ? parseFy(q.fy) : null;
    const items = await this.db
      .select()
      .from(acctTdsChallans)
      .where(
        and(
          eq(acctTdsChallans.tenantId, tenantId),
          q.kind === "tds" || q.kind === "tcs" ? eq(acctTdsChallans.kind, q.kind) : undefined,
          fy ? gte(acctTdsChallans.period, fy.from.slice(0, 7)) : undefined,
          fy ? lte(acctTdsChallans.period, fy.to.slice(0, 7)) : undefined,
        ),
      )
      .orderBy(desc(acctTdsChallans.date), desc(acctTdsChallans.createdAt))
      .limit(500);
    const allocated = items.length
      ? await this.db
          .select({ challanId: acctTdsEntries.challanId, n: sql<string>`count(*)`, amount: sql<string>`coalesce(sum(${acctTdsEntries.amount}), 0)` })
          .from(acctTdsEntries)
          .where(and(eq(acctTdsEntries.tenantId, tenantId), inArray(acctTdsEntries.challanId, items.map((c) => c.id))))
          .groupBy(acctTdsEntries.challanId)
      : [];
    return { items: items.map((c) => ({ ...c, allocated: num(allocated.find((a) => a.challanId === c.id)?.amount), entries: num(allocated.find((a) => a.challanId === c.id)?.n) })) };
  }

  /** Records a challan: Dr TDS/TCS payable (tax) and Interest and late fee, Cr the money account; ties the deductions to it. */
  async createChallan(tenantId: string, input: z.input<typeof challanInput>, userId: string | null) {
    const p = challanInput.parse(input);
    const from = await this.deps.acct.getAccount(tenantId, p.paidFromAccountId);
    if (!from.isBank && !from.isCash) throw badRequest("Choose the cash or bank account it was paid from");
    const s0 = await this.deps.acct.settings(tenantId);
    this.deps.acct.assertOpen(s0.lockedThrough, p.date);
    const monthFrom = `${p.period}-01`;
    const monthTo = new Date(Date.UTC(Number(p.period.slice(0, 4)), Number(p.period.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const open = await this.db
      .select()
      .from(acctTdsEntries)
      .where(
        and(
          eq(acctTdsEntries.tenantId, tenantId),
          eq(acctTdsEntries.kind, p.kind),
          eq(acctTdsEntries.status, "active"),
          isNull(acctTdsEntries.challanId),
          p.entryIds?.length ? inArray(acctTdsEntries.id, p.entryIds) : and(gte(acctTdsEntries.date, monthFrom), lte(acctTdsEntries.date, monthTo)),
          p.section ? eq(acctTdsEntries.section, p.section) : undefined,
        ),
      )
      .orderBy(asc(acctTdsEntries.date), asc(acctTdsEntries.createdAt));
    if (p.entryIds?.length && open.length !== new Set(p.entryIds).size) throw badRequest("Some of the chosen deductions are not open (cancelled or already paid)");
    const pick: AcctTdsEntry[] = [];
    let sum = 0;
    for (const e of open) {
      if (sum + e.amount > p.tax) {
        if (p.entryIds?.length) throw badRequest(`The chosen deductions add up to more than the challan's tax (₹${rupees(open.reduce((t, x) => t + x.amount, 0))})`);
        continue;
      }
      pick.push(e);
      sum += e.amount;
    }
    const id = randomUUID();
    const payableId = await this.deps.acct.accountIdByKey(tenantId, p.kind === "tcs" ? SYS.tcsPayable : SYS.tdsPayable);
    const interestId = p.interest + p.fee > 0 ? await this.deps.acct.accountIdByKey(tenantId, SYS.taxInterest) : null;
    await this.db.transaction(async (tx) => {
      const entryId = await this.deps.acct.postModuleEntry(
        tenantId,
        {
          sourceType: "tds_challan",
          sourceId: id,
          date: p.date,
          narration: `${p.kind.toUpperCase()} deposited for ${p.period}${p.section ? ` u/s ${p.section}` : ""} - challan ${p.challanNo}, BSR ${p.bsrCode}`,
          reference: `${p.bsrCode}/${p.challanNo}`,
          lines: [
            { accountId: payableId, debit: p.tax, credit: 0 },
            ...(interestId ? [{ accountId: interestId, debit: p.interest + p.fee, credit: 0, memo: `Interest ₹${rupees(p.interest)}, fee ₹${rupees(p.fee)}` }] : []),
            { accountId: from.id, debit: 0, credit: p.tax + p.interest + p.fee },
          ],
        },
        { tx, userId },
      );
      await tx.insert(acctTdsChallans).values({ id, tenantId, kind: p.kind, period: p.period, section: p.section ?? null, bsrCode: p.bsrCode, challanNo: p.challanNo, date: p.date, tax: p.tax, interest: p.interest, fee: p.fee, paidFromAccountId: from.id, entryId, note: p.note, createdBy: userId });
      if (pick.length) await tx.update(acctTdsEntries).set({ challanId: id }).where(and(eq(acctTdsEntries.tenantId, tenantId), inArray(acctTdsEntries.id, pick.map((e) => e.id))));
    });
    return { id, allocated: sum, entries: pick.length, unallocated: p.tax - sum };
  }

  async cancelChallan(tenantId: string, id: string, input: { reason?: string }, userId: string | null) {
    const reason = z.string().trim().min(1, "Say why").max(300).parse(input.reason ?? "");
    const [c] = await this.db.select().from(acctTdsChallans).where(and(eq(acctTdsChallans.tenantId, tenantId), eq(acctTdsChallans.id, id))).limit(1);
    if (!c) throw notFound("Challan");
    if (c.status !== "active") throw conflict("Already cancelled");
    await this.db.transaction(async (tx) => {
      const rev = c.entryId ? await this.deps.acct.reverseModuleEntry(tenantId, c.entryId, { date: this.today(), reason, sourceType: "tds_challan_reversal" }, { tx, userId }) : null;
      await tx.update(acctTdsChallans).set({ status: "cancelled", reversalEntryId: rev, note: `${c.note ? `${c.note}. ` : ""}Cancelled: ${reason}` }).where(eq(acctTdsChallans.id, id));
      await tx.update(acctTdsEntries).set({ challanId: null }).where(and(eq(acctTdsEntries.tenantId, tenantId), eq(acctTdsEntries.challanId, id)));
    });
    return { ok: true as const };
  }

  // ================================================================ register, quarterly data, certificate, calendar

  /** Month by month: deducted / collected, deposited, still to deposit, due date and whether it is late. */
  async payable(tenantId: string, q: { fy?: string } = {}) {
    const fy = (q.fy && parseFy(q.fy)) || financialYearOf(this.today());
    const today = this.today();
    const rows = await this.db
      .select({
        kind: acctTdsEntries.kind,
        month: sql<string>`to_char(${acctTdsEntries.date}, 'YYYY-MM')`,
        section: acctTdsEntries.section,
        deducted: sql<string>`coalesce(sum(${acctTdsEntries.amount}), 0)`,
        deposited: sql<string>`coalesce(sum(${acctTdsEntries.amount}) filter (where ${acctTdsEntries.challanId} is not null), 0)`,
        first: sql<string>`min(${acctTdsEntries.date})`,
        n: sql<string>`count(*)`,
      })
      .from(acctTdsEntries)
      .where(and(eq(acctTdsEntries.tenantId, tenantId), eq(acctTdsEntries.status, "active"), gte(acctTdsEntries.date, fy.from), lte(acctTdsEntries.date, fy.to)))
      .groupBy(acctTdsEntries.kind, sql`to_char(${acctTdsEntries.date}, 'YYYY-MM')`, acctTdsEntries.section)
      .orderBy(sql`to_char(${acctTdsEntries.date}, 'YYYY-MM')`);
    const items = rows.map((r) => {
      const due = depositDueDate(r.month, r.kind);
      const balance = num(r.deducted) - num(r.deposited);
      return {
        kind: r.kind,
        month: r.month,
        section: r.section,
        entries: num(r.n),
        deducted: num(r.deducted),
        deposited: num(r.deposited),
        balance,
        dueDate: due,
        status: balance <= 0 ? "paid" : today > due ? "late" : "due",
        interestHint: balance > 0 ? lateInterest(balance, r.first, today, due, r.kind) : 0,
      };
    });
    const accounts = await this.db
      .select({ key: acctAccounts.key, id: acctAccounts.id })
      .from(acctAccounts)
      .where(and(eq(acctAccounts.tenantId, tenantId), inArray(acctAccounts.key, [SYS.tdsPayable, SYS.tcsPayable])));
    const ledger: Record<string, number> = {};
    for (const a of accounts) ledger[a.key!] = 0 - (await this.deps.acct.accountBalance(tenantId, a.id, fy.to < today ? fy.to : today)) || 0;
    return {
      fy: fy.fy,
      items,
      totals: { deducted: items.reduce((t, i) => t + i.deducted, 0), deposited: items.reduce((t, i) => t + i.deposited, 0), balance: items.reduce((t, i) => t + i.balance, 0) },
      ledgerBalance: { tds: ledger[SYS.tdsPayable] ?? 0, tcs: ledger[SYS.tcsPayable] ?? 0 },
    };
  }

  /** Deductee-wise data of a quarter for the quarterly statement (26Q for TDS, 27EQ for TCS). */
  async quarterly(tenantId: string, q: { quarter?: string; kind?: string }) {
    const quarter = (q.quarter && parseQuarter(q.quarter)) || quarterOf(this.today());
    const kind = q.kind === "tcs" ? "tcs" : "tds";
    const settings = await this.getSettings(tenantId);
    const rows = await this.db
      .select({ e: acctTdsEntries, c: acctTdsChallans })
      .from(acctTdsEntries)
      .leftJoin(acctTdsChallans, eq(acctTdsChallans.id, acctTdsEntries.challanId))
      .where(and(eq(acctTdsEntries.tenantId, tenantId), eq(acctTdsEntries.kind, kind), eq(acctTdsEntries.status, "active"), gte(acctTdsEntries.date, quarter.from), lte(acctTdsEntries.date, quarter.to)))
      .orderBy(asc(acctTdsEntries.section), asc(acctTdsEntries.partyName), asc(acctTdsEntries.date));
    const deductees = rows.map(({ e, c }) => ({
      id: e.id,
      section: SECTION_BY_KEY[e.section]?.section ?? e.section,
      sectionKey: e.section,
      partyName: e.partyName,
      pan: e.pan ?? "PANNOTAVBL",
      noPan: e.noPan,
      date: e.date,
      base: e.base,
      rate: e.rate,
      amount: e.amount,
      deductedOn: e.date,
      bsrCode: c?.bsrCode ?? null,
      challanNo: c?.challanNo ?? null,
      challanDate: c?.date ?? null,
      deposited: !!c && c.status === "active",
      reference: e.sourceRef,
    }));
    const bySection = new Map<string, { section: string; count: number; base: number; amount: number; deposited: number }>();
    for (const d of deductees) {
      const s = bySection.get(d.section) ?? { section: d.section, count: 0, base: 0, amount: 0, deposited: 0 };
      s.count++;
      s.base += d.base;
      s.amount += d.amount;
      if (d.deposited) s.deposited += d.amount;
      bySection.set(d.section, s);
    }
    const due = quarterDueDates(quarter, kind);
    const missingPan = deductees.filter((d) => d.noPan).length;
    return {
      quarter: quarter.key,
      from: quarter.from,
      to: quarter.to,
      kind,
      form: kind === "tcs" ? "27EQ" : "26Q",
      tan: settings.tan,
      deductorName: settings.deductorName,
      deductees,
      sections: [...bySection.values()],
      totals: { count: deductees.length, base: deductees.reduce((t, d) => t + d.base, 0), amount: deductees.reduce((t, d) => t + d.amount, 0), deposited: deductees.filter((d) => d.deposited).reduce((t, d) => t + d.amount, 0) },
      returnDue: due.returnDue,
      certificateDue: due.certificateDue,
      issues: [
        ...(settings.tan ? [] : ["Add your TAN in the TDS settings."]),
        ...(missingPan ? [`${missingPan} deduction(s) without a PAN (the higher rate applies; the return shows PANNOTAVBL).`] : []),
        ...(deductees.some((d) => !d.deposited) ? ["Some tax of this quarter is not yet deposited by challan."] : []),
      ],
      note: "This is the data for the quarterly statement. The return itself is prepared with the Return Preparation Utility and checked with the File Validation Utility (FVU) of Protean (NSDL), or by your CA; this product does not create the FVU file or file it.",
    };
  }

  quarterlyTable(data: Awaited<ReturnType<TdsService["quarterly"]>>, shop: string): ReportTable {
    return {
      title: `${data.form} data - ${data.quarter}`,
      subtitle: `${shop ? `${shop} · ` : ""}${data.tan ? `TAN ${data.tan} · ` : ""}${data.from} to ${data.to}`,
      columns: [
        { key: "section", label: "Section" },
        { key: "party", label: data.kind === "tcs" ? "Collectee" : "Deductee" },
        { key: "pan", label: "PAN" },
        { key: "date", label: data.kind === "tcs" ? "Date of receipt / debit" : "Date of payment / credit" },
        { key: "base", label: "Amount paid / credited (₹)", kind: "money" },
        { key: "rate", label: "Rate %" },
        { key: "amount", label: data.kind === "tcs" ? "Tax collected (₹)" : "Tax deducted (₹)", kind: "money" },
        { key: "on", label: data.kind === "tcs" ? "Date collected" : "Date deducted" },
        { key: "bsr", label: "BSR code" },
        { key: "challan", label: "Challan no." },
        { key: "challanDate", label: "Challan date" },
        { key: "ref", label: "Bill / reference" },
      ],
      rows: data.deductees.map((d) => ({
        cells: { section: d.section, party: d.partyName, pan: d.pan, date: d.date, base: d.base, rate: (d.rate / 100).toFixed(2), amount: d.amount, on: d.deductedOn, bsr: d.bsrCode, challan: d.challanNo, challanDate: d.challanDate, ref: d.reference },
      })),
      notes: [data.note],
    };
  }

  /** Form 16A / 27D style summary for one party and quarter (a summary, not the TRACES certificate). */
  async certificate(tenantId: string, q: { partyType?: string; partyId?: string; partyName?: string; quarter?: string; kind?: string }): Promise<ReportTable> {
    const data = await this.quarterly(tenantId, { quarter: q.quarter, kind: q.kind });
    const shop = (await this.deps.shopName?.(tenantId)) ?? "";
    const rows = await this.db
      .select({ id: acctTdsEntries.id })
      .from(acctTdsEntries)
      .where(
        and(
          eq(acctTdsEntries.tenantId, tenantId),
          q.partyId && uuid.safeParse(q.partyId).success ? eq(acctTdsEntries.partyId, q.partyId) : q.partyName ? eq(acctTdsEntries.partyName, q.partyName) : sql`false`,
        ),
      );
    const ids = new Set(rows.map((r) => r.id));
    const mine = data.deductees.filter((d) => ids.has(d.id));
    if (!mine.length) throw notFound("Deductions for this party in the quarter");
    const party = mine[0]!;
    const total = mine.reduce((t, d) => t + d.amount, 0);
    return {
      title: `${data.kind === "tcs" ? "TCS" : "TDS"} certificate summary - ${data.quarter}`,
      subtitle: `${shop || data.deductorName || "Deductor"}${data.tan ? ` (TAN ${data.tan})` : ""} to ${party.partyName} (PAN ${party.pan}) · ${data.from} to ${data.to}`,
      columns: [
        { key: "section", label: "Section" },
        { key: "date", label: "Date" },
        { key: "ref", label: "Bill / reference" },
        { key: "base", label: "Amount (₹)", kind: "money" },
        { key: "rate", label: "Rate %" },
        { key: "amount", label: "Tax (₹)", kind: "money" },
        { key: "challan", label: "Deposited (BSR / challan / date)" },
      ],
      rows: [
        ...mine.map((d) => ({
          cells: { section: d.section, date: d.date, ref: d.reference, base: d.base, rate: (d.rate / 100).toFixed(2), amount: d.amount, challan: d.deposited ? `${d.bsrCode} / ${d.challanNo} / ${d.challanDate}` : "Not yet deposited" },
        })),
        { cells: { section: "Total", date: "", ref: "", base: mine.reduce((t, d) => t + d.base, 0), rate: "", amount: total, challan: "" }, style: "total" as const },
      ],
      notes: [
        `This is a summary prepared from the shop's books. It is NOT Form ${data.kind === "tcs" ? "27D" : "16A"}: the certificate must be downloaded from the TRACES portal after the quarterly statement (${data.form}) is filed. Tax credit appears in the deductee's Form 26AS / AIS only after filing.`,
      ],
    };
  }

  /** Coming due dates (deposits by the 7th, quarterly statements, certificates) and what needs attention. */
  async calendar(tenantId: string) {
    const today = this.today();
    const settings = await this.getSettings(tenantId);
    const fy = financialYearOf(today);
    const prevFy = financialYearOf(`${fy.startYear - 1}-06-01`);
    const [cur, prev] = await Promise.all([this.payable(tenantId, { fy: fy.fy }), this.payable(tenantId, { fy: prevFy.fy })]);
    const deposits = [...prev.items, ...cur.items]
      .filter((i) => i.balance > 0)
      .map((i) => ({ kind: i.kind, month: i.month, section: SECTION_BY_KEY[i.section]?.section ?? i.section, what: `Deposit ${i.kind.toUpperCase()} of ${i.month} (u/s ${SECTION_BY_KEY[i.section]?.section ?? i.section})`, due: i.dueDate, amount: i.balance, late: today > i.dueDate }));
    const kinds: ("tds" | "tcs")[] = settings.tcsEnabled ? ["tds", "tcs"] : ["tds"];
    const quarters = [quarterOf(today), quarterOf(new Date(Date.parse(`${quarterOf(today).from}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10))];
    const returns = [];
    for (const k of kinds) {
      for (const q of quarters) {
        const d = quarterDueDates(q, k);
        returns.push({ kind: k, quarter: q.key, form: k === "tcs" ? "27EQ" : "26Q", what: `${k === "tcs" ? "27EQ" : "26Q"} statement for ${q.key}`, due: d.returnDue, certificateDue: d.certificateDue, late: today > d.returnDue });
      }
    }
    const noPan = await this.db
      .select({ n: sql<string>`count(distinct ${acctTdsEntries.partyName})` })
      .from(acctTdsEntries)
      .where(and(eq(acctTdsEntries.tenantId, tenantId), eq(acctTdsEntries.status, "active"), eq(acctTdsEntries.noPan, true), gte(acctTdsEntries.date, fy.from)));
    const alerts = [
      ...(settings.enabled && !settings.tan ? ["Add your TAN (Tax Deduction Account Number) in the TDS settings."] : []),
      ...deposits.filter((d) => d.late).map((d) => `${d.what} was due on ${d.due}: interest runs at 1.5% a month (section 201(1A)).`),
      ...(num(noPan[0]?.n) > 0 ? [`${num(noPan[0]?.n)} payee(s) this year have no PAN: the higher rate applies.`] : []),
    ];
    return { today, deposits: deposits.sort((a, b) => a.due.localeCompare(b.due)), returns: returns.sort((a, b) => a.due.localeCompare(b.due)), alerts };
  }
}

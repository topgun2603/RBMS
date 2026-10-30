/**
 * Fixed asset register and depreciation (Part B), and the financial-year close.
 *
 * Depreciation: one journal per run, Dr Depreciation / Cr Accumulated depreciation, for every active asset from the
 * day after its last posted depreciation (or the day it came into use) to the run date, never twice for the same days.
 * Disposal: depreciation up to the day before, then Dr money account (sale) + Dr Accumulated depreciation, Cr the
 * asset account at cost, the difference to Profit or loss on sale of assets.
 *
 * Year-end close: income and expense accounts of the year are moved to Retained earnings by a closing journal dated
 * the last day of the year (with the stock account brought to the valued closing stock), the books are locked to that
 * date, and the next year opens with the balance sheet figures. Re-opening reverses the closing journal and puts the
 * lock back; both are recorded with who and why.
 */
import { badRequest, conflict, notFound } from "@rbms/core";
import type { Db } from "@rbms/db";
import { isValidDate } from "@rbms/gst";
import { and, asc, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { addDays, closingLines, depreciationBetween, disposalResult, yearSchedule, type AssetForDepreciation } from "./assets-logic";
import { SYS } from "./chart";
import { acctEntries, acctLockLog, acctSettings } from "./schema";
import { acctBankLines, acctDepreciation, acctFixedAssets, acctTdsEntries, acctYearCloses, DEPRECIATION_METHODS, type AcctFixedAsset } from "./schema-b";
import type { AccountingService } from "./service";
import { financialYearOf, parseFy } from "./tds-rules";

const date = z.string().refine(isValidDate, "Use a YYYY-MM-DD date");
const uuid = z.string().uuid();
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const num = (v: unknown) => Number(v ?? 0);

export const assetInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    assetAccountId: uuid,
    purchaseDate: date,
    inUseFrom: date.optional(),
    cost: z.number().int().positive().max(2_000_000_000),
    salvage: z.number().int().min(0).max(2_000_000_000).default(0),
    method: z.enum(DEPRECIATION_METHODS),
    rate: z.number().int().min(1).max(10_000).nullish(),
    lifeMonths: z.number().int().min(1).max(1200).nullish(),
    openingDepreciation: z.number().int().min(0).max(2_000_000_000).default(0),
    /** "purchase": post Dr asset / Cr `paidFromAccountId` now; "existing": the cost is already in the books. */
    record: z.enum(["purchase", "existing"]).default("existing"),
    paidFromAccountId: uuid.nullish(),
    note: optText(300),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.method === "wdv" && !v.rate) ctx.addIssue({ code: "custom", path: ["rate"], message: "Give the yearly rate for written-down value" });
    if (v.method === "slm" && !v.rate && !v.lifeMonths) ctx.addIssue({ code: "custom", path: ["lifeMonths"], message: "Give the useful life or the yearly rate" });
    if (v.salvage >= v.cost) ctx.addIssue({ code: "custom", path: ["salvage"], message: "The residual value must be less than the cost" });
    if (v.openingDepreciation > v.cost - v.salvage) ctx.addIssue({ code: "custom", path: ["openingDepreciation"], message: "More than can be depreciated" });
    if (v.record === "purchase" && !v.paidFromAccountId) ctx.addIssue({ code: "custom", path: ["paidFromAccountId"], message: "Choose how it was paid (a bank, cash or Suppliers)" });
    if (v.record === "purchase" && v.openingDepreciation > 0) ctx.addIssue({ code: "custom", path: ["openingDepreciation"], message: "A new purchase has no earlier depreciation" });
  });

export const assetPatch = z.object({ name: z.string().trim().min(1).max(120).optional(), note: optText(300) }).strict();

export const disposeInput = z.object({ date, saleAmount: z.number().int().min(0).max(2_000_000_000), receivedInAccountId: uuid.nullish(), note: optText(300) }).strict();

const asDep = (a: AcctFixedAsset): AssetForDepreciation => ({ cost: a.cost, salvage: a.salvage, method: a.method, rate: a.rate, lifeMonths: a.lifeMonths, inUseFrom: a.inUseFrom, disposedOn: a.disposedOn });

export class AssetService {
  constructor(private readonly deps: { db: Db; acct: AccountingService }) {}
  private get db() {
    return this.deps.db;
  }
  private today() {
    return this.deps.acct.today();
  }

  private async posted(tenantId: string, ids?: string[]) {
    const rows = await this.db
      .select({ assetId: acctDepreciation.assetId, total: sql<string>`coalesce(sum(${acctDepreciation.amount}), 0)`, last: sql<string | null>`max(${acctDepreciation.periodEnd})` })
      .from(acctDepreciation)
      .where(and(eq(acctDepreciation.tenantId, tenantId), eq(acctDepreciation.status, "posted"), ids?.length ? inArray(acctDepreciation.assetId, ids) : undefined))
      .groupBy(acctDepreciation.assetId);
    return new Map(rows.map((r) => [r.assetId, { total: num(r.total), last: r.last }]));
  }

  /** Depreciation already charged in the financial year of `d`, before `d` (WDV works on the year's opening value). */
  private async chargedInYearBefore(tenantId: string, assetId: string, d: string) {
    const fy = financialYearOf(d);
    const [r] = await this.db
      .select({ t: sql<string>`coalesce(sum(${acctDepreciation.amount}), 0)` })
      .from(acctDepreciation)
      .where(and(eq(acctDepreciation.tenantId, tenantId), eq(acctDepreciation.assetId, assetId), eq(acctDepreciation.status, "posted"), sql`${acctDepreciation.periodStart} >= ${fy.from}`, sql`${acctDepreciation.periodEnd} < ${d}`));
    return num(r?.t);
  }

  async list(tenantId: string, q: { asOf?: string } = {}) {
    const asOf = q.asOf && isValidDate(q.asOf) ? q.asOf : this.today();
    const items = await this.db.select().from(acctFixedAssets).where(eq(acctFixedAssets.tenantId, tenantId)).orderBy(asc(acctFixedAssets.purchaseDate), asc(acctFixedAssets.name));
    const posted = await this.posted(tenantId);
    const accounts = await this.deps.acct.listAccounts(tenantId);
    return {
      asOf,
      items: items.map((a) => {
        const p = posted.get(a.id);
        const accumulated = a.openingDepreciation + (p?.total ?? 0);
        const from = p?.last ? addDays(p.last, 1) : a.inUseFrom;
        const due = a.status === "active" ? depreciationBetween(asDep(a), from, asOf, accumulated, 0).reduce((t, x) => t + x.amount, 0) : 0;
        return { ...a, accountName: accounts.find((x) => x.id === a.assetAccountId)?.name ?? "", accumulated, bookValue: a.cost - accumulated, depreciatedTo: p?.last ?? null, dueNow: due };
      }),
    };
  }

  async create(tenantId: string, input: z.input<typeof assetInput>, userId: string | null) {
    const p = assetInput.parse(input);
    const acct = await this.deps.acct.getAccount(tenantId, p.assetAccountId);
    if (acct.group !== "fixed_assets" || acct.key === SYS.accumulatedDepreciation) throw badRequest("Choose a fixed-asset account (Furniture and equipment, Vehicles or one you added under Fixed assets)");
    const inUseFrom = p.inUseFrom ?? p.purchaseDate;
    if (inUseFrom < p.purchaseDate) throw badRequest("It can't be in use before it was bought");
    const id = randomUUID();
    await this.db.transaction(async (tx) => {
      let purchaseEntryId: string | null = null;
      if (p.record === "purchase") {
        const from = await this.deps.acct.getAccount(tenantId, p.paidFromAccountId!);
        if (from.id === acct.id) throw badRequest("Choose how it was paid");
        // Suppliers / customers control accounts must agree with Payables and the credit book, so not from here.
        if (from.key === SYS.creditors || from.key === SYS.debtors) throw badRequest("Choose the cash or bank account (or a loan) it was paid from. Bought on credit from a supplier? Record it as paid when you pay.");
        purchaseEntryId = await this.deps.acct.postModuleEntry(
          tenantId,
          {
            sourceType: "asset_purchase",
            sourceId: id,
            date: p.purchaseDate,
            narration: `Fixed asset bought: ${p.name}`,
            lines: [
              { accountId: acct.id, debit: p.cost, credit: 0 },
              { accountId: from.id, debit: 0, credit: p.cost },
            ],
          },
          { tx, userId },
        );
      }
      if (p.openingDepreciation > 0) {
        const start = (await this.deps.acct.settings(tenantId, tx)).startDate;
        await this.deps.acct.postModuleEntry(
          tenantId,
          {
            sourceType: "asset_opening",
            sourceId: id,
            // Dated when the books start (or when bought, if later): it belongs to the opening balances.
            date: start && start > p.purchaseDate ? start : p.purchaseDate,
            narration: `Depreciation charged before these books: ${p.name}`,
            lines: [
              { accountId: await this.deps.acct.accountIdByKey(tenantId, SYS.openingEquity, tx), debit: p.openingDepreciation, credit: 0 },
              { accountId: await this.deps.acct.accountIdByKey(tenantId, SYS.accumulatedDepreciation, tx), debit: 0, credit: p.openingDepreciation },
            ],
          },
          { tx, userId },
        );
      }
      await tx.insert(acctFixedAssets).values({
        id,
        tenantId,
        name: p.name,
        assetAccountId: acct.id,
        purchaseDate: p.purchaseDate,
        inUseFrom,
        cost: p.cost,
        salvage: p.salvage,
        method: p.method,
        rate: p.rate ?? null,
        lifeMonths: p.lifeMonths ?? null,
        openingDepreciation: p.openingDepreciation,
        purchaseEntryId,
        note: p.note,
        createdBy: userId,
      });
    });
    return this.get(tenantId, id);
  }

  async get(tenantId: string, id: string) {
    const [a] = await this.db.select().from(acctFixedAssets).where(and(eq(acctFixedAssets.tenantId, tenantId), eq(acctFixedAssets.id, id))).limit(1);
    if (!a) throw notFound("Asset");
    const runs = await this.db.select().from(acctDepreciation).where(and(eq(acctDepreciation.tenantId, tenantId), eq(acctDepreciation.assetId, id))).orderBy(asc(acctDepreciation.periodEnd));
    const accumulated = a.openingDepreciation + runs.filter((r) => r.status === "posted").reduce((t, r) => t + r.amount, 0);
    return { ...a, accumulated, bookValue: a.cost - accumulated, runs };
  }

  async update(tenantId: string, id: string, input: z.input<typeof assetPatch>) {
    const p = assetPatch.parse(input);
    await this.get(tenantId, id);
    if (Object.keys(p).length) await this.db.update(acctFixedAssets).set(p).where(and(eq(acctFixedAssets.tenantId, tenantId), eq(acctFixedAssets.id, id)));
    return this.get(tenantId, id);
  }

  /** What a run up to `upTo` would post, asset by asset. */
  async preview(tenantId: string, upTo: string) {
    if (!isValidDate(upTo)) throw badRequest("Use a YYYY-MM-DD date");
    const assets = await this.db.select().from(acctFixedAssets).where(and(eq(acctFixedAssets.tenantId, tenantId), eq(acctFixedAssets.status, "active")));
    const posted = await this.posted(tenantId);
    const out = [];
    for (const a of assets) {
      const p = posted.get(a.id);
      const from = p?.last ? addDays(p.last, 1) : a.inUseFrom;
      if (from > upTo) continue;
      const pieces = depreciationBetween(asDep(a), from, upTo, a.openingDepreciation + (p?.total ?? 0), await this.chargedInYearBefore(tenantId, a.id, from));
      const amount = pieces.reduce((t, x) => t + x.amount, 0);
      if (amount > 0) out.push({ assetId: a.id, name: a.name, from, to: upTo, amount, pieces });
    }
    return { upTo, items: out, total: out.reduce((t, x) => t + x.amount, 0) };
  }

  /** Posts depreciation up to a date for every asset (one journal). Safe to repeat: posted days are never charged again. */
  async run(tenantId: string, input: { upTo: string; dryRun?: boolean }, userId: string | null) {
    const p = z.object({ upTo: date, dryRun: z.boolean().optional() }).strict().parse(input);
    if (p.upTo > this.today()) throw badRequest("Depreciation can be posted up to today, not later");
    const plan = await this.preview(tenantId, p.upTo);
    if (p.dryRun || plan.items.length === 0) return { ...plan, posted: false, entryId: null };
    const runId = randomUUID();
    const depAcct = await this.deps.acct.accountIdByKey(tenantId, SYS.depreciation);
    const accAcct = await this.deps.acct.accountIdByKey(tenantId, SYS.accumulatedDepreciation);
    const entryId = await this.db.transaction(async (tx) => {
      const id = await this.deps.acct.postModuleEntry(
        tenantId,
        {
          sourceType: "depreciation",
          sourceId: runId,
          date: p.upTo,
          narration: `Depreciation up to ${p.upTo} (${plan.items.length} asset${plan.items.length === 1 ? "" : "s"})`,
          lines: [
            ...plan.items.map((i) => ({ accountId: depAcct, debit: i.amount, credit: 0, memo: i.name })),
            { accountId: accAcct, debit: 0, credit: plan.total },
          ],
        },
        { tx, userId },
      );
      await tx.insert(acctDepreciation).values(plan.items.map((i) => ({ tenantId, assetId: i.assetId, periodStart: i.from, periodEnd: i.to, amount: i.amount, entryId: id })));
      return id;
    });
    return { ...plan, posted: true, entryId };
  }

  /** Cancels the last depreciation run (all its assets), e.g. to post it again after a correction. */
  async cancelRun(tenantId: string, entryId: string, userId: string | null) {
    const rows = await this.db.select().from(acctDepreciation).where(and(eq(acctDepreciation.tenantId, tenantId), eq(acctDepreciation.entryId, entryId), eq(acctDepreciation.status, "posted")));
    if (!rows.length) throw notFound("Depreciation run");
    for (const r of rows) {
      const [later] = await this.db
        .select({ id: acctDepreciation.id })
        .from(acctDepreciation)
        .where(and(eq(acctDepreciation.tenantId, tenantId), eq(acctDepreciation.assetId, r.assetId), eq(acctDepreciation.status, "posted"), sql`${acctDepreciation.periodEnd} > ${r.periodEnd}`))
        .limit(1);
      if (later) throw conflict("Cancel the later depreciation runs first");
    }
    await this.db.transaction(async (tx) => {
      await this.deps.acct.reverseModuleEntry(tenantId, entryId, { date: rows[0]!.periodEnd, reason: "Depreciation run cancelled", sourceType: "depreciation_reversal" }, { tx, userId });
      await tx.update(acctDepreciation).set({ status: "cancelled" }).where(and(eq(acctDepreciation.tenantId, tenantId), eq(acctDepreciation.entryId, entryId)));
    });
    return { ok: true as const };
  }

  async runs(tenantId: string) {
    const rows = await this.db
      .select({ entryId: acctDepreciation.entryId, upTo: sql<string>`max(${acctDepreciation.periodEnd})`, total: sql<string>`sum(${acctDepreciation.amount})`, assets: sql<string>`count(*)`, status: sql<string>`max(${acctDepreciation.status})`, number: acctEntries.number })
      .from(acctDepreciation)
      .innerJoin(acctEntries, eq(acctEntries.id, acctDepreciation.entryId))
      .where(eq(acctDepreciation.tenantId, tenantId))
      .groupBy(acctDepreciation.entryId, acctEntries.number)
      .orderBy(desc(sql`max(${acctDepreciation.periodEnd})`))
      .limit(100);
    return { items: rows.map((r) => ({ ...r, total: num(r.total), assets: num(r.assets) })) };
  }

  /** Sells or scraps an asset: depreciation to the day before, then the disposal entry with the gain or loss. */
  async dispose(tenantId: string, id: string, input: z.input<typeof disposeInput>, userId: string | null) {
    const p = disposeInput.parse(input);
    const a = await this.get(tenantId, id);
    if (a.status !== "active") throw conflict("This asset is already sold or scrapped");
    if (p.date < a.purchaseDate) throw badRequest("It can't be sold before it was bought");
    if (p.saleAmount > 0 && !p.receivedInAccountId) throw badRequest("Choose where the money was received");
    // Depreciation up to the day before the sale.
    const dayBefore = addDays(p.date, -1);
    const posted = (await this.posted(tenantId, [id])).get(id);
    const from = posted?.last ? addDays(posted.last, 1) : a.inUseFrom;
    const catchUp = from <= dayBefore ? depreciationBetween(asDep(a), from, dayBefore, a.accumulated, await this.chargedInYearBefore(tenantId, id, from)) : [];
    const extra = catchUp.reduce((t, x) => t + x.amount, 0);
    const accumulated = a.accumulated + extra;
    const { gain, bookValue } = disposalResult(a.cost, accumulated, p.saleAmount);
    const [depAcct, accAcct, gainAcct] = await Promise.all([
      this.deps.acct.accountIdByKey(tenantId, SYS.depreciation),
      this.deps.acct.accountIdByKey(tenantId, SYS.accumulatedDepreciation),
      this.deps.acct.accountIdByKey(tenantId, SYS.assetDisposal),
    ]);
    const money = p.receivedInAccountId ? await this.deps.acct.getAccount(tenantId, p.receivedInAccountId) : null;
    await this.db.transaction(async (tx) => {
      if (extra > 0) {
        const runId = randomUUID();
        const dep = await this.deps.acct.postModuleEntry(
          tenantId,
          {
            sourceType: "depreciation",
            sourceId: runId,
            date: dayBefore,
            narration: `Depreciation up to ${dayBefore} before sale: ${a.name}`,
            lines: [
              { accountId: depAcct, debit: extra, credit: 0, memo: a.name },
              { accountId: accAcct, debit: 0, credit: extra },
            ],
          },
          { tx, userId },
        );
        await tx.insert(acctDepreciation).values({ tenantId, assetId: id, periodStart: from, periodEnd: dayBefore, amount: extra, entryId: dep });
      }
      const disposalId = await this.deps.acct.postModuleEntry(
        tenantId,
        {
          sourceType: "asset_disposal",
          sourceId: id,
          date: p.date,
          narration: `${p.saleAmount > 0 ? "Sold" : "Scrapped"}: ${a.name} (value in the books ₹${(bookValue / 100).toFixed(2)})`,
          lines: [
            ...(money && p.saleAmount > 0 ? [{ accountId: money.id, debit: p.saleAmount, credit: 0 }] : []),
            ...(accumulated > 0 ? [{ accountId: accAcct, debit: accumulated, credit: 0 }] : []),
            { accountId: a.assetAccountId, debit: 0, credit: a.cost },
            ...(gain !== 0 ? [gain > 0 ? { accountId: gainAcct, debit: 0, credit: gain } : { accountId: gainAcct, debit: -gain, credit: 0 }] : []),
          ],
        },
        { tx, userId },
      );
      await tx.update(acctFixedAssets).set({ status: "disposed", disposedOn: p.date, saleAmount: p.saleAmount, disposalEntryId: disposalId, note: p.note ?? a.note }).where(eq(acctFixedAssets.id, id));
    });
    return this.get(tenantId, id);
  }

  /** Year schedule: opening value, depreciation of the year, closing value per asset. */
  async schedule(tenantId: string, q: { fy?: string }) {
    const fy = (q.fy && parseFy(q.fy)) || financialYearOf(this.today());
    const assets = await this.db.select().from(acctFixedAssets).where(eq(acctFixedAssets.tenantId, tenantId)).orderBy(asc(acctFixedAssets.purchaseDate));
    const before = await this.db
      .select({ assetId: acctDepreciation.assetId, t: sql<string>`coalesce(sum(${acctDepreciation.amount}), 0)` })
      .from(acctDepreciation)
      .where(and(eq(acctDepreciation.tenantId, tenantId), eq(acctDepreciation.status, "posted"), sql`${acctDepreciation.periodEnd} < ${fy.from}`))
      .groupBy(acctDepreciation.assetId);
    const during = await this.db
      .select({ assetId: acctDepreciation.assetId, t: sql<string>`coalesce(sum(${acctDepreciation.amount}), 0)` })
      .from(acctDepreciation)
      .where(and(eq(acctDepreciation.tenantId, tenantId), eq(acctDepreciation.status, "posted"), sql`${acctDepreciation.periodEnd} >= ${fy.from}`, sql`${acctDepreciation.periodEnd} <= ${fy.to}`))
      .groupBy(acctDepreciation.assetId);
    const items = assets
      .filter((a) => a.purchaseDate <= fy.to && (!a.disposedOn || a.disposedOn >= fy.from))
      .map((a) => {
        const accBefore = a.openingDepreciation + num(before.find((b) => b.assetId === a.id)?.t);
        const plan = yearSchedule(asDep(a), fy.from, fy.to, accBefore);
        const postedThisYear = num(during.find((b) => b.assetId === a.id)?.t);
        return { id: a.id, name: a.name, method: a.method, rate: a.rate, lifeMonths: a.lifeMonths, cost: a.cost, opening: plan.opening, planned: plan.depreciation, posted: postedThisYear, closing: plan.opening - Math.max(postedThisYear, 0), status: a.status, disposedOn: a.disposedOn };
      });
    return { fy: fy.fy, from: fy.from, to: fy.to, items, totals: { cost: items.reduce((t, i) => t + i.cost, 0), planned: items.reduce((t, i) => t + i.planned, 0), posted: items.reduce((t, i) => t + i.posted, 0) } };
  }
}

// ================================================================ year-end close

export class YearEndService {
  constructor(private readonly deps: { db: Db; acct: AccountingService; assets: AssetService }) {}
  private get db() {
    return this.deps.db;
  }

  /** What closing the year would do, and what to look at first. */
  async preview(tenantId: string, q: { fy?: string }) {
    const today = this.deps.acct.today();
    // Default: the last financial year that has ended.
    const fy = (q.fy && parseFy(q.fy)) || financialYearOf(`${financialYearOf(today).startYear - 1}-06-01`);
    await this.deps.acct.ensureFresh(tenantId);
    const accounts = await this.deps.acct.accountInfos(tenantId);
    const yearBal = await this.deps.acct.balancesBetween(tenantId, fy.from, fy.to, { excludeClosing: true });
    const yearNet = new Map([...yearBal].map(([id, b]) => [id, b.debit - b.credit]));
    const stockAcct = accounts.find((a) => a.key === SYS.stock);
    const stock = await this.deps.acct.stockPart(tenantId, fy.from, fy.to, accounts);
    const reId = await this.deps.acct.accountIdByKey(tenantId, SYS.retainedEarnings);
    const stockAdjustment = stock.enabled && stockAcct ? stock.closing - stock.ledgerNow : 0;
    const plan = closingLines(accounts, yearNet, { retainedEarningsId: reId, stockAccountId: stock.enabled ? (stockAcct?.id ?? null) : null, stockAdjustment });
    const pnl = await this.deps.acct.profitLoss(tenantId, { from: fy.from, to: fy.to });
    const tb = await this.deps.acct.trialBalance(tenantId, { from: fy.from, to: fy.to });
    const settings = await this.deps.acct.settings(tenantId);
    const [closed] = await this.db.select().from(acctYearCloses).where(and(eq(acctYearCloses.tenantId, tenantId), eq(acctYearCloses.fy, fy.fy), eq(acctYearCloses.status, "closed"))).limit(1);
    const history = await this.db.select().from(acctYearCloses).where(eq(acctYearCloses.tenantId, tenantId)).orderBy(desc(acctYearCloses.closedAt)).limit(20);
    const [openBank] = await this.db.select({ n: sql<string>`count(*)` }).from(acctBankLines).where(and(eq(acctBankLines.tenantId, tenantId), eq(acctBankLines.status, "open"), lte(acctBankLines.date, fy.to)));
    const [tdsUnpaid] = await this.db
      .select({ n: sql<string>`count(*)`, amount: sql<string>`coalesce(sum(${acctTdsEntries.amount}), 0)` })
      .from(acctTdsEntries)
      .where(and(eq(acctTdsEntries.tenantId, tenantId), eq(acctTdsEntries.status, "active"), sql`${acctTdsEntries.challanId} is null`, lte(acctTdsEntries.date, fy.to)));
    const dep = await this.deps.assets.preview(tenantId, fy.to < today ? fy.to : today);
    const prevOpen = await this.db
      .select({ fy: acctYearCloses.fy })
      .from(acctYearCloses)
      .where(and(eq(acctYearCloses.tenantId, tenantId), eq(acctYearCloses.status, "closed")));
    const checks = [
      { key: "trial_balance", ok: tb.balanced, label: "The trial balance agrees (debits = credits)", date: fy.to, count: 0, amount: 0 },
      { key: "year_over", ok: fy.to < today, label: `The year has ended (${fy.to})`, date: fy.to, count: 0, amount: 0 },
      { key: "bank", ok: num(openBank?.n) === 0, label: `Bank statement lines up to ${fy.to} not yet matched: ${num(openBank?.n)}`, date: fy.to, count: num(openBank?.n), amount: 0 },
      { key: "tds", ok: num(tdsUnpaid?.n) === 0, label: `TDS/TCS of the year not yet deposited: ₹${(num(tdsUnpaid?.amount) / 100).toFixed(2)}`, date: fy.to, count: num(tdsUnpaid?.n), amount: num(tdsUnpaid?.amount) },
      {
        key: "depreciation",
        ok: dep.items.length === 0,
        label: dep.items.length ? `Depreciation not yet posted to ${fy.to}: ₹${(dep.total / 100).toFixed(2)} on ${dep.items.length} asset(s)` : "Depreciation is posted for the year",
        date: fy.to,
        count: dep.items.length,
        amount: dep.total,
      },
    ];
    return {
      fy: fy.fy,
      from: fy.from,
      to: fy.to,
      closed: closed ?? null,
      lockedThrough: settings.lockedThrough,
      netProfit: plan.netProfit,
      pnlNetProfit: pnl.netProfit,
      stockAdjustment: plan.stockAdjustment,
      lines: plan.lines.map((l) => ({ ...l, account: accounts.find((a) => a.id === l.accountId)?.name ?? "" })),
      checks,
      blocking: checks.filter((c) => c.key === "trial_balance" || c.key === "year_over").filter((c) => !c.ok).map((c) => c.key),
      closedYears: prevOpen.map((r) => r.fy),
      history,
    };
  }

  /** Closes the year: closing journal on the last day, lock to that day (if the lock is earlier), recorded. */
  async close(tenantId: string, input: { fy: string; note?: string | null }, userId: string | null) {
    const p = z.object({ fy: z.string(), note: optText(300) }).strict().parse(input);
    const pre = await this.preview(tenantId, { fy: p.fy });
    if (pre.closed) throw conflict(`${pre.fy} is already closed`);
    if (pre.blocking.length) throw badRequest(pre.blocking.includes("year_over") ? "The year has not ended yet" : "The trial balance does not agree; fix that first");
    const id = randomUUID();
    const s = await this.deps.acct.settings(tenantId);
    await this.db.transaction(async (tx) => {
      let entryId: string | null = null;
      if (pre.lines.length >= 2) {
        entryId = await this.deps.acct.postModuleEntry(
          tenantId,
          { sourceType: "year_close", sourceId: id, date: pre.to, narration: `Year-end close ${pre.fy}: profit ₹${(pre.netProfit / 100).toFixed(2)} to retained earnings`, lines: pre.lines },
          { tx, userId, ignoreLock: true },
        );
      }
      await tx.insert(acctYearCloses).values({ id, tenantId, fy: pre.fy, fromDate: pre.from, toDate: pre.to, netProfit: pre.netProfit, stockAdjustment: pre.stockAdjustment, entryId, previousLock: s.lockedThrough, closedBy: userId, note: p.note });
      if (!s.lockedThrough || s.lockedThrough < pre.to) {
        await tx.update(acctSettings).set({ lockedThrough: pre.to }).where(eq(acctSettings.tenantId, tenantId));
        await tx.insert(acctLockLog).values({ tenantId, lockedThrough: pre.to, previous: s.lockedThrough ?? null, reason: `Year-end close ${pre.fy}${p.note ? `: ${p.note}` : ""}`, userId });
      }
    });
    return this.preview(tenantId, { fy: pre.fy });
  }

  /** Re-opens a closed year: reverses its closing journal (same date) and moves the lock back. Needs accounting.lock. */
  async reopen(tenantId: string, input: { fy: string; reason: string }, userId: string | null) {
    const p = z.object({ fy: z.string(), reason: z.string().trim().min(3, "Say why").max(300) }).strict().parse(input);
    const fy = parseFy(p.fy);
    if (!fy) throw badRequest("Give the year as 2025-26");
    const [c] = await this.db.select().from(acctYearCloses).where(and(eq(acctYearCloses.tenantId, tenantId), eq(acctYearCloses.fy, fy.fy), eq(acctYearCloses.status, "closed"))).limit(1);
    if (!c) throw notFound("Closed year");
    const [later] = await this.db
      .select({ fy: acctYearCloses.fy })
      .from(acctYearCloses)
      .where(and(eq(acctYearCloses.tenantId, tenantId), eq(acctYearCloses.status, "closed"), sql`${acctYearCloses.toDate} > ${c.toDate}`))
      .limit(1);
    if (later) throw conflict(`Re-open ${later.fy} first`);
    const s = await this.deps.acct.settings(tenantId);
    await this.db.transaction(async (tx) => {
      const rev = c.entryId ? await this.deps.acct.reverseModuleEntry(tenantId, c.entryId, { date: c.toDate, reason: `Year re-opened: ${p.reason}`, sourceType: "year_close_reversal" }, { tx, userId, ignoreLock: true }) : null;
      await tx.update(acctYearCloses).set({ status: "reopened", reversalEntryId: rev, reopenedBy: userId, reopenedAt: new Date(), reopenReason: p.reason }).where(eq(acctYearCloses.id, c.id));
      // Lock back to where it was before the close (never later than now's lock).
      const back = c.previousLock && c.previousLock < c.toDate ? c.previousLock : addDays(c.fromDate, -1);
      if (s.lockedThrough && s.lockedThrough >= c.fromDate) {
        await tx.update(acctSettings).set({ lockedThrough: back }).where(eq(acctSettings.tenantId, tenantId));
        await tx.insert(acctLockLog).values({ tenantId, lockedThrough: back, previous: s.lockedThrough, reason: `Year ${c.fy} re-opened: ${p.reason}`, userId });
      }
    });
    return this.preview(tenantId, { fy: fy.fy });
  }
}

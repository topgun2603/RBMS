import { badRequest, conflict, defineSort, forbidden, listFilter, listQuerySchema, notFound, rangeOrder, runList, searchAny, type ListPage } from "@srirealtime/core";
import type { Db, DbOrTx } from "@srirealtime/db";
import { isValidDate, todayIST } from "@srirealtime/gst";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ACCOUNT_GROUPS, EXPENSE_CATEGORY_CODE_BASE, GROUP_BY_KEY, NORMAL_SIDE, STANDARD_CHART, SYS } from "./chart";
import { CLOSING_SOURCE_TYPES, PART_B_LABELS, PART_B_SOURCE_TYPES, type PartBSourceType } from "./part-b-types";
import type { FeatureGatePort, LoggerPort, MoneyMethod, ReconcilePort, SourcesPort, StockValuePort } from "./ports";
import { noopLogger } from "./ports";
import {
  balanceSheetTable,
  dayBookTable,
  gstTable,
  ledgerTable,
  profitLossTable,
  trialBalanceTable,
} from "./tables";
import {
  buildBalanceSheet,
  buildGstLedger,
  buildLedger,
  buildProfitLoss,
  buildTrialBalance,
  type AccountInfo,
  type Balance,
  type BalanceSheet,
  type GstLedger,
  type Ledger,
  type ProfitLoss,
  type ReportTable,
  type TrialBalance,
} from "./reports-logic";
import {
  accountOpeningPosting,
  creditNotePostings,
  debitNotePostings,
  salesDebitNotePostings,
  effectiveDate,
  expensePostings,
  gstPaymentPostings,
  invoicePaymentPostings,
  invoicePostings,
  isBalanced,
  mirror,
  openingPartiesPosting,
  payrollPostings,
  postingHash,
  purchasePostings,
  receiptPostings,
  SOURCE_LABELS,
  SOURCE_TYPES,
  stockAdjustmentPostings,
  supplierPaymentPostings,
  tillPostings,
  type DraftLine,
  type Posting,
  type RuleOptions,
  type SourceType,
} from "./rules";
import {
  acctAccounts,
  acctEntries,
  acctLines,
  acctLockLog,
  acctSettings,
  ACCOUNT_TYPES,
  IMPORTED_MODES,
  MANUAL_VOUCHER_TYPES,
  PARTY_TYPES,
  type AcctAccount,
  type AcctEntry,
  type AcctSettings,
  type ImportedMode,
  type ManualVoucherType,
} from "./schema";

export interface AccountingDeps {
  db: Db;
  sources: SourcesPort;
  /** Live stock value for the profit and loss and balance sheet; without it stock is not valued. */
  stock?: StockValuePort;
  reconcile?: ReconcilePort;
  features?: FeatureGatePort;
  /** The shop's name for report headings. */
  shopName?: (tenantId: string) => Promise<string>;
  log?: LoggerPort;
  now?: () => Date;
}

export const MAX_PAISE = 2_000_000_000;
const CHUNK = 400;
const FRESH_MS = 20_000;

const date = z.string().refine(isValidDate, "Use a YYYY-MM-DD date");
const paise = z.number().int().min(0).max(MAX_PAISE);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

// ------------------------------------------------------------------ input schemas

export const accountInput = z
  .object({
    code: z.string().trim().regex(/^[A-Za-z0-9._-]{1,12}$/, "Use 1-12 letters, digits, dots or dashes").optional(),
    name: z.string().trim().min(1).max(120),
    type: z.enum(ACCOUNT_TYPES),
    group: z.string().trim().max(40),
    subGroup: optText(60),
    description: optText(300),
    isBank: z.boolean().optional(),
    isCash: z.boolean().optional(),
    bankName: optText(80),
    bankAccountLast4: z
      .string()
      .trim()
      .regex(/^\d{4}$/, "Last 4 digits")
      .nullish()
      .transform((v) => v ?? null),
    bankIfsc: optText(20),
    /** Signed paise, debit-positive (a credit balance is negative). */
    openingBalance: z.number().int().min(-MAX_PAISE).max(MAX_PAISE).optional(),
  })
  .strict();
export type AccountInput = z.input<typeof accountInput>;

export const accountPatch = accountInput.partial().strict().extend({ active: z.boolean().optional() });
export type AccountPatch = z.input<typeof accountPatch>;

const lineInput = z
  .object({
    accountId: z.string().uuid(),
    debit: paise.default(0),
    credit: paise.default(0),
    memo: optText(200),
    partyType: z.enum(PARTY_TYPES).nullish(),
    partyId: z.string().uuid().nullish(),
  })
  .strict();

export const entryInput = z
  .object({
    voucherType: z.enum(MANUAL_VOUCHER_TYPES),
    date,
    narration: z.string().trim().min(1, "Write what this entry is for").max(500),
    reference: optText(80),
    /** A journal voucher lists its lines. */
    lines: z.array(lineInput).max(60).optional(),
    /** Payment / receipt / contra voucher: the money account, the other account and the amount. */
    simple: z
      .object({ accountId: z.string().uuid(), otherAccountId: z.string().uuid(), amount: z.number().int().positive().max(MAX_PAISE) })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => (v.voucherType === "journal" ? !!v.lines?.length : !!v.simple), { message: "Add the lines (journal) or the two accounts and the amount" });
export type EntryInput = z.input<typeof entryInput>;

export const reverseInput = z.object({ date: date.optional(), reason: z.string().trim().min(1, "Say why").max(300) }).strict();
export const lockInput = z.object({ lockedThrough: date.nullable(), reason: optText(300) }).strict();
export const settingsPatch = z
  .object({
    importedBills: z.enum(IMPORTED_MODES).optional(),
    valueStock: z.boolean().optional(),
    startDate: date.nullable().optional(),
    methodAccounts: z.record(z.enum(["cash", "upi", "card", "bank", "cheque", "other"]), z.string().uuid().nullable()).optional(),
  })
  .strict();
export const backfillInput = z.object({ from: date.nullish(), dryRun: z.boolean().optional() }).strict();

const rangeQuery = z
  .object({ from: listFilter.date(), to: listFilter.date() })
  .superRefine(rangeOrder("from", "to"));

export const entryListQuery = listQuerySchema({ defaultLimit: 50, maxLimit: 200 })
  .extend({
    from: listFilter.date(),
    to: listFilter.date(),
    voucherType: listFilter.oneOf([...MANUAL_VOUCHER_TYPES, "auto", "reversal"] as const),
    origin: listFilter.oneOf(["manual", "auto"] as const),
    status: listFilter.oneOf(["posted", "reversed"] as const),
    accountId: listFilter.id(),
    sourceType: listFilter.oneOf([...SOURCE_TYPES, ...PART_B_SOURCE_TYPES] as const),
  })
  .superRefine(rangeOrder("from", "to"));
export type EntryListQuery = z.input<typeof entryListQuery>;

const ENTRY_SORT = defineSort(
  { date: acctEntries.date, number: acctEntries.seq, total: acctEntries.total },
  { default: "date", tieBreaker: [acctEntries.seq, acctEntries.id] },
);

// ------------------------------------------------------------------ types

export interface EntryLineView {
  id: string;
  lineNo: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  memo: string | null;
  partyType: string | null;
  partyId: string | null;
}
export interface EntryView extends AcctEntry {
  /** Plain-language kind: "Journal voucher", "Sales bill", ... */
  kindLabel: string;
  lines: EntryLineView[];
}

export interface SyncResult {
  dryRun: boolean;
  posted: number;
  reversed: number;
  unchanged: number;
  /** Postings moved past a locked period. */
  late: number;
  byType: Record<string, { posted: number; reversed: number; unchanged: number }>;
  errors: { sourceType: string; sourceId: string; message: string }[];
  startDate: string | null;
  postFrom: string | null;
  ms: number;
}

export interface ReconcileCheck {
  key: string;
  label: string;
  /** What the books say, paise. */
  ledger: number;
  /** What the shop's own records say, paise. */
  source: number;
  difference: number;
  ok: boolean;
  note?: string;
  /** Known reasons for a difference, paise (walk-in bills, manual entries, imported history). */
  explained?: { label: string; amount: number }[];
}
export interface PartyDifference {
  partyId: string | null;
  name: string;
  ledger: number;
  source: number;
  difference: number;
}

const fyStart = (d: string) => {
  const y = Number(d.slice(0, 4));
  return Number(d.slice(5, 7)) >= 4 ? `${y}-04-01` : `${y - 1}-04-01`;
};
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const num = (v: unknown) => Number(v ?? 0);
const chunks = <T>(a: readonly T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
};

const VOUCHER_PREFIX: Record<string, string> = { journal: "JV", contra: "CV", payment: "PV", receipt: "RV", auto: "AU", reversal: "RE" };

// ------------------------------------------------------------------ service

export class AccountingService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;
  private readonly ready = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly fresh = new Map<string, number>();
  private readonly running = new Map<string, Promise<unknown>>();
  /** Part B reports (bank reconciliation, TDS data and certificates) for the CSV / PDF downloads; set by createAccounting. */
  extraReport?: (tenantId: string, report: string, q: Record<string, string | undefined>, shop: string) => Promise<ReportTable | null>;

  constructor(private readonly deps: AccountingDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  today(): string {
    return todayIST(this.now());
  }

  // ================================================================ setup

  /** Seeds the chart and the settings row for a shop on first use (idempotent, safe to race). */
  async ensureInit(tenantId: string): Promise<AcctSettings> {
    if (this.ready.has(tenantId)) return this.settings(tenantId);
    const existing = await this.db.select().from(acctSettings).where(eq(acctSettings.tenantId, tenantId)).limit(1);
    const hasAccounts = existing[0]
      ? (await this.db.select({ id: acctAccounts.id }).from(acctAccounts).where(eq(acctAccounts.tenantId, tenantId)).limit(1)).length > 0
      : false;
    if (existing[0] && hasAccounts) {
      const [have] = await this.db.select({ n: sql<string>`count(*)` }).from(acctAccounts).where(and(eq(acctAccounts.tenantId, tenantId), eq(acctAccounts.system, true)));
      if (num(have?.n) < STANDARD_CHART.filter((c) => c.key).length) await this.seedChart(tenantId);
      this.ready.add(tenantId);
      return existing[0];
    }
    const row = await this.db.transaction(async (tx) => {
      await this.lockTenant(tx, tenantId);
      await tx.insert(acctSettings).values({ tenantId }).onConflictDoNothing();
      await this.insertChart(tx, tenantId);
      const [s] = await tx.select().from(acctSettings).where(eq(acctSettings.tenantId, tenantId)).limit(1);
      return s!;
    });
    this.ready.add(tenantId);
    return row;
  }

  private async insertChart(tx: DbOrTx, tenantId: string) {
    await tx
      .insert(acctAccounts)
      .values(
        STANDARD_CHART.map((c, i) => ({
          tenantId,
          code: c.code,
          name: c.name,
          type: c.type,
          group: c.group,
          subGroup: c.subGroup ?? null,
          key: c.key ?? null,
          system: !!c.key,
          isCash: !!c.isCash,
          isBank: !!c.isBank,
          description: c.about ?? null,
          sort: i,
        })),
      )
      .onConflictDoNothing();
  }

  /** Adds standard accounts a newer version of the chart has (shops seeded earlier lack them). */
  private async seedChart(tenantId: string) {
    await this.db.transaction(async (tx) => {
      await this.lockTenant(tx, tenantId);
      await this.insertChart(tx, tenantId);
    });
  }

  async settings(tenantId: string, db: DbOrTx = this.db): Promise<AcctSettings> {
    const [s] = await db.select().from(acctSettings).where(eq(acctSettings.tenantId, tenantId)).limit(1);
    if (!s) {
      this.ready.delete(tenantId);
      return this.ensureInit(tenantId);
    }
    return s;
  }

  async lockTenant(tx: DbOrTx, tenantId: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`acct:${tenantId}`}))`);
  }

  async getSettings(tenantId: string) {
    const s = await this.ensureInit(tenantId);
    const log = await this.db.select().from(acctLockLog).where(eq(acctLockLog.tenantId, tenantId)).orderBy(desc(acctLockLog.at)).limit(20);
    const [first] = await this.db.select({ n: sql<string>`count(*)` }).from(acctEntries).where(eq(acctEntries.tenantId, tenantId));
    return {
      lockedThrough: s.lockedThrough,
      startDate: s.startDate,
      postFrom: s.postFrom,
      importedBills: s.importedBills,
      valueStock: s.valueStock,
      methodAccounts: s.methodAccounts,
      autoPost: s.autoPost,
      lastSyncAt: s.lastSyncAt,
      lastSyncSummary: s.lastSyncSummary,
      entryCount: num(first?.n),
      lockHistory: log,
    };
  }

  async updateSettings(tenantId: string, input: z.input<typeof settingsPatch>) {
    const p = settingsPatch.parse(input);
    await this.ensureInit(tenantId);
    const set: Partial<typeof acctSettings.$inferInsert> = {};
    if (p.importedBills) set.importedBills = p.importedBills;
    if (p.valueStock !== undefined) set.valueStock = p.valueStock;
    if (p.startDate !== undefined) set.startDate = p.startDate;
    if (p.methodAccounts) {
      const cur = (await this.settings(tenantId)).methodAccounts;
      const next: Record<string, string> = { ...cur };
      for (const [m, id] of Object.entries(p.methodAccounts)) {
        if (!id) delete next[m];
        else {
          const [a] = await this.db
            .select({ id: acctAccounts.id, isCash: acctAccounts.isCash, isBank: acctAccounts.isBank })
            .from(acctAccounts)
            .where(and(eq(acctAccounts.tenantId, tenantId), eq(acctAccounts.id, id)))
            .limit(1);
          if (!a || !(a.isCash || a.isBank)) throw badRequest("Choose a cash or bank account for each payment method");
          next[m] = id;
        }
      }
      set.methodAccounts = next;
    }
    if (Object.keys(set).length > 0) await this.db.update(acctSettings).set(set).where(eq(acctSettings.tenantId, tenantId));
    this.fresh.delete(tenantId);
    if (set.importedBills || set.startDate !== undefined || set.methodAccounts) this.kick(tenantId);
    return this.getSettings(tenantId);
  }

  /** Moves the period lock. Needs accounting.lock (checked by the route). Every change is logged with who and why. */
  async setLock(tenantId: string, input: z.input<typeof lockInput>, userId: string | null) {
    const p = lockInput.parse(input);
    const s = await this.ensureInit(tenantId);
    if (p.lockedThrough && p.lockedThrough > this.today()) throw badRequest("You can't lock a date that has not come yet");
    if ((s.lockedThrough ?? null) === p.lockedThrough) return this.getSettings(tenantId);
    await this.db.transaction(async (tx) => {
      await tx.update(acctSettings).set({ lockedThrough: p.lockedThrough }).where(eq(acctSettings.tenantId, tenantId));
      await tx.insert(acctLockLog).values({ tenantId, lockedThrough: p.lockedThrough, previous: s.lockedThrough ?? null, reason: p.reason, userId });
    });
    return this.getSettings(tenantId);
  }

  assertOpen(lockedThrough: string | null | undefined, d: string) {
    if (lockedThrough && d <= lockedThrough) {
      throw conflict(`The books are locked up to ${lockedThrough}. Pick a later date, or ask the person who can unlock the period.`);
    }
  }

  // ================================================================ accounts

  async listAccounts(tenantId: string, opts: { balances?: boolean; asOf?: string } = {}) {
    await this.ensureInit(tenantId);
    const rows = await this.db.select().from(acctAccounts).where(eq(acctAccounts.tenantId, tenantId)).orderBy(asc(acctAccounts.code));
    const balances = opts.balances ? await this.balancesTo(tenantId, opts.asOf ?? this.today()) : null;
    return rows
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
      .map((a) => {
        const b = balances?.get(a.id);
        const net = b ? b.debit - b.credit : 0;
        return { ...a, ...(balances ? { balance: net, debit: b?.debit ?? 0, credit: b?.credit ?? 0 } : {}), normalSide: NORMAL_SIDE[a.type] };
      });
  }

  async getAccount(tenantId: string, id: string): Promise<AcctAccount> {
    const [a] = await this.db.select().from(acctAccounts).where(and(eq(acctAccounts.tenantId, tenantId), eq(acctAccounts.id, id))).limit(1);
    if (!a) throw notFound("Account");
    return a;
  }

  private checkGroup(type: string, group: string) {
    const g = GROUP_BY_KEY[group];
    if (!g || g.type !== type) throw badRequest(`"${group}" is not a group of ${type} accounts`, { groups: ACCOUNT_GROUPS.filter((x) => x.type === type).map((x) => x.key) });
  }

  private async nextCode(tx: DbOrTx, tenantId: string, type: string): Promise<string> {
    const base = { asset: 1700, liability: 2400, equity: 3300, income: 4300, expense: 5300 }[type] ?? 9000;
    const used = new Set((await tx.select({ code: acctAccounts.code }).from(acctAccounts).where(eq(acctAccounts.tenantId, tenantId))).map((r) => r.code));
    for (let n = base; n < base + 900; n++) if (!used.has(String(n))) return String(n);
    throw conflict("No free account code left; give the account a code yourself");
  }

  async createAccount(tenantId: string, input: AccountInput) {
    const p = accountInput.parse(input);
    await this.ensureInit(tenantId);
    this.checkGroup(p.type, p.group);
    const row = await this.db.transaction(async (tx) => {
      await this.lockTenant(tx, tenantId);
      const code = p.code ?? (await this.nextCode(tx, tenantId, p.type));
      const clash = await tx.select({ id: acctAccounts.id }).from(acctAccounts).where(and(eq(acctAccounts.tenantId, tenantId), eq(acctAccounts.code, code))).limit(1);
      if (clash[0]) throw conflict(`Account code ${code} is already used`);
      const [a] = await tx
        .insert(acctAccounts)
        .values({
          tenantId,
          code,
          name: p.name,
          type: p.type,
          group: p.group,
          subGroup: p.subGroup,
          description: p.description,
          isBank: p.isBank ?? false,
          isCash: p.isCash ?? false,
          bankName: p.bankName,
          bankAccountLast4: p.bankAccountLast4,
          bankIfsc: p.bankIfsc,
          openingBalance: p.openingBalance ?? 0,
        })
        .returning();
      return a!;
    });
    if (p.openingBalance) await this.syncTypes(tenantId, ["account_opening"]);
    return row;
  }

  async updateAccount(tenantId: string, id: string, input: AccountPatch) {
    const p = accountPatch.parse(input);
    const cur = await this.getAccount(tenantId, id);
    const set: Partial<typeof acctAccounts.$inferInsert> = {};
    if (p.name !== undefined) set.name = p.name;
    if (p.subGroup !== undefined) set.subGroup = p.subGroup;
    if (p.description !== undefined) set.description = p.description;
    if (p.bankName !== undefined) set.bankName = p.bankName;
    if (p.bankAccountLast4 !== undefined) set.bankAccountLast4 = p.bankAccountLast4;
    if (p.bankIfsc !== undefined) set.bankIfsc = p.bankIfsc;
    if (p.openingBalance !== undefined) set.openingBalance = p.openingBalance;
    if (p.code !== undefined && p.code !== cur.code) {
      if (cur.system) throw badRequest("The code of a standard account can't be changed");
      const clash = await this.db.select({ id: acctAccounts.id }).from(acctAccounts).where(and(eq(acctAccounts.tenantId, tenantId), eq(acctAccounts.code, p.code))).limit(1);
      if (clash[0]) throw conflict(`Account code ${p.code} is already used`);
      set.code = p.code;
    }
    if ((p.type && p.type !== cur.type) || (p.group && p.group !== cur.group)) {
      if (cur.system) throw badRequest("A standard account can't change its group");
      const used = await this.db.select({ id: acctLines.id }).from(acctLines).where(and(eq(acctLines.tenantId, tenantId), eq(acctLines.accountId, id))).limit(1);
      if (used[0] && (p.type ?? cur.type) !== cur.type) throw badRequest("This account already has entries, so its type can't change");
      this.checkGroup(p.type ?? cur.type, p.group ?? cur.group);
      set.type = p.type ?? cur.type;
      set.group = p.group ?? cur.group;
    }
    if (p.active !== undefined) {
      if (cur.system && !p.active) throw badRequest("A standard account can't be switched off");
      set.active = p.active;
    }
    if (p.isBank !== undefined && !cur.system) set.isBank = p.isBank;
    if (p.isCash !== undefined && !cur.system) set.isCash = p.isCash;
    if (Object.keys(set).length === 0) return cur;
    const [row] = await this.db.update(acctAccounts).set(set).where(and(eq(acctAccounts.tenantId, tenantId), eq(acctAccounts.id, id))).returning();
    if (p.openingBalance !== undefined && p.openingBalance !== cur.openingBalance) await this.syncTypes(tenantId, ["account_opening"]);
    return row!;
  }

  async deleteAccount(tenantId: string, id: string) {
    const a = await this.getAccount(tenantId, id);
    if (a.system) throw badRequest("A standard account can't be deleted");
    if (a.openingBalance !== 0) throw badRequest("Clear the opening balance first");
    const used = await this.db.select({ id: acctLines.id }).from(acctLines).where(and(eq(acctLines.tenantId, tenantId), eq(acctLines.accountId, id))).limit(1);
    if (used[0]) throw conflict("This account has entries. Switch it off instead of deleting it.");
    await this.db.delete(acctAccounts).where(and(eq(acctAccounts.tenantId, tenantId), eq(acctAccounts.id, id)));
    return { ok: true as const };
  }

  async accountInfos(tenantId: string, db: DbOrTx = this.db): Promise<AccountInfo[]> {
    const rows = await db.select().from(acctAccounts).where(eq(acctAccounts.tenantId, tenantId));
    return rows.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type, group: a.group, subGroup: a.subGroup, key: a.key, isCash: a.isCash, isBank: a.isBank }));
  }

  // ================================================================ balances (SQL)

  /**
   * Sums per account between two dates. `excludeClosing` leaves out the year-end closing journals (and their
   * reversals), so the profit and loss and the trial balance of a closed year still show the year's figures.
   */
  async balancesBetween(tenantId: string, from: string | null, to: string | null, opts: { excludeClosing?: boolean } = {}): Promise<Map<string, Balance>> {
    const rows = await this.db
      .select({ id: acctLines.accountId, debit: sql<string>`coalesce(sum(${acctLines.debit}), 0)`, credit: sql<string>`coalesce(sum(${acctLines.credit}), 0)` })
      .from(acctLines)
      .where(
        and(
          eq(acctLines.tenantId, tenantId),
          from ? gte(acctLines.entryDate, from) : undefined,
          to ? lte(acctLines.entryDate, to) : undefined,
          opts.excludeClosing
            ? sql`${acctLines.entryId} not in (select e.id from ${acctEntries} e where e.tenant_id = ${tenantId} and e.source_type in (${sql.join(CLOSING_SOURCE_TYPES.map((x) => sql`${x}`), sql`, `)}))`
            : undefined,
        ),
      )
      .groupBy(acctLines.accountId);
    return new Map(rows.map((r) => [r.id, { debit: num(r.debit), credit: num(r.credit) }]));
  }
  balancesTo(tenantId: string, to: string, opts: { excludeClosing?: boolean } = {}) {
    return this.balancesBetween(tenantId, null, to, opts);
  }

  // ================================================================ entries

  private async nextNumbers(tx: DbOrTx, tenantId: string, count: number): Promise<number> {
    const [s] = await tx
      .update(acctSettings)
      .set({ nextSeq: sql`${acctSettings.nextSeq} + ${count}` })
      .where(eq(acctSettings.tenantId, tenantId))
      .returning({ next: acctSettings.nextSeq });
    return (s?.next ?? count + 1) - count;
  }

  private numberOf(type: string, seq: number) {
    return `${VOUCHER_PREFIX[type] ?? "JV"}-${String(seq).padStart(6, "0")}`;
  }

  /** Builds the debit/credit lines of a payment, receipt or contra voucher from the two accounts and the amount. */
  private async voucherLines(tenantId: string, v: z.output<typeof entryInput>): Promise<{ accountId: string; debit: number; credit: number; memo?: string | null; partyType?: string | null; partyId?: string | null }[]> {
    if (v.voucherType === "journal") {
      return (v.lines ?? []).map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit, memo: l.memo, partyType: l.partyType ?? null, partyId: l.partyId ?? null }));
    }
    const s = v.simple!;
    const [money, other] = await Promise.all([this.getAccount(tenantId, s.accountId), this.getAccount(tenantId, s.otherAccountId)]);
    const isMoney = (a: AcctAccount) => a.isCash || a.isBank;
    if (s.accountId === s.otherAccountId) throw badRequest("Choose two different accounts");
    if (v.voucherType === "contra") {
      if (!isMoney(money) || !isMoney(other)) throw badRequest("A contra entry moves money between your cash and bank accounts only");
      // accountId = from, otherAccountId = to
      return [
        { accountId: other.id, debit: s.amount, credit: 0 },
        { accountId: money.id, debit: 0, credit: s.amount },
      ];
    }
    if (!isMoney(money)) throw badRequest("Choose a cash or bank account for the money");
    if (isMoney(other)) throw badRequest("To move money between cash and bank use a contra entry");
    return v.voucherType === "payment"
      ? [
          { accountId: other.id, debit: s.amount, credit: 0 },
          { accountId: money.id, debit: 0, credit: s.amount },
        ]
      : [
          { accountId: money.id, debit: s.amount, credit: 0 },
          { accountId: other.id, debit: 0, credit: s.amount },
        ];
  }

  /** Posts a journal, contra, payment or receipt voucher by hand. */
  async createEntry(tenantId: string, input: EntryInput, userId: string | null): Promise<EntryView> {
    const v = entryInput.parse(input);
    const s = await this.ensureInit(tenantId);
    this.assertOpen(s.lockedThrough, v.date);
    const lines = await this.voucherLines(tenantId, v);
    const clean = lines.filter((l) => l.debit > 0 || l.credit > 0);
    for (const l of clean) if (l.debit > 0 && l.credit > 0) throw badRequest("A line is either a debit or a credit, not both");
    if (clean.length < 2) throw badRequest("An entry needs at least two lines");
    const debit = clean.reduce((t, l) => t + l.debit, 0);
    const credit = clean.reduce((t, l) => t + l.credit, 0);
    if (debit !== credit) throw badRequest(`Debits (₹${(debit / 100).toFixed(2)}) and credits (₹${(credit / 100).toFixed(2)}) must be equal`, { debit, credit });
    if (debit <= 0) throw badRequest("The amount must be more than zero");
    const ids = [...new Set(clean.map((l) => l.accountId))];
    const accs = await this.db.select().from(acctAccounts).where(and(eq(acctAccounts.tenantId, tenantId), inArray(acctAccounts.id, ids)));
    if (accs.length !== ids.length) throw badRequest("One of the accounts was not found");
    const off = accs.find((a) => !a.active);
    if (off) throw badRequest(`Account "${off.name}" is switched off`);
    const entryId = await this.db.transaction(async (tx) => {
      await this.lockTenant(tx, tenantId);
      const locked = (await this.settings(tenantId, tx)).lockedThrough;
      this.assertOpen(locked, v.date);
      const seq = await this.nextNumbers(tx, tenantId, 1);
      const [e] = await tx
        .insert(acctEntries)
        .values({
          tenantId,
          seq,
          number: this.numberOf(v.voucherType, seq),
          voucherType: v.voucherType,
          origin: "manual",
          date: v.date,
          narration: v.narration,
          reference: v.reference,
          total: debit,
          createdBy: userId,
        })
        .returning({ id: acctEntries.id });
      await tx.insert(acctLines).values(
        clean.map((l, i) => ({
          tenantId,
          entryId: e!.id,
          lineNo: i + 1,
          accountId: l.accountId,
          entryDate: v.date,
          debit: l.debit,
          credit: l.credit,
          memo: l.memo ?? null,
          partyType: (l.partyType as "customer" | "supplier" | null) ?? null,
          partyId: l.partyId ?? null,
        })),
      );
      return e!.id;
    });
    this.fresh.delete(tenantId);
    return this.getEntry(tenantId, entryId);
  }

  /** Reverses a manual entry with a new entry (lines swapped). The original stays, marked reversed. */
  async reverseEntry(tenantId: string, id: string, input: z.input<typeof reverseInput>, userId: string | null): Promise<EntryView> {
    const p = reverseInput.parse(input);
    const s = await this.ensureInit(tenantId);
    const when = p.date ?? this.today();
    this.assertOpen(s.lockedThrough, when);
    const reversalId = await this.db.transaction(async (tx) => {
      await this.lockTenant(tx, tenantId);
      const locked = (await this.settings(tenantId, tx)).lockedThrough;
      this.assertOpen(locked, when);
      const [e] = await tx.select().from(acctEntries).where(and(eq(acctEntries.tenantId, tenantId), eq(acctEntries.id, id))).limit(1);
      if (!e) throw notFound("Entry");
      if (e.origin === "auto") throw badRequest("This entry was made automatically from a bill, purchase, payment or expense. Cancel or change that document instead.");
      if (e.voucherType === "reversal") throw badRequest("A reversal can't be reversed. Post a new entry instead.");
      if (e.status === "reversed") throw conflict("This entry is already reversed");
      if (when < e.date) throw badRequest("The reversal can't be dated before the entry");
      const lines = await tx.select().from(acctLines).where(eq(acctLines.entryId, id)).orderBy(asc(acctLines.lineNo));
      const seq = await this.nextNumbers(tx, tenantId, 1);
      const [r] = await tx
        .insert(acctEntries)
        .values({
          tenantId,
          seq,
          number: this.numberOf("reversal", seq),
          voucherType: "reversal",
          origin: "manual",
          date: when,
          narration: `Reversal of ${e.number}: ${p.reason}`,
          status: "posted",
          total: e.total,
          reversalOfId: e.id,
          createdBy: userId,
        })
        .returning({ id: acctEntries.id });
      await tx.insert(acctLines).values(
        lines.map((l) => ({ tenantId, entryId: r!.id, lineNo: l.lineNo, accountId: l.accountId, entryDate: when, debit: l.credit, credit: l.debit, memo: l.memo, partyType: l.partyType, partyId: l.partyId })),
      );
      await tx.update(acctEntries).set({ status: "reversed", reversedById: r!.id, reversedAt: this.now(), reversalReason: p.reason }).where(eq(acctEntries.id, e.id));
      return r!.id;
    });
    this.fresh.delete(tenantId);
    return this.getEntry(tenantId, reversalId);
  }

  private async withLines(tenantId: string, rows: AcctEntry[]): Promise<EntryView[]> {
    if (rows.length === 0) return [];
    const lines: Awaited<ReturnType<typeof this.lineRows>> = [];
    for (const part of chunks(rows.map((r) => r.id), 1000)) lines.push(...(await this.lineRows(tenantId, part)));
    const by = new Map<string, EntryLineView[]>();
    for (const l of lines) {
      const list = by.get(l.entryId) ?? [];
      list.push({ id: l.id, lineNo: l.lineNo, accountId: l.accountId, accountCode: l.code, accountName: l.name, debit: l.debit, credit: l.credit, memo: l.memo, partyType: l.partyType, partyId: l.partyId });
      by.set(l.entryId, list);
    }
    return rows.map((e) => ({
      ...e,
      kindLabel: kindLabel(e),
      lines: (by.get(e.id) ?? []).sort((a, b) => a.lineNo - b.lineNo),
    }));
  }

  private lineRows(tenantId: string, entryIds: string[]) {
    return this.db
      .select({
        id: acctLines.id,
        entryId: acctLines.entryId,
        lineNo: acctLines.lineNo,
        accountId: acctLines.accountId,
        code: acctAccounts.code,
        name: acctAccounts.name,
        debit: acctLines.debit,
        credit: acctLines.credit,
        memo: acctLines.memo,
        partyType: acctLines.partyType,
        partyId: acctLines.partyId,
      })
      .from(acctLines)
      .innerJoin(acctAccounts, eq(acctAccounts.id, acctLines.accountId))
      .where(and(eq(acctLines.tenantId, tenantId), inArray(acctLines.entryId, entryIds)));
  }

  async getEntry(tenantId: string, id: string): Promise<EntryView> {
    const [e] = await this.db.select().from(acctEntries).where(and(eq(acctEntries.tenantId, tenantId), eq(acctEntries.id, id))).limit(1);
    if (!e) throw notFound("Entry");
    return (await this.withLines(tenantId, [e]))[0]!;
  }

  private entryWhere(tenantId: string, p: z.output<typeof entryListQuery>): SQL | undefined {
    return and(
      eq(acctEntries.tenantId, tenantId),
      p.from ? gte(acctEntries.date, p.from) : undefined,
      p.to ? lte(acctEntries.date, p.to) : undefined,
      p.voucherType?.length ? inArray(acctEntries.voucherType, p.voucherType) : undefined,
      p.origin?.length ? inArray(acctEntries.origin, p.origin) : undefined,
      p.status?.length ? inArray(acctEntries.status, p.status) : undefined,
      p.sourceType?.length ? inArray(acctEntries.sourceType, p.sourceType) : undefined,
      p.accountId ? sql`exists (select 1 from ${acctLines} l where l.entry_id = ${acctEntries.id} and l.account_id = ${p.accountId})` : undefined,
      searchAny(p.q, [acctEntries.narration, acctEntries.number, acctEntries.reference]),
    );
  }

  /** Journal entries and the day book (paged; each entry with its lines). */
  async listEntries(tenantId: string, query: EntryListQuery = {}): Promise<ListPage<EntryView> & { totals: { debit: number; entries: number } }> {
    const p = entryListQuery.parse(query);
    await this.ensureInit(tenantId);
    await this.ensureFresh(tenantId);
    const where = this.entryWhere(tenantId, p);
    const [page, [sum]] = await Promise.all([
      runList(p, {
        rows: () => this.db.select().from(acctEntries).where(where).orderBy(...ENTRY_SORT.orderBy(p.sort)).limit(p.limit).offset(p.offset),
        count: () => this.db.select({ total: sql<number>`count(*)::int` }).from(acctEntries).where(where),
      }),
      this.db.select({ debit: sql<string>`coalesce(sum(${acctEntries.total}), 0)` }).from(acctEntries).where(where),
    ]);
    return { ...page, items: await this.withLines(tenantId, page.items as AcctEntry[]), totals: { debit: num(sum?.debit), entries: page.total } };
  }

  // ================================================================ reports

  async range(q: { from?: string | null; to?: string | null }) {
    const p = rangeQuery.parse({ from: q.from ?? undefined, to: q.to ?? undefined });
    const to = p.to ?? this.today();
    return { from: p.from ?? fyStart(to), to };
  }

  async trialBalance(tenantId: string, q: { from?: string; to?: string } = {}): Promise<TrialBalance> {
    await this.ensureInit(tenantId);
    await this.ensureFresh(tenantId);
    const { from, to } = await this.range(q);
    const [accounts, before, during] = await Promise.all([this.accountInfos(tenantId), this.balancesTo(tenantId, addDays(from, -1)), this.balancesBetween(tenantId, from, to, { excludeClosing: true })]);
    return buildTrialBalance(accounts, before, during, { from, to });
  }

  async accountLedger(tenantId: string, q: { accountId: string; from?: string; to?: string; partyId?: string }): Promise<Ledger & { account: AcctAccount; from: string; to: string }> {
    await this.ensureInit(tenantId);
    await this.ensureFresh(tenantId);
    const account = await this.getAccount(tenantId, z.string().uuid().parse(q.accountId));
    const { from, to } = await this.range(q);
    const party = q.partyId ? z.string().uuid().parse(q.partyId) : null;
    const base = [eq(acctLines.tenantId, tenantId), eq(acctLines.accountId, account.id), party ? eq(acctLines.partyId, party) : undefined];
    const [open] = await this.db
      .select({ debit: sql<string>`coalesce(sum(${acctLines.debit}), 0)`, credit: sql<string>`coalesce(sum(${acctLines.credit}), 0)` })
      .from(acctLines)
      .where(and(...base, lte(acctLines.entryDate, addDays(from, -1))));
    const rows = await this.db
      .select({
        lineId: acctLines.id,
        entryId: acctEntries.id,
        date: acctEntries.date,
        number: acctEntries.number,
        voucherType: acctEntries.voucherType,
        narration: acctEntries.narration,
        memo: acctLines.memo,
        debit: acctLines.debit,
        credit: acctLines.credit,
      })
      .from(acctLines)
      .innerJoin(acctEntries, eq(acctEntries.id, acctLines.entryId))
      .where(and(...base, gte(acctLines.entryDate, from), lte(acctLines.entryDate, to)))
      .orderBy(asc(acctEntries.date), asc(acctEntries.seq), asc(acctLines.lineNo))
      .limit(20_000);
    const ledger = buildLedger(num(open?.debit) - num(open?.credit), rows);
    return { ...ledger, account, from, to };
  }

  /** The cash (or a bank) account's ledger with the money accounts to pick from. */
  async cashBook(tenantId: string, q: { accountId?: string; from?: string; to?: string } = {}) {
    const accounts = (await this.listAccounts(tenantId)).filter((a) => a.isCash || a.isBank);
    const pick = q.accountId ?? accounts.find((a) => a.key === SYS.cash)?.id ?? accounts[0]?.id;
    if (!pick) throw notFound("Cash account");
    const ledger = await this.accountLedger(tenantId, { accountId: pick, from: q.from, to: q.to });
    return { ...ledger, accounts: accounts.map((a) => ({ id: a.id, name: a.name, isBank: a.isBank, isCash: a.isCash })) };
  }

  async stockPart(tenantId: string, from: string, to: string, accounts: readonly AccountInfo[]) {
    const s = await this.settings(tenantId);
    if (!s.valueStock || !this.deps.stock) return { opening: 0, closing: 0, ledgerNow: 0, enabled: false };
    const stockIds = accounts.filter((a) => a.group === "stock").map((a) => a.id);
    const [vOpen, vClose] = await Promise.all([this.deps.stock.value(tenantId, addDays(from, -1)), this.deps.stock.value(tenantId, to)]);
    if (vClose === null && vOpen === null) return { opening: 0, closing: 0, ledgerNow: 0, enabled: false };
    const [bBefore, bTo] = await Promise.all([this.balancesTo(tenantId, addDays(from, -1), { excludeClosing: true }), this.balancesTo(tenantId, to, { excludeClosing: true })]);
    const sum = (m: Map<string, Balance>) => stockIds.reduce((t, id) => t + ((m.get(id)?.debit ?? 0) - (m.get(id)?.credit ?? 0)), 0);
    const moved = sum(bTo) - sum(bBefore);
    return { opening: (vOpen ?? 0) + moved, closing: vClose ?? 0, ledgerNow: sum(bTo), enabled: true };
  }

  async profitLoss(tenantId: string, q: { from?: string; to?: string; compare?: string; compareFrom?: string; compareTo?: string } = {}): Promise<ProfitLoss> {
    await this.ensureInit(tenantId);
    await this.ensureFresh(tenantId);
    const { from, to } = await this.range(q);
    const accounts = await this.accountInfos(tenantId);
    const cur = await this.balancesBetween(tenantId, from, to, { excludeClosing: true });
    const stock = await this.stockPart(tenantId, from, to, accounts);
    let cmp: Parameters<typeof buildProfitLoss>[4] = null;
    if (q.compare === "previous" || q.compareFrom) {
      let cf = q.compareFrom;
      let ct = q.compareTo;
      if (!cf || !ct) {
        const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
        ct = addDays(from, -1);
        cf = addDays(ct, -days);
      }
      if (!isValidDate(cf) || !isValidDate(ct) || cf > ct) throw badRequest("Check the comparison dates");
      cmp = { balances: await this.balancesBetween(tenantId, cf, ct, { excludeClosing: true }), stock: await this.stockPart(tenantId, cf, ct, accounts), from: cf, to: ct };
    }
    return buildProfitLoss(accounts, cur, stock, { from, to }, cmp);
  }

  async balanceSheet(tenantId: string, q: { asOf?: string } = {}): Promise<BalanceSheet> {
    await this.ensureInit(tenantId);
    await this.ensureFresh(tenantId);
    const asOf = q.asOf ? z.string().refine(isValidDate).parse(q.asOf) : this.today();
    const accounts = await this.accountInfos(tenantId);
    const balances = await this.balancesTo(tenantId, asOf);
    const settings = await this.settings(tenantId);
    let stockValue = 0;
    if (settings.valueStock && this.deps.stock) stockValue = (await this.deps.stock.value(tenantId, asOf)) ?? 0;
    else stockValue = accounts.filter((a) => a.group === "stock").reduce((t, a) => t + ((balances.get(a.id)?.debit ?? 0) - (balances.get(a.id)?.credit ?? 0)), 0);
    return buildBalanceSheet(accounts, balances, stockValue, asOf);
  }

  async gstLedger(tenantId: string, q: { from?: string; to?: string } = {}): Promise<GstLedger> {
    await this.ensureInit(tenantId);
    await this.ensureFresh(tenantId);
    const { from, to } = await this.range(q);
    const accounts = await this.accountInfos(tenantId);
    const during = await this.balancesBetween(tenantId, from, to);
    const settled = accounts.find((a) => a.key === SYS.taxPayable);
    return buildGstLedger(accounts, during, { from, to }, settled ? -((during.get(settled.id)?.debit ?? 0) - (during.get(settled.id)?.credit ?? 0)) : 0);
  }

  // ================================================================ sync (auto-posting)

  /** Debounced: posts the changes of the last moments. Called by the host after invoice / payment events. */
  kick(tenantId: string): void {
    if (this.timers.has(tenantId)) return;
    const h = setTimeout(() => {
      this.timers.delete(tenantId);
      void this.syncIfEnabled(tenantId).catch((err) => this.log.warn({ err, tenantId }, "accounting: background sync failed"));
    }, 1500);
    h.unref?.();
    this.timers.set(tenantId, h);
  }

  private async syncIfEnabled(tenantId: string) {
    if (this.deps.features && !(await this.deps.features.isEnabled(tenantId, "accounting"))) return;
    const [s] = await this.db.select().from(acctSettings).where(eq(acctSettings.tenantId, tenantId)).limit(1);
    if (!s?.autoPost) return;
    await this.sync(tenantId);
  }

  /** Keeps reads current: a sync at most every 20 seconds per shop while posting is on. */
  async ensureFresh(tenantId: string) {
    const last = this.fresh.get(tenantId) ?? 0;
    if (this.now().getTime() - last < FRESH_MS) return;
    const s = await this.settings(tenantId);
    if (!s.autoPost) return;
    this.fresh.set(tenantId, this.now().getTime());
    await this.sync(tenantId);
  }

  /** One sync at a time per shop in this process; the database lock covers other processes. */
  async sync(tenantId: string, opts: { dryRun?: boolean; types?: readonly SourceType[]; from?: string | null } = {}): Promise<SyncResult> {
    const prev = this.running.get(tenantId);
    if (prev) await prev.catch(() => undefined);
    const p = this.runSync(tenantId, opts);
    this.running.set(tenantId, p);
    try {
      return await p;
    } finally {
      if (this.running.get(tenantId) === p) this.running.delete(tenantId);
    }
  }

  private syncTypes(tenantId: string, types: SourceType[]) {
    return this.sync(tenantId, { types }).catch((err) => {
      this.log.warn({ err, tenantId }, "accounting: opening balance sync failed");
      throw err;
    });
  }

  async loadDocs(tenantId: string) {
    const s = this.deps.sources;
    const [invoices, payments, receipts, creditNotes, purchases, supplierPayments, debitNotes, expenses, tills, openings, shopState, stockAdjustments, gstPayments, payroll, salesDebitNotes] = await Promise.all([
      s.invoices(tenantId),
      s.invoicePayments(tenantId),
      s.receipts(tenantId),
      s.creditNotes(tenantId),
      s.purchases(tenantId),
      s.supplierPayments(tenantId),
      s.debitNotes(tenantId),
      s.expenses(tenantId),
      s.tills(tenantId),
      s.openingBalances(tenantId),
      s.shopStateCode(tenantId),
      s.stockAdjustments ? s.stockAdjustments(tenantId) : Promise.resolve([]),
      s.gstPayments ? s.gstPayments(tenantId) : Promise.resolve([]),
      s.payroll ? s.payroll(tenantId) : Promise.resolve(null),
      s.salesDebitNotes ? s.salesDebitNotes(tenantId) : Promise.resolve([]),
    ]);
    return { invoices, payments, receipts, creditNotes, purchases, supplierPayments, debitNotes, expenses, tills, openings, shopState, stockAdjustments, gstPayments, payroll, salesDebitNotes };
  }

  private postingsOf(docs: Awaited<ReturnType<AccountingService["loadDocs"]>>, o: RuleOptions): Posting[] {
    return [
      ...docs.invoices.flatMap((d) => invoicePostings(d, o)),
      ...docs.payments.flatMap((d) => invoicePaymentPostings(d, o)),
      ...docs.receipts.flatMap((d) => receiptPostings(d)),
      ...docs.creditNotes.flatMap((d) => creditNotePostings(d, o)),
      ...docs.salesDebitNotes.flatMap((d) => salesDebitNotePostings(d)),
      ...docs.purchases.flatMap((d) => purchasePostings(d, o)),
      ...docs.supplierPayments.flatMap((d) => supplierPaymentPostings(d, o)),
      ...docs.debitNotes.flatMap((d) => debitNotePostings(d, o)),
      ...docs.expenses.flatMap((d) => expensePostings(d, o)),
      ...docs.tills.flatMap((d) => tillPostings(d)),
      ...docs.gstPayments.flatMap((d) => gstPaymentPostings(d)),
      ...(docs.payroll ? payrollPostings(docs.payroll) : []),
      ...(o.valueStock === false ? [] : docs.stockAdjustments.flatMap((d) => stockAdjustmentPostings(d))),
    ];
  }

  private async runSync(tenantId: string, opts: { dryRun?: boolean; types?: readonly SourceType[]; from?: string | null }): Promise<SyncResult> {
    const t0 = Date.now();
    const dryRun = !!opts.dryRun;
    let settings = await this.ensureInit(tenantId);
    const postFrom = opts.from !== undefined && opts.from !== null ? opts.from : settings.postFrom;
    const docs = await this.loadDocs(tenantId);
    const o: RuleOptions = { importedBills: settings.importedBills, shopState: docs.shopState, valueStock: settings.valueStock };
    const docPostings = this.postingsOf(docs, o).filter((p) => !postFrom || p.date >= postFrom);

    // The books start on the first document's date unless the owner chose one.
    const startDate = settings.startDate ?? (docPostings.length ? docPostings.reduce((m, p) => (p.date < m ? p.date : m), docPostings[0]!.date) : this.today());
    const accountRows = await this.db.select().from(acctAccounts).where(eq(acctAccounts.tenantId, tenantId));
    const postings: Posting[] = [
      ...accountOpeningPosting(accountRows, startDate),
      ...openingPartiesPosting(docs.openings.customers, docs.openings.suppliers, startDate),
      ...docPostings,
    ];
    const types = new Set<string>(opts.types ?? SOURCE_TYPES);
    const wanted = postings.filter((p) => types.has(p.sourceType));
    const result: SyncResult = {
      dryRun,
      posted: 0,
      reversed: 0,
      unchanged: 0,
      late: 0,
      byType: {},
      errors: [],
      startDate,
      postFrom: postFrom ?? null,
      ms: 0,
    };
    const bump = (type: string, k: "posted" | "reversed" | "unchanged") => {
      const b = (result.byType[type] ??= { posted: 0, reversed: 0, unchanged: 0 });
      b[k] += 1;
      result[k] += 1;
    };

    await this.db.transaction(async (tx) => {
      await this.lockTenant(tx, tenantId);
      settings = await this.settings(tenantId, tx);
      const typeList = [...types];
      // Every auto entry of these types, whatever its status, to know the next version of each source.
      const existing = await tx
        .select({
          id: acctEntries.id,
          sourceType: acctEntries.sourceType,
          sourceId: acctEntries.sourceId,
          version: acctEntries.sourceVersion,
          hash: acctEntries.contentHash,
          status: acctEntries.status,
          date: acctEntries.date,
          lateFor: acctEntries.lateFor,
          narration: acctEntries.narration,
        })
        .from(acctEntries)
        .where(and(eq(acctEntries.tenantId, tenantId), inArray(acctEntries.sourceType, typeList)));
      const keyOf = (t: string | null, id: string | null) => `${t}|${id}`;
      const activeBy = new Map<string, (typeof existing)[number]>();
      const maxVersion = new Map<string, number>();
      for (const e of existing) {
        const k = keyOf(e.sourceType, e.sourceId);
        maxVersion.set(k, Math.max(maxVersion.get(k) ?? 0, e.version ?? 0));
        if (e.status === "posted") activeBy.set(k, e);
      }

      const wantedKeys = new Set<string>();
      const toPost: { p: Posting; hash: string; version: number }[] = [];
      const toReverse: { entry: (typeof existing)[number]; why: string }[] = [];
      for (const p of wanted) {
        const k = keyOf(p.sourceType, p.sourceId);
        wantedKeys.add(k);
        if (!isBalanced(p.lines)) {
          result.errors.push({ sourceType: p.sourceType, sourceId: p.sourceId, message: "Lines do not balance" });
          continue;
        }
        const hash = postingHash(p);
        const cur = activeBy.get(k);
        if (cur && cur.hash === hash) {
          bump(p.sourceType, "unchanged");
          continue;
        }
        if (cur) toReverse.push({ entry: cur, why: "the document changed" });
        toPost.push({ p, hash, version: (maxVersion.get(k) ?? 0) + 1 });
      }
      // Posted but the document is gone (deleted payment or receipt) or no longer counts (import mode, edited).
      for (const [k, e] of activeBy) {
        if (wantedKeys.has(k)) continue;
        if (postFrom && (e.lateFor ?? e.date) < postFrom && e.sourceType !== "account_opening" && e.sourceType !== "opening_parties") continue;
        toReverse.push({ entry: e, why: "the document was removed" });
      }

      if (dryRun) {
        for (const x of toPost) bump(x.p.sourceType, "posted");
        for (const x of toReverse) bump(x.entry.sourceType ?? "?", "reversed");
        return;
      }
      if (toPost.length === 0 && toReverse.length === 0) return;

      // Accounts the postings need.
      const accounts = new Map(accountRows.map((a) => [a.id, a]));
      const byKey = new Map(accountRows.filter((a) => a.key).map((a) => [a.key!, a.id]));
      const categories = new Map<string, string>();
      for (const x of toPost) for (const l of x.p.lines) if ("expenseCategory" in l.account) categories.set(l.account.expenseCategory.id, l.account.expenseCategory.name);
      for (const [catId, name] of categories) {
        const k = `expcat:${catId}`;
        if (byKey.has(k)) continue;
        const code = await this.nextExpenseCode(tx, tenantId);
        const [a] = await tx
          .insert(acctAccounts)
          .values({ tenantId, code, name, type: "expense", group: "indirect", subGroup: "Expense categories", key: k, system: false })
          .returning();
        accounts.set(a!.id, a!);
        byKey.set(k, a!.id);
      }
      // Standard accounts this shop's chart lacks (added to the chart later, or a code clash when it was topped up).
      const missingKeys = new Set<string>();
      for (const x of toPost) for (const l of x.p.lines) if ("key" in l.account && !byKey.has(l.account.key)) missingKeys.add(l.account.key);
      for (const k of missingKeys) {
        if (!STANDARD_CHART.some((c) => c.key === k)) continue;
        const id = await this.accountIdByKey(tenantId, k, tx);
        const [a] = await tx.select().from(acctAccounts).where(eq(acctAccounts.id, id)).limit(1);
        if (a) {
          accounts.set(a.id, a);
          byKey.set(k, a.id);
        }
      }
      const methodAccount = (m: string): string | undefined => {
        const chosen = settings.methodAccounts[m];
        if (chosen && accounts.has(chosen)) return chosen;
        return byKey.get(m === "cash" ? SYS.cash : SYS.bank);
      };
      const resolve = (l: DraftLine): string | undefined => {
        const a = l.account;
        if ("key" in a) return byKey.get(a.key);
        if ("method" in a) return methodAccount(a.method);
        if ("expenseCategory" in a) return byKey.get(`expcat:${a.expenseCategory.id}`);
        return accounts.has(a.id) ? a.id : undefined;
      };

      const total = toPost.length + toReverse.length;
      let seq = await this.nextNumbers(tx, tenantId, total);
      const entryRows: (typeof acctEntries.$inferInsert)[] = [];
      const lineRows: (typeof acctLines.$inferInsert)[] = [];
      const reversedUpdates: { id: string; by: string }[] = [];
      const lock = settings.lockedThrough;

      // Reversals first (their lines come from the stored entry).
      const revIds = toReverse.map((r) => r.entry.id);
      const storedLines: (typeof acctLines.$inferSelect)[] = [];
      for (const part of chunks(revIds, 1000)) storedLines.push(...(await tx.select().from(acctLines).where(inArray(acctLines.entryId, part))));
      const linesOf = new Map<string, (typeof acctLines.$inferSelect)[]>();
      for (const l of storedLines) linesOf.set(l.entryId, [...(linesOf.get(l.entryId) ?? []), l]);

      for (const r of toReverse) {
        const id = randomUUID();
        const eff = effectiveDate(r.entry.date, lock);
        const ls = linesOf.get(r.entry.id) ?? [];
        const amount = ls.reduce((t, l) => t + l.debit, 0);
        const n = seq++;
        entryRows.push({
          id,
          tenantId,
          seq: n,
          number: this.numberOf("reversal", n),
          voucherType: "reversal",
          origin: "auto",
          date: eff.date,
          lateFor: eff.late ? r.entry.date : null,
          narration: `Reversal: ${r.entry.narration} (${r.why})`,
          total: amount,
          reversalOfId: r.entry.id,
        });
        for (const l of ls) lineRows.push({ tenantId, entryId: id, lineNo: l.lineNo, accountId: l.accountId, entryDate: eff.date, debit: l.credit, credit: l.debit, memo: l.memo, partyType: l.partyType, partyId: l.partyId });
        reversedUpdates.push({ id: r.entry.id, by: id });
        bump(r.entry.sourceType ?? "?", "reversed");
        if (eff.late) result.late += 1;
      }

      for (const x of toPost) {
        const id = randomUUID();
        const eff = effectiveDate(x.p.date, lock);
        const resolved = x.p.lines.map((l) => ({ l, accountId: resolve(l) }));
        const missing = resolved.find((r) => !r.accountId);
        if (missing) {
          result.errors.push({ sourceType: x.p.sourceType, sourceId: x.p.sourceId, message: "An account is missing from the chart" });
          continue;
        }
        const amount = x.p.lines.reduce((t, l) => t + l.debit, 0);
        const n = seq++;
        entryRows.push({
          id,
          tenantId,
          seq: n,
          number: this.numberOf("auto", n),
          voucherType: "auto",
          origin: "auto",
          date: eff.date,
          lateFor: eff.late ? x.p.date : null,
          narration: x.p.narration,
          reference: x.p.reference ?? null,
          total: amount,
          sourceType: x.p.sourceType,
          sourceId: x.p.sourceId,
          sourceVersion: x.version,
          contentHash: x.hash,
        });
        resolved.forEach((r, i) =>
          lineRows.push({
            tenantId,
            entryId: id,
            lineNo: i + 1,
            accountId: r.accountId!,
            entryDate: eff.date,
            debit: r.l.debit,
            credit: r.l.credit,
            memo: r.l.memo ?? null,
            partyType: r.l.party?.type ?? null,
            partyId: r.l.party?.id ?? null,
          }),
        );
        bump(x.p.sourceType, "posted");
        if (eff.late) result.late += 1;
      }

      for (const part of chunks(entryRows, CHUNK)) await tx.insert(acctEntries).values(part);
      for (const part of chunks(lineRows, CHUNK * 4)) await tx.insert(acctLines).values(part);
      for (const u of reversedUpdates) {
        await tx.update(acctEntries).set({ status: "reversed", reversedById: u.by, reversedAt: this.now(), reversalReason: "Replaced automatically" }).where(eq(acctEntries.id, u.id));
      }
      await tx.update(acctSettings).set({ startDate: settings.startDate ?? startDate }).where(eq(acctSettings.tenantId, tenantId));
    });

    result.ms = Date.now() - t0;
    if (!dryRun) {
      await this.db
        .update(acctSettings)
        .set({ lastSyncAt: this.now(), lastSyncSummary: { posted: result.posted, reversed: result.reversed, unchanged: result.unchanged, late: result.late, errors: result.errors.length, ms: result.ms } })
        .where(eq(acctSettings.tenantId, tenantId));
      this.fresh.set(tenantId, this.now().getTime());
    }
    return result;
  }

  private async nextExpenseCode(tx: DbOrTx, tenantId: string): Promise<string> {
    const used = new Set((await tx.select({ code: acctAccounts.code }).from(acctAccounts).where(eq(acctAccounts.tenantId, tenantId))).map((r) => r.code));
    for (let n = EXPENSE_CATEGORY_CODE_BASE + 1; n < EXPENSE_CATEGORY_CODE_BASE + 900; n++) if (!used.has(String(n))) return String(n);
    throw conflict("No free account code left for the expense categories");
  }

  /**
   * Posts the history of a shop. `dryRun` counts what would be posted and writes nothing. A real run (with `from` =
   * ignore everything dated before it) turns automatic posting on for the shop; it is safe to repeat.
   */
  async backfill(tenantId: string, input: z.input<typeof backfillInput> = {}, userId: string | null = null): Promise<SyncResult> {
    const p = backfillInput.parse(input);
    await this.ensureInit(tenantId);
    if (p.dryRun) return this.sync(tenantId, { dryRun: true, from: p.from ?? null });
    if (p.from !== undefined && p.from !== null) await this.db.update(acctSettings).set({ postFrom: p.from }).where(eq(acctSettings.tenantId, tenantId));
    await this.db.update(acctSettings).set({ autoPost: true }).where(eq(acctSettings.tenantId, tenantId));
    const r = await this.sync(tenantId, { from: p.from ?? null });
    this.log.info({ tenantId, userId, posted: r.posted, reversed: r.reversed, ms: r.ms }, "accounting: backfill");
    return r;
  }

  // ================================================================ Part B posting (bank, cheques, TDS/TCS, assets, year-end)

  /**
   * The id of a standard account by its key, creating it when this shop's chart lacks it (a newer chart, or a code
   * clash when it was topped up): the standard code if free, else the next free code of its type.
   */
  async accountIdByKey(tenantId: string, key: string, db: DbOrTx = this.db): Promise<string> {
    await this.ensureInit(tenantId);
    const [a] = await db.select({ id: acctAccounts.id }).from(acctAccounts).where(and(eq(acctAccounts.tenantId, tenantId), eq(acctAccounts.key, key))).limit(1);
    if (a) return a.id;
    const row = STANDARD_CHART.find((c) => c.key === key);
    if (!row) throw notFound(`Account ${key}`);
    const create = async (tx: DbOrTx) => {
      await this.lockTenant(tx, tenantId);
      const [again] = await tx.select({ id: acctAccounts.id }).from(acctAccounts).where(and(eq(acctAccounts.tenantId, tenantId), eq(acctAccounts.key, key))).limit(1);
      if (again) return again.id;
      const [clash] = await tx
        .select({ id: acctAccounts.id, key: acctAccounts.key, name: acctAccounts.name, type: acctAccounts.type })
        .from(acctAccounts)
        .where(and(eq(acctAccounts.tenantId, tenantId), eq(acctAccounts.code, row.code)))
        .limit(1);
      // An older chart had this account without a key (e.g. 2200 Salaries payable): adopt it rather than add a twin.
      if (clash && !clash.key && clash.type === row.type && clash.name.trim().toLowerCase() === row.name.toLowerCase()) {
        await tx.update(acctAccounts).set({ key, system: true }).where(eq(acctAccounts.id, clash.id));
        return clash.id;
      }
      const code = clash ? await this.nextCode(tx, tenantId, row.type) : row.code;
      const [created] = await tx
        .insert(acctAccounts)
        .values({ tenantId, code, name: row.name, type: row.type, group: row.group, subGroup: row.subGroup ?? null, key, system: true, isCash: !!row.isCash, isBank: !!row.isBank, description: row.about ?? null, sort: 900 })
        .returning({ id: acctAccounts.id });
      return created!.id;
    };
    return db === this.db ? this.db.transaction(create) : create(db);
  }

  /** Net balance (debit - credit, paise) of one account at the end of a date. */
  async accountBalance(tenantId: string, accountId: string, asOf: string): Promise<number> {
    const [r] = await this.db
      .select({ net: sql<string>`coalesce(sum(${acctLines.debit} - ${acctLines.credit}), 0)` })
      .from(acctLines)
      .where(and(eq(acctLines.tenantId, tenantId), eq(acctLines.accountId, accountId), lte(acctLines.entryDate, asOf)));
    return num(r?.net);
  }

  /** Money account (cash or bank) a payment method posts to, following the settings mapping. */
  async methodAccountId(tenantId: string, method: string): Promise<string> {
    const s = await this.ensureInit(tenantId);
    const chosen = s.methodAccounts[method];
    if (chosen) {
      const [a] = await this.db.select({ id: acctAccounts.id }).from(acctAccounts).where(and(eq(acctAccounts.tenantId, tenantId), eq(acctAccounts.id, chosen))).limit(1);
      if (a) return a.id;
    }
    return this.accountIdByKey(tenantId, method === "cash" ? SYS.cash : SYS.bank);
  }

  /**
   * Posts a journal entry for a Part B record (a bank charge, a TDS deduction, depreciation, the closing journal ...).
   * It is an automatic entry (origin auto) with its own source type, so the document sync never touches it and it
   * can't be reversed from the journal screen: the record's own screen cancels it. Refused in a locked period unless
   * `ignoreLock` (the year-end close only). Pass `tx` to post inside the caller's transaction.
   */
  async postModuleEntry(
    tenantId: string,
    p: {
      sourceType: PartBSourceType;
      sourceId: string;
      date: string;
      narration: string;
      reference?: string | null;
      lines: { accountId: string; debit: number; credit: number; memo?: string | null; partyType?: "customer" | "supplier" | null; partyId?: string | null }[];
    },
    opts: { tx?: DbOrTx; userId?: string | null; ignoreLock?: boolean } = {},
  ): Promise<string> {
    const lines = p.lines.filter((l) => l.debit > 0 || l.credit > 0);
    for (const l of p.lines) {
      if (l.debit < 0 || l.credit < 0 || (l.debit > 0 && l.credit > 0) || !Number.isInteger(l.debit) || !Number.isInteger(l.credit)) throw badRequest("A line is either a debit or a credit, in whole paise");
    }
    const debit = lines.reduce((t, l) => t + l.debit, 0);
    const credit = lines.reduce((t, l) => t + l.credit, 0);
    if (lines.length < 2 || debit !== credit || debit <= 0) throw badRequest(`The entry does not balance (debits ${debit}, credits ${credit})`, { debit, credit });
    if (debit > MAX_PAISE) throw badRequest("The amount is too large");
    if (!isValidDate(p.date)) throw badRequest("Use a YYYY-MM-DD date");
    await this.ensureInit(tenantId);
    const run = async (tx: DbOrTx) => {
      await this.lockTenant(tx, tenantId);
      const s = await this.settings(tenantId, tx);
      if (!opts.ignoreLock) this.assertOpen(s.lockedThrough, p.date);
      const ids = [...new Set(lines.map((l) => l.accountId))];
      const accs = await tx.select({ id: acctAccounts.id, active: acctAccounts.active, name: acctAccounts.name }).from(acctAccounts).where(and(eq(acctAccounts.tenantId, tenantId), inArray(acctAccounts.id, ids)));
      if (accs.length !== ids.length) throw badRequest("One of the accounts was not found");
      const off = accs.find((a) => !a.active);
      if (off) throw badRequest(`Account "${off.name}" is switched off`);
      const [prev] = await tx
        .select({ v: sql<string>`coalesce(max(${acctEntries.sourceVersion}), 0)` })
        .from(acctEntries)
        .where(and(eq(acctEntries.tenantId, tenantId), eq(acctEntries.sourceType, p.sourceType), eq(acctEntries.sourceId, p.sourceId)));
      const seq = await this.nextNumbers(tx, tenantId, 1);
      const id = randomUUID();
      await tx.insert(acctEntries).values({
        id,
        tenantId,
        seq,
        number: this.numberOf("auto", seq),
        voucherType: "auto",
        origin: "auto",
        date: p.date,
        narration: p.narration.slice(0, 500),
        reference: p.reference ?? null,
        total: debit,
        sourceType: p.sourceType,
        sourceId: p.sourceId,
        sourceVersion: num(prev?.v) + 1,
        contentHash: postingHash({ date: p.date, narration: p.narration, lines: lines.map((l) => ({ account: { id: l.accountId }, debit: l.debit, credit: l.credit })) }),
        createdBy: opts.userId ?? null,
      });
      await tx.insert(acctLines).values(
        lines.map((l, i) => ({
          tenantId,
          entryId: id,
          lineNo: i + 1,
          accountId: l.accountId,
          entryDate: p.date,
          debit: l.debit,
          credit: l.credit,
          memo: l.memo ?? null,
          partyType: l.partyType ?? null,
          partyId: l.partyId ?? null,
        })),
      );
      return id;
    };
    const id = opts.tx ? await run(opts.tx) : await this.db.transaction(run);
    this.fresh.delete(tenantId);
    return id;
  }

  /** Reverses a Part B entry (lines swapped, dated `date`), marking the original reversed. Returns the reversal's id. */
  async reverseModuleEntry(
    tenantId: string,
    entryId: string,
    p: { date: string; reason: string; sourceType: PartBSourceType },
    opts: { tx?: DbOrTx; userId?: string | null; ignoreLock?: boolean } = {},
  ): Promise<string> {
    const run = async (tx: DbOrTx) => {
      await this.lockTenant(tx, tenantId);
      const s = await this.settings(tenantId, tx);
      const [e] = await tx.select().from(acctEntries).where(and(eq(acctEntries.tenantId, tenantId), eq(acctEntries.id, entryId))).limit(1);
      if (!e) throw notFound("Entry");
      if (e.status === "reversed") throw conflict("This entry is already reversed");
      const when = p.date < e.date ? e.date : p.date;
      if (!opts.ignoreLock) this.assertOpen(s.lockedThrough, when);
      const lines = await tx.select().from(acctLines).where(eq(acctLines.entryId, entryId)).orderBy(asc(acctLines.lineNo));
      const seq = await this.nextNumbers(tx, tenantId, 1);
      const id = randomUUID();
      await tx.insert(acctEntries).values({
        id,
        tenantId,
        seq,
        number: this.numberOf("reversal", seq),
        voucherType: "reversal",
        origin: "auto",
        date: when,
        narration: `Reversal of ${e.number}: ${p.reason}`.slice(0, 500),
        total: e.total,
        sourceType: p.sourceType,
        sourceId: e.sourceId,
        sourceVersion: e.sourceVersion,
        reversalOfId: e.id,
        createdBy: opts.userId ?? null,
      });
      await tx.insert(acctLines).values(lines.map((l) => ({ tenantId, entryId: id, lineNo: l.lineNo, accountId: l.accountId, entryDate: when, debit: l.credit, credit: l.debit, memo: l.memo, partyType: l.partyType, partyId: l.partyId })));
      await tx.update(acctEntries).set({ status: "reversed", reversedById: id, reversedAt: this.now(), reversalReason: p.reason.slice(0, 300) }).where(eq(acctEntries.id, e.id));
      return id;
    };
    const id = opts.tx ? await run(opts.tx) : await this.db.transaction(run);
    this.fresh.delete(tenantId);
    return id;
  }

  // ================================================================ reconciliation

  async reconcile(tenantId: string, q: { from?: string; to?: string } = {}) {
    await this.ensureInit(tenantId);
    await this.ensureFresh(tenantId);
    const settings = await this.settings(tenantId);
    const { from, to } = await this.range(q);
    const accounts = await this.accountInfos(tenantId);
    const keyId = new Map(accounts.filter((a) => a.key).map((a) => [a.key!, a.id]));
    const all = await this.balancesTo(tenantId, "9999-12-31");
    const net = (k: string) => {
      const b = all.get(keyId.get(k) ?? "");
      return b ? b.debit - b.credit : 0;
    };

    // Ledger sums from automatic entries only (what the documents posted).
    const autoRows = await this.db
      .select({ id: acctLines.accountId, debit: sql<string>`coalesce(sum(${acctLines.debit}), 0)`, credit: sql<string>`coalesce(sum(${acctLines.credit}), 0)` })
      .from(acctLines)
      .innerJoin(acctEntries, eq(acctEntries.id, acctLines.entryId))
      .where(and(eq(acctLines.tenantId, tenantId), eq(acctEntries.origin, "auto")))
      .groupBy(acctLines.accountId);
    const auto = new Map(autoRows.map((r) => [r.id, { debit: num(r.debit), credit: num(r.credit) }]));
    const autoNet = (k: string) => {
      const b = auto.get(keyId.get(k) ?? "");
      return b ? b.debit - b.credit : 0;
    };

    const docs = await this.loadDocs(tenantId);
    const o: RuleOptions = { importedBills: settings.importedBills, shopState: docs.shopState, valueStock: settings.valueStock };
    const checks: ReconcileCheck[] = [];
    const add = (c: Omit<ReconcileCheck, "difference" | "ok"> & { tolerance?: number }) => {
      const difference = c.ledger - c.source;
      checks.push({ ...c, difference, ok: Math.abs(difference) <= (c.tolerance ?? 0) });
    };

    // 1. The books balance.
    const totals = [...all.values()].reduce((t, b) => ({ debit: t.debit + b.debit, credit: t.credit + b.credit }), { debit: 0, credit: 0 });
    add({ key: "trial_balance", label: "Total debits equal total credits", ledger: totals.debit, source: totals.credit });

    // 2-4. Sales and returns against the bills and credit notes.
    const live = docs.invoices.filter((i) => (settings.importedBills === "post" || !i.imported) && i.status !== "cancelled" && (!settings.postFrom || i.date >= settings.postFrom));
    const gross = live.reduce((t, i) => t + (i.total + i.discount - i.cgst - i.sgst - i.igst - i.roundOff), 0);
    add({ key: "sales", label: "Sales in the books match the bills issued (before GST, before discount)", ledger: -autoNet(SYS.sales), source: gross });
    add({
      key: "sales_taxable",
      label: "Sales less discount equal the taxable value on the bills",
      ledger: -autoNet(SYS.sales) - autoNet(SYS.discountAllowed),
      source: live.reduce((t, i) => t + i.taxable, 0),
      note: "A difference here means a bill's stored totals do not add up; the books follow the bill total.",
    });
    const notes = docs.creditNotes.filter((c) => c.status === "issued" && !c.invoiceCancelled && (settings.importedBills === "post" || !c.invoiceImported) && (!settings.postFrom || c.date >= settings.postFrom));
    add({
      key: "sales_returns",
      label: "Sales returns match the credit notes issued",
      ledger: autoNet(SYS.salesReturns),
      source: notes.reduce((t, c) => t + (c.total - c.cgst - c.sgst - c.igst - c.roundOff), 0),
    });

    // 5. Receivables control against the credit book.
    const partyRows = await this.db
      .select({ type: acctLines.partyType, id: acctLines.partyId, acct: acctLines.accountId, debit: sql<string>`coalesce(sum(${acctLines.debit}), 0)`, credit: sql<string>`coalesce(sum(${acctLines.credit}), 0)` })
      .from(acctLines)
      .where(and(eq(acctLines.tenantId, tenantId), inArray(acctLines.accountId, [keyId.get(SYS.debtors)!, keyId.get(SYS.creditors)!])))
      .groupBy(acctLines.partyType, acctLines.partyId, acctLines.accountId);
    const debtorsNet = net(SYS.debtors);
    const creditorsNet = -net(SYS.creditors);
    const manualRows = await this.db
      .select({ acct: acctLines.accountId, debit: sql<string>`coalesce(sum(${acctLines.debit}), 0)`, credit: sql<string>`coalesce(sum(${acctLines.credit}), 0)` })
      .from(acctLines)
      .innerJoin(acctEntries, eq(acctEntries.id, acctLines.entryId))
      .where(and(eq(acctLines.tenantId, tenantId), eq(acctEntries.origin, "manual"), inArray(acctLines.accountId, [keyId.get(SYS.debtors)!, keyId.get(SYS.creditors)!])))
      .groupBy(acctLines.accountId);
    const manualOf = (k: string) => {
      const r = manualRows.find((m) => m.acct === keyId.get(k));
      return r ? num(r.debit) - num(r.credit) : 0;
    };
    // Part B entries on the control accounts (TCS collected, bank-statement entries with a party, TDS not settled in
    // Payables) are not in the credit book / Payables: set aside like manual entries.
    const partBRows = await this.db
      .select({ acct: acctLines.accountId, net: sql<string>`coalesce(sum(${acctLines.debit} - ${acctLines.credit}), 0)` })
      .from(acctLines)
      .innerJoin(acctEntries, eq(acctEntries.id, acctLines.entryId))
      .where(
        and(
          eq(acctLines.tenantId, tenantId),
          inArray(acctLines.accountId, [keyId.get(SYS.debtors)!, keyId.get(SYS.creditors)!]),
          inArray(acctEntries.sourceType, [...PART_B_SOURCE_TYPES]),
          sql`not exists (select 1 from acct_tds_entries t where t.tenant_id = ${tenantId} and t.id::text = ${acctEntries.sourceId} and t.settlement_id is not null)`,
        ),
      )
      .groupBy(acctLines.accountId);
    const partBOf = (k: string) => num(partBRows.find((r) => r.acct === keyId.get(k))?.net);
    const walkIn = partyRows.filter((r) => r.acct === keyId.get(SYS.debtors) && r.type === "customer" && r.id === null).reduce((t, r) => t + num(r.debit) - num(r.credit), 0);

    // What the imported-history setting leaves out of the books but the credit book still counts.
    const withImported = this.postingsOf(docs, { ...o, importedBills: "post" });
    const withoutImported = this.postingsOf(docs, { ...o, importedBills: "exclude" });
    const effect = (ps: Posting[], k: string, sign: 1 | -1) =>
      ps.reduce((t, p) => t + p.lines.filter((l) => "key" in l.account && l.account.key === k).reduce((s, l) => s + sign * (l.debit - l.credit), 0), 0);
    const importedDebtors = settings.importedBills === "exclude" ? effect(withImported, SYS.debtors, 1) - effect(withoutImported, SYS.debtors, 1) : 0;
    const importedCreditors = settings.importedBills === "exclude" ? effect(withImported, SYS.creditors, -1) - effect(withoutImported, SYS.creditors, -1) : 0;

    if (this.deps.reconcile) {
      const [cust, supp] = await Promise.all([this.deps.reconcile.customerBalances(tenantId), this.deps.reconcile.supplierBalances(tenantId)]);
      const custTotal = cust.reduce((t, c) => t + c.balance, 0);
      const suppTotal = supp.reduce((t, c) => t + c.balance, 0);
      add({
        key: "receivables",
        label: "Customers (debtors) in the books match the credit book",
        ledger: debtorsNet - walkIn - manualOf(SYS.debtors) - partBOf(SYS.debtors),
        source: custTotal - importedDebtors,
        explained: [
          ...(walkIn ? [{ label: "Bills to walk-in customers with no name on file (not in the credit book)", amount: walkIn }] : []),
          ...(manualOf(SYS.debtors) ? [{ label: "Manual journal entries on the debtors account", amount: manualOf(SYS.debtors) }] : []),
          ...(partBOf(SYS.debtors) ? [{ label: "TCS collected and bank-statement entries on customers (not in the credit book)", amount: partBOf(SYS.debtors) }] : []),
          ...(importedDebtors ? [{ label: "Imported historical bills left out of the books", amount: importedDebtors }] : []),
        ],
        note: "Compared after setting aside the explained items below.",
      });
      add({
        key: "payables",
        label: "Suppliers (creditors) in the books match Payables",
        ledger: creditorsNet + manualOf(SYS.creditors) + partBOf(SYS.creditors),
        source: suppTotal - importedCreditors,
        explained: [
          ...(manualOf(SYS.creditors) ? [{ label: "Manual journal entries on the creditors account", amount: -manualOf(SYS.creditors) }] : []),
          ...(partBOf(SYS.creditors) ? [{ label: "TDS not recorded on the bills in Payables, and bank-statement entries on suppliers", amount: -partBOf(SYS.creditors) }] : []),
          ...(importedCreditors ? [{ label: "Imported historical purchase bills left out of the books", amount: importedCreditors }] : []),
        ],
        note: "Compared after setting aside the explained items below.",
      });
      // 7-8. GST against the existing GST summaries for the dates.
      const during = await this.balancesBetween(tenantId, from, to);
      const gst = buildGstLedger(accounts, during, { from, to }, 0);
      const [salesGst, itc] = await Promise.all([this.deps.reconcile.salesGst(tenantId, from, to), this.deps.reconcile.purchaseItc(tenantId, from, to)]);
      add({
        key: "gst_output",
        label: `GST collected on sales ${from} to ${to} matches the GST summary`,
        ledger: gst.output.cgst + gst.output.sgst + gst.output.igst,
        source: salesGst.cgst + salesGst.sgst + salesGst.igst,
        note: "The GST summary leaves out imported history; the books follow the import setting.",
      });
      const expenseItc = docs.expenses.filter((e) => e.status === "recorded" && e.date >= from && e.date <= to).reduce((t, e) => t + Math.min(e.itc, e.amount), 0);
      const taxOf = (d: { cgst: number; sgst: number; igst: number }) => d.cgst + d.sgst + d.igst;
      const inRange = (d: string) => d >= from && d <= to && (!settings.postFrom || d >= settings.postFrom);
      const importedItc = settings.importedBills === "exclude" ? docs.purchases.filter((p) => p.imported && p.status === "recorded" && inRange(p.date)).reduce((t, p) => t + taxOf(p), 0) : 0;
      const debitNoteItc = docs.debitNotes.filter((d) => d.status === "issued" && (settings.importedBills === "post" || !d.purchaseImported) && inRange(d.date)).reduce((t, d) => t + taxOf(d), 0);
      add({
        key: "gst_input",
        label: `GST input credit ${from} to ${to} matches purchases and expenses`,
        ledger: gst.input.cgst + gst.input.sgst + gst.input.igst,
        source: taxOf(itc) + expenseItc - debitNoteItc - importedItc,
        note: "Input credit from the purchases report, plus the GST claimable on expenses, less debit notes (and imported history when it is left out of the books).",
      });
    }
    return { asOf: this.today(), from, to, ok: checks.every((c) => c.ok), checks };
  }

  /** Per customer / supplier: the books against the credit book / payables, differences first. */
  async reconcileParties(tenantId: string, q: { type: "customer" | "supplier" }): Promise<{ type: string; items: PartyDifference[]; total: { ledger: number; source: number; difference: number } }> {
    await this.ensureInit(tenantId);
    await this.ensureFresh(tenantId);
    if (!this.deps.reconcile) throw badRequest("Reconciliation is not available");
    const type = z.enum(PARTY_TYPES).parse(q.type);
    const accounts = await this.accountInfos(tenantId);
    const accountId = accounts.find((a) => a.key === (type === "customer" ? SYS.debtors : SYS.creditors))?.id;
    if (!accountId) throw notFound("Control account");
    const rows = await this.db
      .select({ id: acctLines.partyId, debit: sql<string>`coalesce(sum(${acctLines.debit}), 0)`, credit: sql<string>`coalesce(sum(${acctLines.credit}), 0)` })
      .from(acctLines)
      .where(and(eq(acctLines.tenantId, tenantId), eq(acctLines.accountId, accountId), or(eq(acctLines.partyType, type), isNull(acctLines.partyType))))
      .groupBy(acctLines.partyId);
    const sign = type === "customer" ? 1 : -1;
    const ledger = new Map(rows.map((r) => [r.id, sign * (num(r.debit) - num(r.credit))]));
    const src = type === "customer" ? await this.deps.reconcile.customerBalances(tenantId) : await this.deps.reconcile.supplierBalances(tenantId);
    const out = new Map<string | null, PartyDifference>();
    for (const s of src) out.set(s.id, { partyId: s.id, name: s.name, ledger: ledger.get(s.id) ?? 0, source: s.balance, difference: 0 });
    for (const [id, amount] of ledger) {
      if (!out.has(id)) out.set(id, { partyId: id, name: id ? "(customer or supplier no longer listed)" : type === "customer" ? "Walk-in bills (no customer)" : "No supplier", ledger: amount, source: 0, difference: 0 });
    }
    const items = [...out.values()].map((r) => ({ ...r, difference: r.ledger - r.source })).filter((r) => r.ledger !== 0 || r.source !== 0);
    items.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.name.localeCompare(b.name));
    return { type, items, total: items.reduce((t, r) => ({ ledger: t.ledger + r.ledger, source: t.source + r.source, difference: t.difference + r.difference }), { ledger: 0, source: 0, difference: 0 }) };
  }

  // ================================================================ downloads

  /** Any report as a flat table (CSV download and PDF). `report` is the URL name: trial-balance, profit-loss, ... */
  async reportTable(tenantId: string, report: string, q: Record<string, string | undefined> = {}): Promise<ReportTable> {
    const shop = (await this.deps.shopName?.(tenantId)) ?? "";
    const extra = this.extraReport ? await this.extraReport(tenantId, report, q, shop) : null;
    if (extra) return extra;
    switch (report) {
      case "trial-balance":
        return trialBalanceTable(await this.trialBalance(tenantId, q), shop);
      case "profit-loss":
        return profitLossTable(await this.profitLoss(tenantId, q), shop);
      case "balance-sheet":
        return balanceSheetTable(await this.balanceSheet(tenantId, q), shop);
      case "gst-ledger":
        return gstTable(await this.gstLedger(tenantId, q), shop);
      case "ledger":
        return ledgerTable(await this.accountLedger(tenantId, { accountId: q.accountId ?? "", from: q.from, to: q.to, partyId: q.partyId }), shop);
      case "cash-book":
        return ledgerTable(await this.cashBook(tenantId, q), shop);
      case "day-book": {
        const { from, to } = await this.range(q);
        const items: EntryView[] = [];
        for (let offset = 0; offset < 5000; offset += 200) {
          const page = await this.listEntries(tenantId, { from, to, limit: 200, offset, sort: "date" });
          items.push(...page.items);
          if (offset + 200 >= page.total) break;
        }
        return dayBookTable(items, { from, to }, shop);
      }
      default:
        throw notFound("Report");
    }
  }

  // ================================================================ overview

  async overview(tenantId: string) {
    const s = await this.getSettings(tenantId);
    const [accounts] = await this.db.select({ n: sql<string>`count(*)` }).from(acctAccounts).where(eq(acctAccounts.tenantId, tenantId));
    return { ...s, accountCount: num(accounts?.n), today: this.today(), sourceLabels: SOURCE_LABELS };
  }

  /** Guard used by routes that must not run for shops that have not switched the books on. */
  requireNotLocked(lockedThrough: string | null, d: string) {
    if (lockedThrough && d <= lockedThrough) throw forbidden(`The books are locked up to ${lockedThrough}`);
  }

  /** Deletes all accounting rows of a shop (used by tests and the dev cleanup script only). */
  async wipe(tenantId: string) {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('acct.allow_delete', 'on', true)`);
      await tx.delete(acctLines).where(eq(acctLines.tenantId, tenantId));
      await tx.delete(acctEntries).where(eq(acctEntries.tenantId, tenantId));
      await tx.delete(acctAccounts).where(eq(acctAccounts.tenantId, tenantId));
      await tx.delete(acctLockLog).where(eq(acctLockLog.tenantId, tenantId));
      await tx.delete(acctSettings).where(eq(acctSettings.tenantId, tenantId));
    });
    this.ready.delete(tenantId);
    this.fresh.delete(tenantId);
  }
}

export function kindLabel(e: { voucherType: string; sourceType: string | null }): string {
  if (e.sourceType && e.sourceType in SOURCE_LABELS) return SOURCE_LABELS[e.sourceType as SourceType];
  if (e.sourceType && e.sourceType in PART_B_LABELS) return PART_B_LABELS[e.sourceType as PartBSourceType];
  switch (e.voucherType) {
    case "journal":
      return "Journal voucher";
    case "contra":
      return "Contra (cash and bank)";
    case "payment":
      return "Payment voucher";
    case "receipt":
      return "Receipt voucher";
    case "reversal":
      return "Reversal";
    default:
      return "Automatic entry";
  }
}

export { mirror };
export type { ImportedMode, ManualVoucherType, MoneyMethod };

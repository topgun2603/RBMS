import { badRequest, conflict, defineSort, facetCounts, listFilter, listQuerySchema, notFound, rangeOrder, searchAny, splitList } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { GST_RATES, isValidDate, normalizeGstin, todayIST } from "@srirealtime/gst";
import { and, asc, count, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { itcOf, profitReport, resolveGst, summarize, ZERO_GST, type ExpenseSummary, type ProfitReport } from "./logic";
import type { LoggerPort, PurchasesReportPort, SalesReportPort } from "./ports";
import {
  BUILTIN_CATEGORIES,
  EXPENSE_PAYMENT_METHODS,
  EXPENSE_STATUSES,
  expenseCategories,
  expenses,
  type ExpenseCategory,
  type ExpenseRow,
} from "./schema";

export interface ExpensesDeps {
  db: Db;
  /** Sales GST totals (invoices). Without it sales are zero in the profit report. */
  sales?: SalesReportPort;
  /** Purchase totals (inventory purchases). Without it purchases are zero. */
  purchases?: PurchasesReportPort;
  log?: LoggerPort;
  now?: () => Date;
}

/** Money columns are Postgres `integer` (paise). */
export const MAX_PAISE = 2_000_000_000;
export const MAX_REPORT_DAYS = 366;

const date = z.string().refine(isValidDate, "Use a YYYY-MM-DD date");
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const gstRate = z.number().refine((r) => (GST_RATES as readonly number[]).includes(r), "Not a GST rate");

export const expenseInput = z
  .object({
    date: date.optional(),
    categoryId: z.string().uuid().optional(),
    amount: z.number().int().positive().max(MAX_PAISE),
    gstRate: gstRate.default(0),
    /** GST inside `amount`; computed from the rate when left out. */
    gstAmount: z.number().int().min(0).max(MAX_PAISE).nullish(),
    vendorName: optText(200),
    vendorGstin: optText(20).transform((v) => (v ? normalizeGstin(v) : null)),
    paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS).default("cash"),
    reference: optText(100),
    note: optText(1000),
    receiptUrl: optText(2048),
  })
  .strict();
export type ExpenseInput = z.input<typeof expenseInput>;

export const expensePatch = expenseInput
  .partial()
  .extend({ gstRate: gstRate.optional(), paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS).optional() })
  .strict();
export type ExpensePatch = z.input<typeof expensePatch>;

/**
 * GET /v1/expenses (docs/CONVENTIONS.md → "Lists and tables"). Limits 50 / 500 (the CSV export asks for 500).
 * `status`: "recorded" when left out (as before), "all", or a comma list; `categoryId` and `paymentMethod` take comma
 * lists; `q` matches vendor, note and reference.
 */
export const listQuery = listQuerySchema({ defaultLimit: 50, maxLimit: 500 })
  .extend({
    from: listFilter.date(),
    to: listFilter.date(),
    categoryId: listFilter.ids(),
    paymentMethod: listFilter.oneOf(EXPENSE_PAYMENT_METHODS),
    status: z.preprocess(splitList, z.array(z.enum([...EXPENSE_STATUSES, "all"])).max(3).optional()),
  })
  .superRefine(rangeOrder("from", "to"));
export type ExpenseListQuery = z.input<typeof listQuery>;

export const categoryInput = z.object({ name: z.string().trim().min(1).max(60), sort: z.number().int().min(0).max(10_000).optional() });
export const categoryPatch = categoryInput.partial();

export interface ExpenseView extends ExpenseRow {
  categoryName: string;
  /** amount − gstAmount. */
  taxable: number;
  /** Claimable input tax credit (GST when the vendor GSTIN is valid). */
  itc: number;
}

export interface ExpenseList {
  items: ExpenseView[];
  total: number;
  limit: number;
  offset: number;
  totals: { amount: number; gst: number; itc: number };
  /** `category` (ids), `paymentMethod` and `status` counts under the other filters. */
  facets: Record<string, Record<string, number>>;
}

/** Expense list sort: `category` by the category's name. Default: newest first. */
export const EXPENSE_SORT = defineSort(
  {
    date: expenses.date,
    amount: expenses.amount,
    category: sql`(select lower(${expenseCategories.name}) from ${expenseCategories} where ${expenseCategories.id} = ${expenses.categoryId})`,
  },
  { default: "-date", tieBreaker: [expenses.createdAt, expenses.id] },
);

type ExpenseFacet = "category" | "paymentMethod" | "status";

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}


/** Checks a report period; defaults to the current IST month up to today. */
export function reportRange(q: { from?: string; to?: string }, today: string): { from: string; to: string } {
  const from = q.from ?? `${today.slice(0, 7)}-01`;
  const to = q.to ?? today;
  if (!isValidDate(from) || !isValidDate(to)) throw badRequest("Use YYYY-MM-DD dates");
  if (to < from) throw badRequest("'to' must be on or after 'from'");
  if (Date.parse(to) - Date.parse(from) > MAX_REPORT_DAYS * 86_400_000) throw badRequest("Reports cover at most one year");
  return { from, to };
}

export class ExpensesService {
  private readonly db: Db;
  private readonly now: () => Date;

  constructor(private readonly deps: ExpensesDeps) {
    this.db = deps.db;
    this.now = deps.now ?? (() => new Date());
  }

  private today() {
    return todayIST(this.now());
  }

  // ---------------------------------------------------------------- categories

  /** The shop's categories (built-ins seeded on first use), by sort then name. */
  async categories(tenantId: string): Promise<ExpenseCategory[]> {
    const list = () =>
      this.db
        .select()
        .from(expenseCategories)
        .where(eq(expenseCategories.tenantId, tenantId))
        .orderBy(asc(expenseCategories.sort), asc(expenseCategories.name));
    let rows = await list();
    if (rows.length === 0) {
      await this.db
        .insert(expenseCategories)
        .values(BUILTIN_CATEGORIES.map((name, i) => ({ tenantId, name, sort: (i + 1) * 10, builtin: true })))
        .onConflictDoNothing();
      rows = await list();
    }
    return rows;
  }

  private async category(tenantId: string, id: string): Promise<ExpenseCategory> {
    const [row] = await this.db
      .select()
      .from(expenseCategories)
      .where(and(eq(expenseCategories.tenantId, tenantId), eq(expenseCategories.id, id)))
      .limit(1);
    if (!row) throw notFound("Category");
    return row;
  }

  async createCategory(tenantId: string, input: unknown): Promise<ExpenseCategory> {
    const body = categoryInput.parse(input);
    const existing = await this.categories(tenantId);
    const sort = body.sort ?? Math.max(0, ...existing.map((c) => c.sort)) + 10;
    try {
      const [row] = await this.db.insert(expenseCategories).values({ tenantId, name: body.name, sort }).returning();
      return row!;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("A category with that name exists");
      throw err;
    }
  }

  async updateCategory(tenantId: string, id: string, input: unknown): Promise<ExpenseCategory> {
    const body = categoryPatch.parse(input);
    const current = await this.category(tenantId, id);
    if (body.name === undefined && body.sort === undefined) return current;
    try {
      const [row] = await this.db
        .update(expenseCategories)
        .set(body)
        .where(and(eq(expenseCategories.tenantId, tenantId), eq(expenseCategories.id, id)))
        .returning();
      return row!;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("A category with that name exists");
      throw err;
    }
  }

  /** Deletes a custom category that no expense uses. */
  async deleteCategory(tenantId: string, id: string): Promise<void> {
    const c = await this.category(tenantId, id);
    if (c.builtin) throw badRequest("Built-in categories can't be deleted");
    const [used] = await this.db
      .select({ n: count() })
      .from(expenses)
      .where(and(eq(expenses.tenantId, tenantId), eq(expenses.categoryId, id)));
    if ((used?.n ?? 0) > 0) throw conflict("This category has expenses; move them first");
    await this.db.delete(expenseCategories).where(and(eq(expenseCategories.tenantId, tenantId), eq(expenseCategories.id, id)));
  }

  /** The given category (must belong to the shop), or the built-in "Other". */
  private async categoryIdFor(tenantId: string, id: string | undefined): Promise<string> {
    const cats = await this.categories(tenantId);
    if (id) {
      if (!cats.some((c) => c.id === id)) throw badRequest("Unknown category");
      return id;
    }
    return (cats.find((c) => c.builtin && c.name === "Other") ?? cats.find((c) => c.name === "Other") ?? cats[cats.length - 1]!).id;
  }

  // ---------------------------------------------------------------- expenses

  private view(row: ExpenseRow, names: Map<string, string>): ExpenseView {
    return { ...row, categoryName: names.get(row.categoryId) ?? "Other", taxable: row.amount - row.gstAmount, itc: itcOf(row) };
  }

  private async names(tenantId: string) {
    return new Map((await this.categories(tenantId)).map((c) => [c.id, c.name]));
  }

  /** WHERE of the expense list; `without` leaves one filter out (for that filter's facet counts). */
  listConditions(tenantId: string, q: z.output<typeof listQuery>, without?: ExpenseFacet): SQL | undefined {
    const statuses = q.status?.includes("all") ? undefined : (q.status ?? ["recorded" as const]);
    return and(
      eq(expenses.tenantId, tenantId),
      q.from ? gte(expenses.date, q.from) : undefined,
      q.to ? lte(expenses.date, q.to) : undefined,
      without !== "category" && q.categoryId?.length ? inArray(expenses.categoryId, q.categoryId) : undefined,
      without !== "paymentMethod" && q.paymentMethod?.length ? inArray(expenses.paymentMethod, q.paymentMethod) : undefined,
      without !== "status" && statuses?.length
        ? inArray(
            expenses.status,
            statuses.filter((s): s is (typeof EXPENSE_STATUSES)[number] => s !== "all"),
          )
        : undefined,
      searchAny(q.q, [expenses.vendorName, expenses.note, expenses.reference]),
    );
  }

  /**
   * Expenses: paged, sorted (EXPENSE_SORT, default newest first) and filtered. `totals` cover every matching recorded
   * expense; `facets` count category, payment method and status under the other filters.
   */
  async list(tenantId: string, query: ExpenseListQuery = {}): Promise<ExpenseList> {
    const q = listQuery.parse(query);
    const order = EXPENSE_SORT.orderBy(q.sort);
    const where = this.listConditions(tenantId, q);
    const facet = (col: typeof expenses.categoryId | typeof expenses.paymentMethod | typeof expenses.status, without: ExpenseFacet) =>
      this.db.select({ key: col, n: count() }).from(expenses).where(this.listConditions(tenantId, q, without)).groupBy(col);
    const [rows, all, names, byCategory, byMethod, byStatus] = await Promise.all([
      this.db.select().from(expenses).where(where).orderBy(...order).limit(q.limit).offset(q.offset),
      // Totals need the GSTIN check per row, so they're summed here rather than in SQL.
      this.db
        .select({ amount: expenses.amount, gstAmount: expenses.gstAmount, vendorGstin: expenses.vendorGstin, status: expenses.status })
        .from(expenses)
        .where(where),
      this.names(tenantId),
      facet(expenses.categoryId, "category"),
      facet(expenses.paymentMethod, "paymentMethod"),
      facet(expenses.status, "status"),
    ]);
    const totals = { amount: 0, gst: 0, itc: 0 };
    for (const r of all) {
      if (r.status === "cancelled") continue;
      totals.amount += r.amount;
      totals.gst += r.gstAmount;
      totals.itc += itcOf(r);
    }
    return {
      items: rows.map((r) => this.view(r, names)),
      total: all.length,
      limit: q.limit,
      offset: q.offset,
      totals,
      facets: { category: facetCounts(byCategory), paymentMethod: facetCounts(byMethod), status: facetCounts(byStatus) },
    };
  }

  private async row(tenantId: string, id: string): Promise<ExpenseRow> {
    const [row] = await this.db
      .select()
      .from(expenses)
      .where(and(eq(expenses.tenantId, tenantId), eq(expenses.id, id)))
      .limit(1);
    if (!row) throw notFound("Expense");
    return row;
  }

  async get(tenantId: string, id: string): Promise<ExpenseView> {
    return this.view(await this.row(tenantId, id), await this.names(tenantId));
  }

  async create(tenantId: string, input: unknown, userId: string | null): Promise<ExpenseView> {
    const body = expenseInput.parse(input);
    const gstAmount = resolveGst(body.amount, body.gstRate, body.gstAmount);
    if (gstAmount > body.amount) throw badRequest("GST can't be more than the amount");
    const categoryId = await this.categoryIdFor(tenantId, body.categoryId);
    const [row] = await this.db
      .insert(expenses)
      .values({
        tenantId,
        date: body.date ?? this.today(),
        categoryId,
        amount: body.amount,
        gstRate: body.gstRate,
        gstAmount,
        vendorName: body.vendorName,
        vendorGstin: body.vendorGstin,
        paymentMethod: body.paymentMethod,
        reference: body.reference,
        note: body.note,
        receiptUrl: body.receiptUrl,
        createdBy: userId,
      })
      .returning();
    return this.view(row!, await this.names(tenantId));
  }

  /** Updates a recorded expense. GST is recomputed from amount and rate when either changes and no gstAmount is given. */
  async update(tenantId: string, id: string, input: unknown): Promise<ExpenseView> {
    const patch = expensePatch.parse(input);
    const current = await this.row(tenantId, id);
    if (current.status === "cancelled") throw badRequest("This expense is cancelled");
    const amount = patch.amount ?? current.amount;
    const rate = patch.gstRate ?? current.gstRate;
    const gstAmount =
      patch.gstAmount !== undefined && patch.gstAmount !== null
        ? patch.gstAmount
        : patch.amount !== undefined || patch.gstRate !== undefined || patch.gstAmount === null
          ? resolveGst(amount, rate)
          : current.gstAmount;
    if (gstAmount > amount) throw badRequest("GST can't be more than the amount");
    const { gstAmount: _g, categoryId, ...rest } = patch;
    const set: Partial<typeof expenses.$inferInsert> = { ...rest, amount, gstRate: rate, gstAmount };
    if (categoryId) set.categoryId = await this.categoryIdFor(tenantId, categoryId);
    const [row] = await this.db
      .update(expenses)
      .set(set)
      .where(and(eq(expenses.tenantId, tenantId), eq(expenses.id, id)))
      .returning();
    return this.view(row!, await this.names(tenantId));
  }

  /** Cancels an expense (kept for the record, left out of totals). */
  async cancel(tenantId: string, id: string): Promise<ExpenseView> {
    await this.row(tenantId, id);
    const [row] = await this.db
      .update(expenses)
      .set({ status: "cancelled" })
      .where(and(eq(expenses.tenantId, tenantId), eq(expenses.id, id)))
      .returning();
    return this.view(row!, await this.names(tenantId));
  }

  // ---------------------------------------------------------------- reports

  private async recorded(tenantId: string, from: string, to: string) {
    return this.db
      .select({
        date: expenses.date,
        categoryId: expenses.categoryId,
        amount: expenses.amount,
        gstAmount: expenses.gstAmount,
        vendorGstin: expenses.vendorGstin,
        status: expenses.status,
      })
      .from(expenses)
      .where(
        and(eq(expenses.tenantId, tenantId), eq(expenses.status, "recorded"), gte(expenses.date, from), lte(expenses.date, to)),
      );
  }

  /** By category and by month for a period (default: this month). */
  async summary(tenantId: string, q: { from?: string; to?: string } = {}): Promise<ExpenseSummary & { from: string; to: string }> {
    const { from, to } = reportRange(q, this.today());
    const [rows, cats] = await Promise.all([this.recorded(tenantId, from, to), this.categories(tenantId)]);
    return { from, to, ...summarize(rows, cats) };
  }

  /** Sales vs purchases vs expenses and the GST position for a period (default: this month). */
  async profit(tenantId: string, q: { from?: string; to?: string } = {}): Promise<ProfitReport> {
    const { from, to } = reportRange(q, this.today());
    const [sales, purchases, rows] = await Promise.all([
      this.deps.sales?.gstTotals(tenantId, from, to) ?? ZERO_GST,
      this.deps.purchases?.itcTotals(tenantId, from, to) ?? ZERO_GST,
      this.recorded(tenantId, from, to),
    ]);
    const s = summarize(rows, []);
    return profitReport(from, to, sales, purchases, { total: s.total, itc: s.itc });
  }
}

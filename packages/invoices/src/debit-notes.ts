/**
 * Debit notes to customers (CGST Act s.34(3)), docs/expenses-debit-notes.md: raise the value of an issued bill — a
 * price revised upwards, quantity short-billed, freight or other charges billed later. Own number series per branch and
 * FY ("DN/26-27/0001"), GST line by line with the bill's tax split, the customer owes the note's total (credit book;
 * customer receipts settle it after the open bills), books Dr Debtors / Cr Sales + output GST, GSTR-1 CDNR / CDNUR
 * with note type "D", GSTR-3B 3.1(a). Not the supplier debit notes of purchase returns (packages/inventory).
 */
import { AppError, badRequest, conflict, defineSort, facetCounts, listFilter, listQuerySchema, newId, notFound, rangeOrder, searchAny, type ListPage } from "@rbms/core";
import type { Db, DbOrTx } from "@rbms/db";
import { amountInWordsINR, financialYear, formatInvoiceNumber, isValidDate, todayIST } from "@rbms/gst";
import { and, asc, count, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { allocateToDebitNotes, computeDebitNote, debitCancelProblem, DebitNoteError, debitNotePrefix, type DebitLineRequest } from "./debit-notes-calc";
import { noopLogger, type CustomerSnapshot, type LoggerPort, type SellerProfile } from "./ports";
import { invoices } from "./schema";
import {
  DEBIT_NOTE_REASONS,
  SALES_DEBIT_NOTE_STATUSES,
  salesDebitNoteAllocations,
  salesDebitNotes,
  salesDebitNoteSeries,
  type DebitNoteReason,
  type SalesDebitNoteLine,
  type SalesDebitNoteRow,
  type SalesDebitNoteStatus,
  type SalesDebitNoteTotals,
} from "./schema-debit-notes";

// ------------------------------------------------------------------ DTOs

export interface DebitNoteSummary {
  id: string;
  number: string;
  date: string;
  status: SalesDebitNoteStatus;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  branchId: string | null;
  customerId: string | null;
  customerName: string;
  customerGstin: string | null;
  reason: DebitNoteReason;
  total: number;
  paid: number;
  /** total − paid (0 when cancelled). */
  balance: number;
  dueDate: string | null;
  createdAt: Date;
}

export interface DebitNote extends DebitNoteSummary {
  customer: CustomerSnapshot;
  seller: SellerProfile;
  note: string | null;
  placeOfSupply: string;
  interState: boolean;
  invoiceTotal: number;
  lines: SalesDebitNoteLine[];
  totals: SalesDebitNoteTotals;
  amountInWords: string;
  issuedAt: Date;
  cancelledAt: Date | null;
  cancelReason: string | null;
  /** Today, nothing received and not cancelled. */
  canCancel: boolean;
  updatedAt: Date;
}

// ------------------------------------------------------------------ validation

const MAX_PAISE = 2_000_000_000;
const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), s.nullable().optional());
const dateStr = z.string().refine(isValidDate, "Use a valid YYYY-MM-DD date");

export const debitNoteLineSchema = z.object({
  /** Index of the bill line (price revised / short-billed); left out = a new charge (freight ...). */
  line: z.number().int().min(0).max(199).optional(),
  description: opt(z.string().trim().max(300)),
  hsn: opt(z.string().trim().max(12)),
  unit: opt(z.string().trim().max(20)),
  qty: z.number().positive().max(1_000_000),
  /** Paise per unit, GST-exclusive. */
  rate: z.number().int("Amounts are whole paise").positive().max(MAX_PAISE),
  gstRate: z.number().optional(),
});

export const debitNoteInputSchema = z.object({
  /** Default today (IST). Not before the bill's date, not in the future. */
  date: dateStr.optional(),
  reason: z.enum(DEBIT_NOTE_REASONS),
  note: opt(z.string().trim().max(500)),
  dueDate: opt(dateStr),
  lines: z.array(debitNoteLineSchema).min(1, "Add at least one line").max(200),
});
export type DebitNoteInput = z.input<typeof debitNoteInputSchema>;

/** GET /v1/invoices/debit-notes (docs/CONVENTIONS.md → "Lists and tables"), 50 / 200. */
export const debitNoteListQuerySchema = listQuerySchema({ defaultLimit: 50, maxLimit: 200 })
  .extend({
    status: listFilter.oneOf(SALES_DEBIT_NOTE_STATUSES),
    reason: listFilter.oneOf(DEBIT_NOTE_REASONS),
    invoiceId: listFilter.id(),
    customerId: listFilter.id(),
    branchId: listFilter.ids(),
    from: listFilter.date(),
    to: listFilter.date(),
  })
  .superRefine(rangeOrder("from", "to"));
export type DebitNoteListQuery = z.input<typeof debitNoteListQuerySchema>;

export const DEBIT_NOTE_SORT = defineSort(
  {
    number: sql`(${salesDebitNotes.fy}, ${salesDebitNotes.seq})`,
    date: salesDebitNotes.date,
    total: salesDebitNotes.total,
  },
  { default: "-date", tieBreaker: [salesDebitNotes.issuedAt, salesDebitNotes.id] },
);

type DebitNoteFacet = "status" | "reason";

const asBadRequest = (err: unknown): never => {
  if (err instanceof DebitNoteError) throw new AppError(400, err.code, err.message);
  throw err;
};

/** Hands out the next debit note number of (tenant, branch, FY); same locking as invoice numbers. */
export function allocateDebitNoteSeq(db: DbOrTx, args: { tenantId: string; fy: string; prefix: string; branchId: string | null }) {
  const current = sql`${sql.identifier("sales_debit_note_series")}.${sql.identifier("next_seq")}`;
  return db
    .insert(salesDebitNoteSeries)
    .values({ tenantId: args.tenantId, branchId: args.branchId, fy: args.fy, prefix: args.prefix, nextSeq: 1 })
    .onConflictDoUpdate({
      target: [salesDebitNoteSeries.tenantId, salesDebitNoteSeries.branchId, salesDebitNoteSeries.fy],
      set: { nextSeq: sql`${current} + 1`, prefix: args.prefix, updatedAt: sql`now()` },
    })
    .returning({ seq: salesDebitNoteSeries.nextSeq });
}

export interface DebitNoteEventsPort {
  debitNoteIssued?(tenantId: string, note: DebitNote): Promise<void> | void;
  debitNoteCancelled?(tenantId: string, note: DebitNote): Promise<void> | void;
}

export interface DebitNotesDeps {
  db: Db;
  events?: DebitNoteEventsPort;
  log?: LoggerPort;
  now?: () => Date;
}

export class DebitNotesService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;

  constructor(private readonly deps: DebitNotesDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  private today() {
    return todayIST(this.now());
  }

  private toSummary(r: SalesDebitNoteRow): DebitNoteSummary {
    return {
      id: r.id,
      number: r.number,
      date: r.date,
      status: r.status,
      invoiceId: r.invoiceId,
      invoiceNumber: r.invoiceNumber,
      invoiceDate: r.invoiceDate,
      branchId: r.branchId,
      customerId: r.customerId,
      customerName: r.customer.name,
      customerGstin: r.customer.gstin,
      reason: r.reason,
      total: r.total,
      paid: r.paid,
      balance: r.status === "cancelled" ? 0 : Math.max(r.total - r.paid, 0),
      dueDate: r.dueDate,
      createdAt: r.createdAt,
    };
  }

  toDebitNote(r: SalesDebitNoteRow): DebitNote {
    return {
      ...this.toSummary(r),
      customer: r.customer,
      seller: r.seller,
      note: r.note,
      placeOfSupply: r.placeOfSupply,
      interState: r.interState,
      invoiceTotal: r.invoiceTotal,
      lines: r.lines,
      totals: r.totals,
      amountInWords: amountInWordsINR(r.total),
      issuedAt: r.issuedAt,
      cancelledAt: r.cancelledAt,
      cancelReason: r.cancelReason,
      canCancel: debitCancelProblem({ status: r.status, issuedOn: todayIST(r.issuedAt), paid: r.paid }, this.today()) === null,
      updatedAt: r.updatedAt,
    };
  }

  private async noteRow(db: DbOrTx, tenantId: string, id: string, lock = false): Promise<SalesDebitNoteRow> {
    const q = db
      .select()
      .from(salesDebitNotes)
      .where(and(eq(salesDebitNotes.tenantId, tenantId), eq(salesDebitNotes.id, id)))
      .limit(1);
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw notFound("Debit note");
    return row;
  }

  /** Issues a debit note against an issued bill (one transaction). */
  async create(tenantId: string, invoiceId: string, input: DebitNoteInput, userId: string | null = null): Promise<DebitNote> {
    const b = debitNoteInputSchema.parse(input);
    const today = this.today();
    const date = b.date ?? today;
    if (date > today) throw badRequest("A debit note can't be dated in the future");
    const id = newId();
    const row = await this.db.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)))
        .limit(1)
        .for("update");
      if (!inv) throw notFound("Invoice");
      if (inv.status === "draft" || !inv.number || !inv.seller) throw new AppError(409, "debit_note_blocked", "Issue the bill before making a debit note");
      if (inv.status === "cancelled") throw new AppError(409, "debit_note_blocked", "This bill is cancelled; debit notes can't be made against it");
      if (inv.imported) throw new AppError(409, "debit_note_blocked", "This bill was imported from your old software; make the debit note there");
      if (date < inv.date) throw badRequest("A debit note can't be dated before its bill");
      if (b.dueDate && b.dueDate < date) throw badRequest("The due date can't be before the note's date");
      let calc;
      try {
        calc = computeDebitNote({ invoiceLines: inv.lines, interState: inv.interState, requests: b.lines as DebitLineRequest[] });
      } catch (err) {
        asBadRequest(err);
      }
      const c = calc!;
      const fy = financialYear(date);
      const prefix = debitNotePrefix(inv.seller.invoicePrefix);
      const [series] = await allocateDebitNoteSeq(tx, { tenantId, fy, prefix, branchId: inv.branchId });
      const seq = series!.seq;
      const number = formatInvoiceNumber(prefix, fy, seq);
      const [note] = await tx
        .insert(salesDebitNotes)
        .values({
          id,
          tenantId,
          invoiceId,
          branchId: inv.branchId,
          customerId: inv.customerId,
          customer: inv.customer,
          seller: inv.seller,
          invoiceNumber: inv.number,
          invoiceDate: inv.date,
          invoiceTotal: inv.total,
          number,
          fy,
          seq,
          date,
          status: "issued",
          reason: b.reason,
          note: b.note ?? null,
          placeOfSupply: inv.placeOfSupply,
          interState: inv.interState,
          lines: c.lines,
          totals: c.totals,
          total: c.total,
          dueDate: b.dueDate ?? null,
          createdBy: userId,
          issuedAt: this.now(),
        })
        .returning();
      this.log.info({ tenantId, invoiceId, debitNoteId: id, number, total: c.total }, "debit note issued");
      return note!;
    });
    const note = this.toDebitNote(row);
    await this.emit(tenantId, (e) => e.debitNoteIssued?.(tenantId, note));
    return note;
  }

  private async emit(tenantId: string, call: (e: DebitNoteEventsPort) => Promise<void> | void | undefined) {
    if (!this.deps.events) return;
    try {
      await call(this.deps.events);
    } catch (err) {
      this.log.error({ err, tenantId }, "invoices: debit note event handler failed");
    }
  }

  async get(tenantId: string, id: string): Promise<DebitNote> {
    return this.toDebitNote(await this.noteRow(this.db, tenantId, id));
  }

  listConditions(tenantId: string, p: z.output<typeof debitNoteListQuerySchema>, without?: DebitNoteFacet): SQL | undefined {
    return and(
      eq(salesDebitNotes.tenantId, tenantId),
      without !== "status" && p.status?.length ? inArray(salesDebitNotes.status, p.status) : undefined,
      without !== "reason" && p.reason?.length ? inArray(salesDebitNotes.reason, p.reason) : undefined,
      p.invoiceId ? eq(salesDebitNotes.invoiceId, p.invoiceId) : undefined,
      p.customerId ? eq(salesDebitNotes.customerId, p.customerId) : undefined,
      p.branchId?.length ? inArray(salesDebitNotes.branchId, p.branchId) : undefined,
      p.from ? gte(salesDebitNotes.date, p.from) : undefined,
      p.to ? lte(salesDebitNotes.date, p.to) : undefined,
      searchAny(p.q, [salesDebitNotes.number, salesDebitNotes.invoiceNumber, sql`${salesDebitNotes.customer}->>'name'`, sql`${salesDebitNotes.customer}->>'phone'`]),
    );
  }

  /** Debit notes: paged, sorted (default newest first), filtered; `totals` over the issued notes under the filters. */
  async list(tenantId: string, query: DebitNoteListQuery = {}): Promise<ListPage<DebitNoteSummary> & { totals: { count: number; issued: number; total: number; balance: number } }> {
    const p = debitNoteListQuerySchema.parse(query);
    const order = DEBIT_NOTE_SORT.orderBy(p.sort);
    const where = this.listConditions(tenantId, p);
    const facet = (col: typeof salesDebitNotes.status | typeof salesDebitNotes.reason, without: DebitNoteFacet) =>
      this.db.select({ key: col, n: count() }).from(salesDebitNotes).where(this.listConditions(tenantId, p, without)).groupBy(col);
    const [rows, [agg], byStatus, byReason] = await Promise.all([
      this.db.select().from(salesDebitNotes).where(where).orderBy(...order).limit(p.limit).offset(p.offset),
      this.db
        .select({
          n: count(),
          total: sql<string>`coalesce(sum(${salesDebitNotes.total}) filter (where ${salesDebitNotes.status} = 'issued'), 0)`,
          balance: sql<string>`coalesce(sum(${salesDebitNotes.total} - ${salesDebitNotes.paid}) filter (where ${salesDebitNotes.status} = 'issued'), 0)`,
          live: sql<string>`count(*) filter (where ${salesDebitNotes.status} = 'issued')`,
        })
        .from(salesDebitNotes)
        .where(where),
      facet(salesDebitNotes.status, "status"),
      facet(salesDebitNotes.reason, "reason"),
    ]);
    const total = Number(agg?.n ?? 0);
    return {
      items: rows.map((r) => this.toSummary(r)),
      total,
      limit: p.limit,
      offset: p.offset,
      totals: { count: total, issued: Number(agg?.live ?? 0), total: Number(agg?.total ?? 0), balance: Number(agg?.balance ?? 0) },
      facets: { status: facetCounts(byStatus), reason: facetCounts(byReason) },
    };
  }

  /** All notes of a bill (issued and cancelled), oldest first. */
  async forInvoice(tenantId: string, invoiceId: string): Promise<DebitNoteSummary[]> {
    const rows = await this.db
      .select()
      .from(salesDebitNotes)
      .where(and(eq(salesDebitNotes.tenantId, tenantId), eq(salesDebitNotes.invoiceId, invoiceId)))
      .orderBy(asc(salesDebitNotes.issuedAt));
    return rows.map((r) => this.toSummary(r));
  }

  /** Cancels a note on the day it was issued when nothing was received against it. The number stays used. */
  async cancel(tenantId: string, id: string, reason?: string | null, userId: string | null = null): Promise<DebitNote> {
    const why = z.string().trim().max(500).nullish().parse(reason) || null;
    const row = await this.db.transaction(async (tx) => {
      const note = await this.noteRow(tx, tenantId, id, true);
      const problem = debitCancelProblem({ status: note.status, issuedOn: todayIST(note.issuedAt), paid: note.paid }, this.today());
      if (problem) throw new AppError(409, "debit_note_locked", problem);
      const [cancelled] = await tx
        .update(salesDebitNotes)
        .set({ status: "cancelled", cancelledAt: this.now(), cancelledBy: userId, cancelReason: why })
        .where(and(eq(salesDebitNotes.tenantId, tenantId), eq(salesDebitNotes.id, id), eq(salesDebitNotes.status, "issued")))
        .returning();
      if (!cancelled) throw conflict("This debit note was changed meanwhile; reload and try again");
      return cancelled;
    });
    const note = this.toDebitNote(row);
    await this.emit(tenantId, (e) => e.debitNoteCancelled?.(tenantId, note));
    return note;
  }

  // ---------------------------------------------------------------- credit book (called inside the receipt's transaction)

  /**
   * Allocates what a customer receipt has left after the open bills to the customer's open debit notes, oldest first.
   * Returns what is still left (the customer's advance).
   */
  async allocateReceipt(tx: DbOrTx, tenantId: string, customerId: string, receipt: { id: string; date: string }, amount: number): Promise<number> {
    if (amount <= 0) return amount;
    const notes = await tx
      .select({ id: salesDebitNotes.id, date: salesDebitNotes.date, seq: salesDebitNotes.seq, total: salesDebitNotes.total, paid: salesDebitNotes.paid, status: salesDebitNotes.status })
      .from(salesDebitNotes)
      .where(and(eq(salesDebitNotes.tenantId, tenantId), eq(salesDebitNotes.customerId, customerId), eq(salesDebitNotes.status, "issued"), sql`${salesDebitNotes.total} > ${salesDebitNotes.paid}`))
      .orderBy(asc(salesDebitNotes.id))
      .for("update");
    const { allocations, left } = allocateToDebitNotes(amount, notes);
    for (const a of allocations) {
      await tx.insert(salesDebitNoteAllocations).values({ tenantId, debitNoteId: a.debitNoteId, receiptId: receipt.id, amount: a.amount, date: receipt.date });
      await tx
        .update(salesDebitNotes)
        .set({ paid: sql`${salesDebitNotes.paid} + ${a.amount}` })
        .where(and(eq(salesDebitNotes.tenantId, tenantId), eq(salesDebitNotes.id, a.debitNoteId)));
    }
    return left;
  }

  /** Takes a deleted receipt's money back off the debit notes it settled. */
  async releaseReceipt(tx: DbOrTx, tenantId: string, receiptId: string): Promise<void> {
    const rows = await tx
      .delete(salesDebitNoteAllocations)
      .where(and(eq(salesDebitNoteAllocations.tenantId, tenantId), eq(salesDebitNoteAllocations.receiptId, receiptId)))
      .returning({ debitNoteId: salesDebitNoteAllocations.debitNoteId, amount: salesDebitNoteAllocations.amount });
    for (const r of rows) {
      await tx
        .update(salesDebitNotes)
        .set({ paid: sql`greatest(${salesDebitNotes.paid} - ${r.amount}, 0)` })
        .where(and(eq(salesDebitNotes.tenantId, tenantId), eq(salesDebitNotes.id, r.debitNoteId)));
    }
  }

  /** Issued debit notes of a customer (credit book ledger). */
  async issuedForCustomer(tenantId: string, customerId: string): Promise<SalesDebitNoteRow[]> {
    return this.db
      .select()
      .from(salesDebitNotes)
      .where(and(eq(salesDebitNotes.tenantId, tenantId), eq(salesDebitNotes.customerId, customerId), eq(salesDebitNotes.status, "issued")));
  }

  /** Whether a bill has issued debit notes (it can't be cancelled then). */
  async hasIssued(db: DbOrTx, tenantId: string, invoiceId: string): Promise<boolean> {
    const [r] = await db
      .select({ n: count() })
      .from(salesDebitNotes)
      .where(and(eq(salesDebitNotes.tenantId, tenantId), eq(salesDebitNotes.invoiceId, invoiceId), eq(salesDebitNotes.status, "issued")));
    return Number(r?.n ?? 0) > 0;
  }
}

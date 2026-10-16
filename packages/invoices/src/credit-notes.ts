import { AppError, badRequest, conflict, newId, notFound } from "@srirealtime/core";
import type { Db, DbOrTx } from "@srirealtime/db";
import {
  amountInWordsINR,
  computeCreditNote,
  CreditNoteError,
  creditState,
  financialYear,
  formatInvoiceNumber,
  isValidDate,
  todayIST,
  type CreditLineRequest,
  type LineCreditState,
} from "@srirealtime/gst";
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { cancelProblem, creditNotePrefix, settleCreditNote } from "./credit-notes-calc";
import { balanceOf, deriveStatus } from "./logic";
import { noopLogger, type CustomerSnapshot, type InvoiceEventsPort, type LoggerPort, type LoyaltyRedeemPort, type SellerProfile, type StockPort } from "./ports";
import {
  CREDIT_NOTE_REASONS,
  CREDIT_NOTE_STATUSES,
  creditNotes,
  creditNoteSeries,
  invoicePayments,
  invoices,
  REFUND_MODES,
  tillSessions,
  type CreditNoteLine,
  type CreditNoteReason,
  type CreditNoteRow,
  type CreditNoteStatus,
  type CreditNoteTotals,
  type InvoiceRow,
  type InvoiceStatus,
  type RefundMode,
} from "./schema";
import type { Invoice } from "./service";

// ------------------------------------------------------------------ DTOs

export interface CreditNoteSummary {
  id: string;
  number: string;
  date: string;
  status: CreditNoteStatus;
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  branchId: string | null;
  customerId: string | null;
  customerName: string;
  reason: CreditNoteReason;
  refundMode: RefundMode;
  refundAmount: number;
  total: number;
  createdAt: Date;
}

export interface CreditNote extends CreditNoteSummary {
  customer: CustomerSnapshot;
  seller: SellerProfile;
  note: string | null;
  placeOfSupply: string;
  interState: boolean;
  lines: CreditNoteLine[];
  totals: CreditNoteTotals;
  amountInWords: string;
  tillSessionId: string | null;
  issuedAt: Date;
  cancelledAt: Date | null;
  cancelReason: string | null;
  /** Today, not refunded and not cancelled. */
  canCancel: boolean;
  updatedAt: Date;
}

export interface Returnable {
  invoiceId: string;
  number: string | null;
  status: InvoiceStatus;
  total: number;
  paid: number;
  credited: number;
  balance: number;
  /** Paise still creditable (total − credited). */
  creditable: number;
  interState: boolean;
  hasCustomer: boolean;
  /** Why no credit note can be made (draft, cancelled, nothing left), or null. */
  blocked: string | null;
  lines: LineCreditState[];
  creditNotes: CreditNoteSummary[];
}

export interface CreditNoteResult {
  creditNote: CreditNote;
  invoice: Invoice;
}

// ------------------------------------------------------------------ validation

const MAX_PAISE = 2_000_000_000;
const opt = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), s.nullable().optional());
const dateStr = z.string().refine(isValidDate, "Use a valid YYYY-MM-DD date");

export const creditNoteLineSchema = z.object({
  line: z.number().int().min(0).max(199),
  qty: z.number().positive().max(1_000_000).optional(),
  /** Value-only credit (GST-exclusive paise). */
  taxable: z.number().int("Amounts are whole paise").positive().max(MAX_PAISE).optional(),
  restock: z.boolean().optional(),
});

export const creditNoteInputSchema = z.object({
  /** Default today (IST). Not before the bill's date, not in the future. */
  date: dateStr.optional(),
  reason: z.enum(CREDIT_NOTE_REASONS),
  note: opt(z.string().trim().max(500)),
  refundMode: z.enum(REFUND_MODES),
  /** UPI / card reference of the refund. */
  refundReference: opt(z.string().trim().max(100)),
  lines: z.array(creditNoteLineSchema).min(1, "Pick at least one line").max(200),
  /** POS till the refund is paid from. */
  tillSessionId: opt(z.string().uuid()),
});
export type CreditNoteInput = z.input<typeof creditNoteInputSchema>;

export const creditNoteListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(CREDIT_NOTE_STATUSES).optional(),
  invoiceId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type CreditNoteListQuery = z.input<typeof creditNoteListQuerySchema>;

const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, "\\$&")}%`;

const asBadRequest = (err: unknown): never => {
  if (err instanceof CreditNoteError) throw new AppError(400, err.code, err.message);
  throw err;
};

/** Hands out the next credit note number of (tenant, branch, FY); same locking as invoice numbers. */
export function allocateCreditNoteSeq(db: DbOrTx, args: { tenantId: string; fy: string; prefix: string; branchId: string | null }) {
  const current = sql`${sql.identifier("credit_note_series")}.${sql.identifier("next_seq")}`;
  return db
    .insert(creditNoteSeries)
    .values({ tenantId: args.tenantId, branchId: args.branchId, fy: args.fy, prefix: args.prefix, nextSeq: 1 })
    .onConflictDoUpdate({
      target: [creditNoteSeries.tenantId, creditNoteSeries.branchId, creditNoteSeries.fy],
      set: { nextSeq: sql`${current} + 1`, prefix: args.prefix, updatedAt: sql`now()` },
    })
    .returning({ seq: creditNoteSeries.nextSeq });
}

export interface CreditNotesDeps {
  db: Db;
  stock?: StockPort;
  loyalty?: LoyaltyRedeemPort;
  events?: InvoiceEventsPort;
  log?: LoggerPort;
  now?: () => Date;
}

/** What the credit notes service needs from the invoices service. */
export interface CreditNotesHost {
  getInvoice(tenantId: string, id: string): Promise<Invoice>;
  /** Branch stock location of a bill (restock goes back there when the sale's location is unknown). */
  stockLocation?(tenantId: string, branchId: string | null): Promise<string | null>;
}

/**
 * GST credit notes against issued bills: full or partial returns and value corrections, with their own FY number
 * series (per branch), refunds (cash / UPI / card), credit book credit, restocking, loyalty and events.
 */
export class CreditNotesService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;

  constructor(
    private readonly deps: CreditNotesDeps,
    private readonly host: CreditNotesHost,
  ) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  private today() {
    return todayIST(this.now());
  }

  private toSummary(r: CreditNoteRow): CreditNoteSummary {
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
      reason: r.reason,
      refundMode: r.refundMode,
      refundAmount: r.refundAmount,
      total: r.total,
      createdAt: r.createdAt,
    };
  }

  toCreditNote(r: CreditNoteRow): CreditNote {
    return {
      ...this.toSummary(r),
      customer: r.customer,
      seller: r.seller,
      note: r.note,
      placeOfSupply: r.placeOfSupply,
      interState: r.interState,
      lines: r.lines,
      totals: r.totals,
      amountInWords: amountInWordsINR(r.total),
      tillSessionId: r.tillSessionId,
      issuedAt: r.issuedAt,
      cancelledAt: r.cancelledAt,
      cancelReason: r.cancelReason,
      canCancel: cancelProblem({ status: r.status, issuedOn: todayIST(r.issuedAt), refundAmount: r.refundAmount }, this.today()) === null,
      updatedAt: r.updatedAt,
    };
  }

  private async issuedFor(db: DbOrTx, tenantId: string, invoiceId: string): Promise<CreditNoteRow[]> {
    return db
      .select()
      .from(creditNotes)
      .where(and(eq(creditNotes.tenantId, tenantId), eq(creditNotes.invoiceId, invoiceId)))
      .orderBy(asc(creditNotes.issuedAt));
  }

  private async noteRow(db: DbOrTx, tenantId: string, id: string, lock = false): Promise<CreditNoteRow> {
    const q = db
      .select()
      .from(creditNotes)
      .where(and(eq(creditNotes.tenantId, tenantId), eq(creditNotes.id, id)))
      .limit(1);
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw notFound("Credit note");
    return row;
  }

  private blockedReason(inv: Pick<InvoiceRow, "status" | "total" | "credited">): string | null {
    if (inv.status === "draft") return "Issue the bill before making a credit note";
    if (inv.status === "cancelled") return "This bill is cancelled; credit notes can't be made against it";
    if (inv.total - inv.credited <= 0) return "Everything on this bill is already credited";
    return null;
  }

  /** What can still be returned / credited on a bill, with its credit notes. */
  async returnable(tenantId: string, invoiceId: string): Promise<Returnable> {
    const [inv] = await this.db
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)))
      .limit(1);
    if (!inv) throw notFound("Invoice");
    const notes = await this.issuedFor(this.db, tenantId, invoiceId);
    const issued = notes.filter((n) => n.status === "issued");
    return {
      invoiceId: inv.id,
      number: inv.number,
      status: inv.status,
      total: inv.total,
      paid: inv.paid,
      credited: inv.credited,
      balance: balanceOf(inv),
      creditable: Math.max(inv.total - inv.credited, 0),
      interState: inv.interState,
      hasCustomer: Boolean(inv.customerId),
      blocked: this.blockedReason(inv),
      lines: creditState(inv.lines, issued.flatMap((n) => n.lines)),
      creditNotes: notes.map((n) => this.toSummary(n)),
    };
  }

  /** Issues a credit note against a bill (one transaction), then restocks, adjusts loyalty and emits events. */
  async create(tenantId: string, invoiceId: string, input: CreditNoteInput, userId: string | null = null): Promise<CreditNoteResult> {
    const b = creditNoteInputSchema.parse(input);
    const today = this.today();
    const date = b.date ?? today;
    if (date > today) throw badRequest("A credit note can't be dated in the future");
    const id = newId();
    let becamePaid = false;

    const row = await this.db.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)))
        .limit(1)
        .for("update");
      if (!inv) throw notFound("Invoice");
      const blocked = this.blockedReason(inv);
      if (blocked) throw new AppError(409, "credit_note_blocked", blocked);
      if (date < inv.date) throw badRequest("A credit note can't be dated before its bill");
      if (!inv.seller || !inv.number) throw new AppError(409, "credit_note_blocked", "Issue the bill before making a credit note");

      const prior = (await this.issuedFor(tx, tenantId, invoiceId)).filter((n) => n.status === "issued");
      let calc;
      try {
        calc = computeCreditNote({
          invoiceLines: inv.lines,
          invoiceTotal: inv.total,
          interState: inv.interState,
          priorCreditedTotal: inv.credited,
          prior: prior.flatMap((n) => n.lines),
          requests: b.lines as CreditLineRequest[],
          allowValue: b.reason !== "return",
          restockByDefault: b.reason === "return",
        });
      } catch (err) {
        asBadRequest(err);
      }
      const c = calc!;
      let settlement;
      try {
        settlement = settleCreditNote(inv, c.total, b.refundMode, { hasCustomer: Boolean(inv.customerId) });
      } catch (err) {
        asBadRequest(err);
      }
      const s = settlement!;

      if (b.tillSessionId) {
        const [till] = await tx
          .select({ id: tillSessions.id, status: tillSessions.status })
          .from(tillSessions)
          .where(and(eq(tillSessions.tenantId, tenantId), eq(tillSessions.id, b.tillSessionId)))
          .limit(1);
        if (!till) throw notFound("Till session");
        if (till.status !== "open") throw new AppError(409, "till_closed", "This till session is closed; open the till again");
      }

      const fy = financialYear(date);
      const prefix = creditNotePrefix(inv.seller.invoicePrefix);
      const [series] = await allocateCreditNoteSeq(tx, { tenantId, fy, prefix, branchId: inv.branchId });
      const seq = series!.seq;
      const number = formatInvoiceNumber(prefix, fy, seq);

      let refundPaymentId: string | null = null;
      if (s.refund > 0) {
        const method = b.refundMode as "cash" | "upi" | "card";
        const [pay] = await tx
          .insert(invoicePayments)
          .values({
            tenantId,
            invoiceId,
            amount: -s.refund,
            method,
            date,
            reference: b.refundReference ?? number,
            source: "refund",
            creditNoteId: id,
            tillSessionId: b.tillSessionId ?? null,
            createdBy: userId,
          })
          .returning({ id: invoicePayments.id });
        refundPaymentId = pay!.id;
      }

      const [note] = await tx
        .insert(creditNotes)
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
          number,
          fy,
          seq,
          date,
          status: "issued",
          reason: b.reason,
          note: b.note ?? null,
          refundMode: b.refundMode,
          refundAmount: s.refund,
          refundPaymentId,
          placeOfSupply: inv.placeOfSupply,
          interState: inv.interState,
          lines: c.lines,
          totals: c.totals,
          total: c.total,
          tillSessionId: b.tillSessionId ?? null,
          createdBy: userId,
          issuedAt: this.now(),
        })
        .returning();

      const paid = inv.paid - s.refund;
      const credited = inv.credited + c.total;
      const status = deriveStatus(inv.status, inv.total, paid, credited);
      becamePaid = status === "paid" && inv.status !== "paid";
      await tx
        .update(invoices)
        .set({ paid, credited, status })
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)));
      this.log.info({ tenantId, invoiceId, creditNoteId: id, number, total: c.total, refund: s.refund }, "credit note issued");
      return note!;
    });

    await this.afterIssue(tenantId, row);
    const invoice = await this.host.getInvoice(tenantId, invoiceId);
    const creditNote = this.toCreditNote(row);
    await this.emit("creditNoteIssued", tenantId, (h) => h(tenantId, creditNote, invoice));
    if (becamePaid) await this.emit("paid", tenantId, (h) => h(tenantId, invoice));
    return { creditNote, invoice };
  }

  private async emit<K extends keyof InvoiceEventsPort>(
    name: K,
    tenantId: string,
    call: (handler: NonNullable<InvoiceEventsPort[K]>) => Promise<void> | void,
  ): Promise<void> {
    const handler = this.deps.events?.[name];
    if (!handler) return;
    try {
      await call(handler.bind(this.deps.events) as NonNullable<InvoiceEventsPort[K]>);
    } catch (err) {
      this.log.error({ err, tenantId, event: name }, "invoices: credit note event handler failed");
    }
  }

  /** Stock back in and loyalty points taken back. Failures are logged, never undo the note. */
  private async afterIssue(tenantId: string, note: CreditNoteRow): Promise<void> {
    const lines = note.lines.filter((l) => l.restock && l.itemId && l.qty > 0).map((l) => ({ itemId: l.itemId!, qty: l.qty }));
    if (lines.length > 0 && this.deps.stock?.applyReturn) {
      try {
        const locationId = (await this.host.stockLocation?.(tenantId, note.branchId)) ?? null;
        await this.deps.stock.applyReturn(tenantId, { refId: note.id, saleRefId: note.invoiceId, refNumber: note.number, lines, locationId });
      } catch (err) {
        this.log.error({ err, tenantId, creditNoteId: note.id }, "invoices: restock after credit note failed");
      }
    }
    if (this.deps.loyalty?.creditNote) {
      try {
        await this.deps.loyalty.creditNote(tenantId, { invoiceId: note.invoiceId, creditNoteId: note.id, amount: note.total });
      } catch (err) {
        this.log.error({ err, tenantId, creditNoteId: note.id }, "invoices: loyalty reversal after credit note failed");
      }
    }
  }

  async get(tenantId: string, id: string): Promise<CreditNote> {
    return this.toCreditNote(await this.noteRow(this.db, tenantId, id));
  }

  async list(tenantId: string, query: CreditNoteListQuery = {}): Promise<{ items: CreditNoteSummary[]; total: number; totals: { count: number; total: number } }> {
    const p = creditNoteListQuerySchema.parse(query);
    const conds: (SQL | undefined)[] = [eq(creditNotes.tenantId, tenantId)];
    if (p.status) conds.push(eq(creditNotes.status, p.status));
    if (p.invoiceId) conds.push(eq(creditNotes.invoiceId, p.invoiceId));
    if (p.customerId) conds.push(eq(creditNotes.customerId, p.customerId));
    if (p.branchId) conds.push(eq(creditNotes.branchId, p.branchId));
    if (p.from) conds.push(gte(creditNotes.date, p.from));
    if (p.to) conds.push(lte(creditNotes.date, p.to));
    if (p.q) {
      const pat = likePattern(p.q);
      conds.push(
        or(
          ilike(creditNotes.number, pat),
          ilike(creditNotes.invoiceNumber, pat),
          sql`${creditNotes.customer}->>'name' ilike ${pat}`,
          sql`${creditNotes.customer}->>'phone' ilike ${pat}`,
        ),
      );
    }
    const where = and(...conds);
    const [rows, [agg]] = await Promise.all([
      this.db.select().from(creditNotes).where(where).orderBy(desc(creditNotes.date), desc(creditNotes.issuedAt)).limit(p.limit).offset(p.offset),
      this.db
        .select({ n: count(), total: sql<string>`coalesce(sum(${creditNotes.total}) filter (where ${creditNotes.status} = 'issued'), 0)` })
        .from(creditNotes)
        .where(where),
    ]);
    return { items: rows.map((r) => this.toSummary(r)), total: agg?.n ?? 0, totals: { count: agg?.n ?? 0, total: Number(agg?.total ?? 0) } };
  }

  /** All notes of a bill (issued and cancelled), oldest first. */
  async forInvoice(tenantId: string, invoiceId: string): Promise<CreditNoteSummary[]> {
    return (await this.issuedFor(this.db, tenantId, invoiceId)).map((n) => this.toSummary(n));
  }

  /** Issued (not cancelled) notes of several bills, for ledgers and reports. */
  async issuedForInvoices(tenantId: string, invoiceIds: string[]): Promise<CreditNoteRow[]> {
    if (invoiceIds.length === 0) return [];
    return this.db
      .select()
      .from(creditNotes)
      .where(and(eq(creditNotes.tenantId, tenantId), inArray(creditNotes.invoiceId, invoiceIds), eq(creditNotes.status, "issued")));
  }

  /**
   * Cancels a note on the day it was issued when no money was refunded with it: the bill's balance comes back, the
   * goods go out of stock again and the loyalty points are given back. The number stays used (GST: no reuse).
   */
  async cancel(tenantId: string, id: string, reason?: string | null, userId: string | null = null): Promise<CreditNoteResult> {
    const why = z.string().trim().max(500).nullish().parse(reason) || null;
    const row = await this.db.transaction(async (tx) => {
      const before = await this.noteRow(tx, tenantId, id);
      const [inv] = await tx
        .select()
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, before.invoiceId)))
        .limit(1)
        .for("update");
      if (!inv) throw notFound("Invoice");
      const note = await this.noteRow(tx, tenantId, id, true);
      const problem = cancelProblem({ status: note.status, issuedOn: todayIST(note.issuedAt), refundAmount: note.refundAmount }, this.today());
      if (problem) throw new AppError(409, "credit_note_locked", problem);
      const [cancelled] = await tx
        .update(creditNotes)
        .set({ status: "cancelled", cancelledAt: this.now(), cancelledBy: userId, cancelReason: why })
        .where(and(eq(creditNotes.tenantId, tenantId), eq(creditNotes.id, id), eq(creditNotes.status, "issued")))
        .returning();
      if (!cancelled) throw conflict("This credit note was changed meanwhile; reload and try again");
      const credited = Math.max(inv.credited - note.total, 0);
      await tx
        .update(invoices)
        .set({ credited, status: deriveStatus(inv.status, inv.total, inv.paid, credited) })
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, inv.id)));
      return cancelled;
    });
    if (this.deps.stock?.reverseReturn && row.lines.some((l) => l.restock)) {
      try {
        await this.deps.stock.reverseReturn(tenantId, row.id);
      } catch (err) {
        this.log.error({ err, tenantId, creditNoteId: row.id }, "invoices: stock reversal after credit note cancel failed");
      }
    }
    if (this.deps.loyalty?.creditNoteCancelled) {
      try {
        await this.deps.loyalty.creditNoteCancelled(tenantId, { invoiceId: row.invoiceId, creditNoteId: row.id });
      } catch (err) {
        this.log.error({ err, tenantId, creditNoteId: row.id }, "invoices: loyalty restore after credit note cancel failed");
      }
    }
    const invoice = await this.host.getInvoice(tenantId, row.invoiceId);
    const creditNote = this.toCreditNote(row);
    await this.emit("creditNoteCancelled", tenantId, (h) => h(tenantId, creditNote, invoice));
    return { creditNote, invoice };
  }
}

import { AppError, newId, notFound } from "@srirealtime/core";
import type { Db, DbOrTx } from "@srirealtime/db";
import { isValidDate, todayIST } from "@srirealtime/gst";
import { and, count, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { balanceOf } from "./logic";
import { noopLogger, type LoggerPort } from "./ports";
import {
  creditNotes,
  invoicePayments,
  invoices,
  TILL_CASH_CATEGORIES,
  TILL_STATUSES,
  tillSessions,
  type DenominationCount,
  type TillCashEntry,
  type TillHandover,
  type TillSessionRow,
  type TillStatus,
} from "./schema";
import { countTotal, DENOMINATIONS, tillReport, type TillReport } from "./till-calc";

export interface TillSession {
  id: string;
  branchId: string | null;
  register: string;
  status: TillStatus;
  /** IST business date it was opened on. */
  date: string;
  openingCash: number;
  openingCount: DenominationCount | null;
  openedBy: string | null;
  openedByName: string | null;
  openedAt: Date;
  cashEntries: TillCashEntry[];
  /** Z report number of the register ("Z1", "Z2" ...), set at close. */
  zNumber: number | null;
  /** The cashier who has the drawer now (the opener, or whoever it was handed to last). */
  cashierName: string | null;
  handovers: TillHandover[];
  closingCount: DenominationCount | null;
  expectedCash: number | null;
  countedCash: number | null;
  difference: number | null;
  note: string | null;
  /** Why the count differed from the expected cash. */
  differenceReason: string | null;
  /** The manager who approved a difference beyond the shop's limit. */
  closeApprovedByName: string | null;
  closedBy: string | null;
  closedByName: string | null;
  closedAt: Date | null;
  /** The Z report (X report frozen at close); null while open. */
  summary: TillReport | null;
}

export interface TillActor {
  id: string | null;
  name: string | null;
}

/**
 * What the till needs from the host to hold a cash difference to a limit: the shop's limit and a manager PIN check
 * (the same PIN approval the discount limits use). Without it no difference needs approval.
 */
export interface TillApprovalPort {
  /** Paise: a difference (either way) above this needs a manager. 0 = every difference. */
  varianceLimit(tenantId: string): Promise<number>;
  /** The manager who owns `pin` and may approve (not the requester), or null. Counts wrong PINs; may throw 429. */
  approve(tenantId: string, pin: string, requesterId: string | null): Promise<{ userId: string; name: string | null } | null>;
}

/** Who may skip the manager PIN (owners and admins) and the PIN typed by the cashier, passed by the route. */
export interface TillApprovalInput {
  pin?: string | null;
  selfApprove?: boolean;
}

const MAX_PAISE = 2_000_000_000;
const registerName = z
  .string()
  .trim()
  .min(1, "Name this register")
  .max(40)
  .transform((s) => s.replace(/\s+/g, " "));
const countSchema = z
  .record(z.string(), z.number().int().min(0).max(100_000))
  .refine((c) => Object.keys(c).every((k) => (DENOMINATIONS as readonly number[]).includes(Number(k))), "Unknown note or coin")
  .transform((c) => Object.fromEntries(Object.entries(c).filter(([, n]) => n > 0)) as DenominationCount);

/** The open-till fields without the "cash or count" rule (the API document extends it). */
export const tillOpenFields = z.object({
  register: registerName,
  /** Paise in the drawer; or give `openingCount`. */
  openingCash: z.number().int().min(0).max(MAX_PAISE).optional(),
  openingCount: countSchema.optional(),
});
export const tillOpenSchema = tillOpenFields
  .refine((v) => v.openingCash !== undefined || v.openingCount !== undefined, { message: "Enter the opening cash or count the drawer", path: ["openingCash"] });
export type TillOpenInput = z.input<typeof tillOpenSchema>;

export const tillCashSchema = z.object({
  /** Paise, signed: + = cash in, − = cash out. */
  amount: z
    .number()
    .int("Amounts are whole paise")
    .min(-MAX_PAISE)
    .max(MAX_PAISE)
    .refine((n) => n !== 0, "Enter an amount"),
  /** Pay-in / pay-out category; the Z report totals by it. */
  category: z.enum(TILL_CASH_CATEGORIES).default("other"),
  reason: z.string().trim().max(120).default(""),
});
export type TillCashInput = z.input<typeof tillCashSchema>;

/** The close-till fields without the "count the drawer" rule (the API document extends it). */
export const tillCloseFields = z.object({
  count: countSchema.optional(),
  /** Paise counted, when not counted by denomination. */
  countedCash: z.number().int().min(0).max(MAX_PAISE).optional(),
  note: z.string().trim().max(300).nullish(),
  /** Why the count differs from the expected cash; required when it does. */
  reason: z.string().trim().max(200).nullish(),
});
export const tillCloseSchema = tillCloseFields
  .refine((v) => v.count !== undefined || v.countedCash !== undefined, { message: "Count the drawer", path: ["count"] });
export type TillCloseInput = z.input<typeof tillCloseSchema>;

/** Hand the drawer to the next cashier: the outgoing cashier's count, who takes over and why any difference. */
export const tillHandoverFields = z.object({
  toName: z.string().trim().min(1, "Who takes the drawer?").max(80),
  toUserId: z.string().uuid().nullish(),
  count: countSchema.optional(),
  countedCash: z.number().int().min(0).max(MAX_PAISE).optional(),
  reason: z.string().trim().max(200).nullish(),
  note: z.string().trim().max(300).nullish(),
});
export const tillHandoverSchema = tillHandoverFields.refine((v) => v.count !== undefined || v.countedCash !== undefined, {
  message: "Count the drawer",
  path: ["count"],
});
export type TillHandoverInput = z.input<typeof tillHandoverSchema>;

const dateStr = z.string().refine(isValidDate, "Use a valid YYYY-MM-DD date");
export const tillListQuerySchema = z.object({
  register: z.string().trim().max(40).optional(),
  status: z.enum(TILL_STATUSES).optional(),
  branchId: z.string().uuid().optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type TillListQuery = z.input<typeof tillListQuerySchema>;

const toSession = (r: TillSessionRow): TillSession => ({
  id: r.id,
  branchId: r.branchId,
  register: r.register,
  status: r.status,
  date: r.date,
  openingCash: r.openingCash,
  openingCount: r.openingCount ?? null,
  openedBy: r.openedBy,
  openedByName: r.openedByName,
  openedAt: r.openedAt,
  cashEntries: r.cashEntries ?? [],
  zNumber: r.zNumber,
  cashierName: (r.handovers ?? []).at(-1)?.toName ?? r.openedByName,
  handovers: r.handovers ?? [],
  closingCount: r.closingCount ?? null,
  expectedCash: r.expectedCash,
  countedCash: r.countedCash,
  difference: r.difference,
  note: r.note,
  differenceReason: r.differenceReason,
  closeApprovedByName: r.closeApprovedByName,
  closedBy: r.closedBy,
  closedByName: r.closedByName,
  closedAt: r.closedAt,
  summary: (r.summary as TillReport | null) ?? null,
});

const isUniqueViolation = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
};

const uuidOk = (v: string | null) => (v && z.string().uuid().safeParse(v).success ? v : null);

/**
 * POS till sessions: one open cash drawer session per register (device) and branch, cash in / out, the X report
 * (running totals of the bills, payments, refunds and credit notes tagged with the session) and the Z report at close.
 */
export class TillService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;
  private readonly approvals: TillApprovalPort | undefined;

  constructor(deps: { db: Db; log?: LoggerPort; now?: () => Date; approvals?: TillApprovalPort }) {
    this.db = deps.db;
    this.approvals = deps.approvals;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  private async row(db: DbOrTx, tenantId: string, id: string, lock = false): Promise<TillSessionRow> {
    const q = db
      .select()
      .from(tillSessions)
      .where(and(eq(tillSessions.tenantId, tenantId), eq(tillSessions.id, id)))
      .limit(1);
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw notFound("Till session");
    return row;
  }

  /** The id of an open session of the shop; 404 / 409 otherwise. For tagging bills, payments and refunds. */
  async assertOpen(tenantId: string, id: string, db: DbOrTx = this.db): Promise<string> {
    const r = await this.row(db, tenantId, id);
    if (r.status !== "open") throw new AppError(409, "till_closed", "This till session is closed; open the till again");
    return r.id;
  }

  async get(tenantId: string, id: string): Promise<TillSession> {
    return toSession(await this.row(this.db, tenantId, id));
  }

  /** The open session of a register at a branch (null = branch-less shop), or null. */
  async current(tenantId: string, at: { register: string; branchId?: string | null }): Promise<TillSession | null> {
    const register = registerName.parse(at.register);
    const [row] = await this.db
      .select()
      .from(tillSessions)
      .where(
        and(
          eq(tillSessions.tenantId, tenantId),
          eq(tillSessions.status, "open"),
          sql`lower(${tillSessions.register}) = lower(${register})`,
          at.branchId ? eq(tillSessions.branchId, at.branchId) : sql`${tillSessions.branchId} is null`,
        ),
      )
      .limit(1);
    return row ? toSession(row) : null;
  }

  /** Opens the drawer. 409 `till_open` (details.sessionId) when the register already has an open session. */
  async open(tenantId: string, input: TillOpenInput, at: { branchId?: string | null; actor: TillActor }): Promise<TillSession> {
    const b = tillOpenSchema.parse(input);
    const openingCash = b.openingCount ? countTotal(b.openingCount) : b.openingCash!;
    const existing = await this.current(tenantId, { register: b.register, branchId: at.branchId ?? null });
    if (existing) throw new AppError(409, "till_open", `${b.register} is already open`, { sessionId: existing.id });
    try {
      const [row] = await this.db
        .insert(tillSessions)
        .values({
          tenantId,
          branchId: at.branchId ?? null,
          register: b.register,
          status: "open",
          date: todayIST(this.now()),
          openingCash,
          openingCount: b.openingCount ?? null,
          openedBy: uuidOk(at.actor.id),
          openedByName: at.actor.name,
          openedAt: this.now(),
          cashEntries: [],
        })
        .returning();
      this.log.info({ tenantId, sessionId: row!.id, register: b.register, openingCash }, "till opened");
      return toSession(row!);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const again = await this.current(tenantId, { register: b.register, branchId: at.branchId ?? null });
      throw new AppError(409, "till_open", `${b.register} is already open`, { sessionId: again?.id ?? null });
    }
  }

  /** Records cash put in (+) or taken out (−) of an open drawer. */
  async cash(tenantId: string, id: string, input: TillCashInput, actor: TillActor): Promise<TillSession> {
    const b = tillCashSchema.parse(input);
    const row = await this.db.transaction(async (tx) => {
      const s = await this.row(tx, tenantId, id, true);
      if (s.status !== "open") throw new AppError(409, "till_closed", "This till session is closed");
      const entry: TillCashEntry = { id: newId(), amount: b.amount, category: b.category, reason: b.reason, by: uuidOk(actor.id), byName: actor.name, at: this.now().toISOString() };
      const [updated] = await tx
        .update(tillSessions)
        .set({ cashEntries: [...(s.cashEntries ?? []), entry], updatedAt: this.now() })
        .where(and(eq(tillSessions.tenantId, tenantId), eq(tillSessions.id, id)))
        .returning();
      return updated!;
    });
    return toSession(row);
  }

  private async reportOf(db: DbOrTx, tenantId: string, s: TillSessionRow): Promise<TillReport> {
    const [payments, bills, notes] = await Promise.all([
      db
        .select({ method: invoicePayments.method, amount: invoicePayments.amount, source: invoicePayments.source })
        .from(invoicePayments)
        .where(and(eq(invoicePayments.tenantId, tenantId), eq(invoicePayments.tillSessionId, s.id))),
      db
        .select({ status: invoices.status, total: invoices.total, paid: invoices.paid, credited: invoices.credited, number: invoices.number, fy: invoices.fy, seq: invoices.seq, totals: invoices.totals })
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.tillSessionId, s.id))),
      db
        .select({ total: creditNotes.total, totals: creditNotes.totals })
        .from(creditNotes)
        .where(and(eq(creditNotes.tenantId, tenantId), eq(creditNotes.tillSessionId, s.id), eq(creditNotes.status, "issued"))),
    ]);
    return tillReport({
      openingCash: s.openingCash,
      cashEntries: s.cashEntries ?? [],
      payments,
      bills: bills.map((b) => ({
        status: b.status,
        total: b.total,
        balance: balanceOf(b),
        number: b.number,
        fy: b.fy,
        seq: b.seq,
        discount: b.totals?.discount ?? 0,
        taxBreakup: b.totals?.taxBreakup ?? [],
      })),
      creditNotes: notes.map((n) => ({ total: n.total, taxBreakup: n.totals?.taxBreakup ?? [] })),
      handoverDifferences: (s.handovers ?? []).map((h) => h.difference),
    });
  }

  /** X report: the session's running totals (the Z report once closed). */
  async report(tenantId: string, id: string): Promise<{ session: TillSession; report: TillReport }> {
    const s = await this.row(this.db, tenantId, id);
    if (s.status === "closed" && s.summary) return { session: toSession(s), report: s.summary as TillReport };
    return { session: toSession(s), report: await this.reportOf(this.db, tenantId, s) };
  }

  /**
   * Holds a counted-vs-expected difference to the rules: a reason whenever the count differs, and a manager PIN when it
   * is beyond the shop's limit (owners and admins approve themselves). Returns the approving manager, if any.
   */
  private async checkDifference(
    tenantId: string,
    difference: number,
    reason: string | null | undefined,
    actor: TillActor,
    approval: TillApprovalInput,
  ): Promise<{ userId: string; name: string | null } | null> {
    if (difference === 0) return null;
    if (!reason?.trim()) throw new AppError(400, "till_reason_required", "The count differs from the cash expected: say why", { difference });
    const limit = this.approvals ? await this.approvals.varianceLimit(tenantId) : null;
    if (limit === null || Math.abs(difference) <= limit || approval.selfApprove) return null;
    const pin = approval.pin?.trim();
    const details = { difference, limit };
    if (!pin) throw new AppError(403, "till_approval_required", "This difference needs a manager's approval", details);
    const approver = await this.approvals!.approve(tenantId, pin, actor.id);
    if (!approver) throw new AppError(403, "till_approval_invalid", "That PIN can't approve this. Ask a manager for their PIN", details);
    return approver;
  }

  /** Closes the drawer with the count; freezes the X report as the Z report (numbered Z1, Z2 ... per register) and stores expected / counted / difference. */
  async close(
    tenantId: string,
    id: string,
    input: TillCloseInput,
    actor: TillActor,
    approval: TillApprovalInput = {},
  ): Promise<{ session: TillSession; report: TillReport }> {
    const b = tillCloseSchema.parse(input);
    const counted = b.count ? countTotal(b.count) : b.countedCash!;
    const row = await this.db.transaction(async (tx) => {
      const s = await this.row(tx, tenantId, id, true);
      if (s.status !== "open") throw new AppError(409, "till_closed", "This till session is already closed");
      const report = await this.reportOf(tx, tenantId, s);
      const difference = counted - report.cash.expected;
      const approver = await this.checkDifference(tenantId, difference, b.reason, actor, approval);
      // Z numbers run per register and branch; the advisory lock keeps two closes from taking the same number.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`till-z:${tenantId}:${s.branchId ?? ""}:${s.register.toLowerCase()}`}))`);
      const [last] = await tx
        .select({ n: sql<number>`coalesce(max(${tillSessions.zNumber}), 0)` })
        .from(tillSessions)
        .where(
          and(
            eq(tillSessions.tenantId, tenantId),
            sql`lower(${tillSessions.register}) = lower(${s.register})`,
            s.branchId ? eq(tillSessions.branchId, s.branchId) : sql`${tillSessions.branchId} is null`,
          ),
        );
      const [updated] = await tx
        .update(tillSessions)
        .set({
          status: "closed",
          closingCount: b.count ?? null,
          expectedCash: report.cash.expected,
          countedCash: counted,
          difference,
          summary: report,
          zNumber: Number(last?.n ?? 0) + 1,
          differenceReason: difference === 0 ? null : (b.reason?.trim() ?? null),
          closeApprovedBy: uuidOk(approver?.userId ?? null),
          closeApprovedByName: approver?.name ?? null,
          note: b.note ?? null,
          closedBy: uuidOk(actor.id),
          closedByName: actor.name,
          closedAt: this.now(),
          updatedAt: this.now(),
        })
        .where(and(eq(tillSessions.tenantId, tenantId), eq(tillSessions.id, id), eq(tillSessions.status, "open")))
        .returning();
      if (!updated) throw new AppError(409, "till_closed", "This till session is already closed");
      return updated;
    });
    this.log.info({ tenantId, sessionId: id, z: row.zNumber, expected: row.expectedCash, counted, difference: row.difference }, "till closed");
    return { session: toSession(row), report: row.summary as TillReport };
  }

  /**
   * Hands the open drawer to the next cashier without closing the day: the outgoing cashier counts it, the difference
   * (with a reason, and a manager PIN beyond the shop's limit) is recorded against them and the next leg starts from
   * the counted cash. Both names are kept on the session and printed on the Z report.
   */
  async handover(
    tenantId: string,
    id: string,
    input: TillHandoverInput,
    actor: TillActor,
    approval: TillApprovalInput = {},
  ): Promise<{ session: TillSession; report: TillReport }> {
    const b = tillHandoverSchema.parse(input);
    const counted = b.count ? countTotal(b.count) : b.countedCash!;
    const row = await this.db.transaction(async (tx) => {
      const s = await this.row(tx, tenantId, id, true);
      if (s.status !== "open") throw new AppError(409, "till_closed", "This till session is closed");
      const report = await this.reportOf(tx, tenantId, s);
      const difference = counted - report.cash.expected;
      const approver = await this.checkDifference(tenantId, difference, b.reason, actor, approval);
      const from = (s.handovers ?? []).at(-1)?.toName ?? s.openedByName;
      const entry: TillHandover = {
        id: newId(),
        at: this.now().toISOString(),
        fromBy: uuidOk(actor.id),
        fromName: actor.name ?? from,
        toBy: uuidOk(b.toUserId ?? null),
        toName: b.toName,
        count: b.count ?? null,
        expected: report.cash.expected,
        counted,
        difference,
        note: [difference === 0 ? null : b.reason?.trim(), b.note?.trim()].filter(Boolean).join(" · ") || null,
        approvedByName: approver?.name ?? null,
      };
      const [updated] = await tx
        .update(tillSessions)
        .set({ handovers: [...(s.handovers ?? []), entry], updatedAt: this.now() })
        .where(and(eq(tillSessions.tenantId, tenantId), eq(tillSessions.id, id)))
        .returning();
      return updated!;
    });
    this.log.info({ tenantId, sessionId: id, to: b.toName, counted }, "till handed over");
    return { session: toSession(row), report: await this.reportOf(this.db, tenantId, row) };
  }

  async list(tenantId: string, query: TillListQuery = {}): Promise<{ items: TillSession[]; total: number }> {
    const p = tillListQuerySchema.parse(query);
    const conds: (SQL | undefined)[] = [eq(tillSessions.tenantId, tenantId)];
    if (p.register) conds.push(sql`lower(${tillSessions.register}) = lower(${p.register})`);
    if (p.status) conds.push(eq(tillSessions.status, p.status));
    if (p.branchId) conds.push(eq(tillSessions.branchId, p.branchId));
    if (p.from) conds.push(gte(tillSessions.date, p.from));
    if (p.to) conds.push(lte(tillSessions.date, p.to));
    const where = and(...conds);
    const [rows, [counted]] = await Promise.all([
      this.db.select().from(tillSessions).where(where).orderBy(desc(tillSessions.openedAt)).limit(p.limit).offset(p.offset),
      this.db.select({ total: count() }).from(tillSessions).where(where),
    ]);
    return { items: rows.map(toSession), total: counted?.total ?? 0 };
  }
}

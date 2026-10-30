/**
 * Recurring invoices (docs/recurring-export-gstin.md): a profile per customer (lines, schedule, draft or issued, optional
 * WhatsApp / SMS of the bill's link) and the scheduler that makes the bills. One bill per (profile, date) — the run row
 * is claimed before the bill is made, so a job that runs twice never bills twice — with a capped catch-up of missed dates,
 * the accounting period lock respected, and the bills numbered, priced and counted against the plan exactly like bills
 * made by hand (they go through `InvoicesService.create`).
 */
import {
  AppError,
  badRequest,
  conflict,
  defineSort,
  facetCounts,
  listFilter,
  listQuerySchema,
  notFound,
  runList,
  searchAny,
  type FeatureGatePort,
  type ListPage,
  type TenantRef,
} from "@rbms/core";
import type { Db } from "@rbms/db";
import { computeInvoice, todayIST, type LineInput } from "@rbms/gst";
import { and, asc, count, desc, eq, inArray, lt, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { noopLogger, type LoggerPort } from "./ports";
import {
  addDays,
  CATCH_UP_LIMIT,
  MAX_RUN_ATTEMPTS,
  nextAfter,
  nextOnOrAfter,
  planDue,
  previewDates,
  scheduleProblem,
  type Schedule,
} from "./recurring-calc";
import { billingCustomers, invoices } from "./schema";
import {
  RECURRING_FREQUENCIES,
  RECURRING_ISSUE_MODES,
  RECURRING_PRICE_MODES,
  RECURRING_SEND_CHANNELS,
  RECURRING_STATUSES,
  recurringProfiles,
  recurringRuns,
  type RecurringProfileRow,
  type RecurringRunRow,
} from "./schema-recurring";
import { dateStr, lineInputSchema, opt, stateCode, toLineInput, type InvoicesService } from "./service";

export const RECURRING_FEATURE = "invoices.recurring";
/** Profiles the scheduler looks at per run (across shops); the rest wait for the next run. */
const SCAN_LIMIT = 500;
/** A run still "pending" after this long was interrupted (crash, deploy): reconciled with the bill it may have made. */
const STALE_PENDING_MS = 10 * 60_000;

// ------------------------------------------------------------------ ports

/** Units and prices of bill lines (the host's catalogue + price lists, apps/api kit-pricing.ts). */
export interface RecurringLinesPort {
  /** Lines without `rate` are priced from the customer's list on `date`; every line of a saved item gets its unit factor. */
  prepare(tenantId: string, lines: unknown[], opts: { customerId: string; date: string }): Promise<unknown[]>;
}

export interface RecurringDeps {
  db: Db;
  invoices: InvoicesService;
  /** The shop as the plan / quota checks need it (tenancy). Null = the shop is gone (its profiles are skipped). */
  tenant(tenantId: string): Promise<TenantRef | null>;
  lines?: RecurringLinesPort;
  /** The books' period lock (accounting), null when unlocked or the books are off. */
  lockedThrough?(tenantId: string): Promise<string | null>;
  featureGate?: FeatureGatePort;
  log?: LoggerPort;
  now?: () => Date;
}

// ------------------------------------------------------------------ validation

const locale = z.string().trim().regex(/^[a-z]{2}([-_][A-Za-z]{2})?$/, "Invalid locale");

const profileFields = {
  customerId: z.string().uuid(),
  name: opt(z.string().trim().max(120)),
  lines: z.array(lineInputSchema).min(1, "Add at least one line").max(200),
  placeOfSupply: opt(stateCode),
  notes: opt(z.string().trim().max(2000)),
  dueDays: opt(z.number().int().min(0).max(365)),
  frequency: z.enum(RECURRING_FREQUENCIES),
  interval: z.number().int().min(1, "Repeat every 1 to 24 periods").max(24, "Repeat every 1 to 24 periods").default(1),
  dayOfMonth: opt(z.number().int().min(1).max(31)),
  weekday: opt(z.number().int().min(0).max(6)),
  startDate: dateStr,
  endDate: opt(dateStr),
  maxCount: opt(z.number().int().min(1).max(1000)),
  issueMode: z.enum(RECURRING_ISSUE_MODES).default("draft"),
  priceMode: z.enum(RECURRING_PRICE_MODES).default("fixed"),
  sendChannel: z.enum(RECURRING_SEND_CHANNELS).default("none"),
  sendLocale: opt(locale),
};
export const recurringInputSchema = z.object(profileFields);
export type RecurringInput = z.input<typeof recurringInputSchema>;
export const recurringPatchSchema = z.object(profileFields).partial().omit({ customerId: true });
export type RecurringPatch = z.input<typeof recurringPatchSchema>;

export const recurringListQuerySchema = listQuerySchema().extend({
  status: listFilter.oneOf(RECURRING_STATUSES),
  customerId: listFilter.id(),
  frequency: listFilter.oneOf(RECURRING_FREQUENCIES),
});
export type RecurringListQuery = z.input<typeof recurringListQuerySchema>;

const customerName = sql<string>`coalesce((select ${billingCustomers.name} from ${billingCustomers} where ${billingCustomers.id} = ${recurringProfiles.customerId}), '')`;

export const RECURRING_SORT = defineSort(
  {
    next: recurringProfiles.nextRunDate,
    name: sql`lower(${recurringProfiles.name})`,
    customer: sql`lower(${customerName})`,
    created: recurringProfiles.createdAt,
    count: recurringProfiles.count,
  },
  { default: "next", tieBreaker: [recurringProfiles.createdAt, recurringProfiles.id] },
);

// ------------------------------------------------------------------ DTOs

export interface RecurringProfile {
  id: string;
  branchId: string | null;
  customerId: string;
  customerName: string;
  name: string;
  lines: LineInput[];
  placeOfSupply: string | null;
  notes: string | null;
  dueDays: number | null;
  frequency: RecurringProfileRow["frequency"];
  interval: number;
  dayOfMonth: number | null;
  weekday: number | null;
  startDate: string;
  endDate: string | null;
  maxCount: number | null;
  /** Bills made so far. */
  count: number;
  nextRunDate: string | null;
  status: RecurringProfileRow["status"];
  issueMode: RecurringProfileRow["issueMode"];
  priceMode: RecurringProfileRow["priceMode"];
  sendChannel: RecurringProfileRow["sendChannel"];
  sendLocale: string | null;
  lastRunAt: Date | null;
  lastError: string | null;
  /** Paise: the bill total at the saved prices (a list-priced profile can bill differently). */
  estimate: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecurringRun {
  id: string;
  runDate: string;
  status: RecurringRunRow["status"];
  invoiceId: string | null;
  invoiceNumber: string | null;
  total: number | null;
  attempts: number;
  error: string | null;
  sent: boolean;
  trigger: string;
  createdAt: Date;
}

export interface RecurringDetail extends RecurringProfile {
  runs: RecurringRun[];
  /** The next dates the profile will bill on. */
  upcoming: string[];
}

export interface RecurringRunResult {
  profiles: number;
  created: number;
  failed: number;
  skipped: number;
  locked: number;
}

const toRun = (r: RecurringRunRow): RecurringRun => ({
  id: r.id,
  runDate: r.runDate,
  status: r.status,
  invoiceId: r.invoiceId,
  invoiceNumber: r.invoiceNumber,
  total: r.total,
  attempts: r.attempts,
  error: r.error,
  sent: !!r.sentLogId,
  trigger: r.trigger,
  createdAt: r.createdAt,
});

const scheduleOf = (p: Pick<RecurringProfileRow, "frequency" | "interval" | "dayOfMonth" | "weekday" | "startDate" | "endDate">): Schedule => ({
  frequency: p.frequency,
  interval: p.interval,
  dayOfMonth: p.dayOfMonth,
  weekday: p.weekday,
  startDate: p.startDate,
  endDate: p.endDate,
});

const errorText = (err: unknown): string => {
  if (err instanceof AppError) return err.message;
  if (err instanceof z.ZodError) return err.issues.map((i) => i.message).join("; ");
  return err instanceof Error ? err.message : String(err);
};

const FREQUENCY_WORD: Record<RecurringProfileRow["frequency"], string> = { weekly: "Weekly", monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };

export class RecurringService {
  private readonly db: Db;
  private readonly invoices: InvoicesService;
  private readonly log: LoggerPort;
  private readonly now: () => Date;

  constructor(private readonly deps: RecurringDeps) {
    this.db = deps.db;
    this.invoices = deps.invoices;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  private today() {
    return todayIST(this.now());
  }

  private async featureOn(tenantId: string): Promise<boolean> {
    if (!this.deps.featureGate) return true;
    try {
      return await this.deps.featureGate.isEnabled(tenantId, RECURRING_FEATURE);
    } catch (err) {
      this.log.warn({ err, tenantId }, "recurring: feature check failed");
      return false;
    }
  }

  private async estimate(tenantId: string, lines: LineInput[], placeOfSupply: string | null): Promise<number> {
    try {
      const seller = await this.invoices.sellerProfile(tenantId);
      const state = seller.stateCode ?? placeOfSupply ?? "33";
      return computeInvoice(lines, { sellerState: state, placeOfSupply: placeOfSupply ?? state }).total;
    } catch {
      return 0;
    }
  }

  private async toProfile(r: RecurringProfileRow, name?: string): Promise<RecurringProfile> {
    const cname =
      name ??
      (
        await this.db
          .select({ name: billingCustomers.name })
          .from(billingCustomers)
          .where(and(eq(billingCustomers.tenantId, r.tenantId), eq(billingCustomers.id, r.customerId)))
          .limit(1)
      )[0]?.name ??
      "";
    return {
      id: r.id,
      branchId: r.branchId,
      customerId: r.customerId,
      customerName: cname,
      name: r.name,
      lines: r.lines,
      placeOfSupply: r.placeOfSupply,
      notes: r.notes,
      dueDays: r.dueDays,
      frequency: r.frequency,
      interval: r.interval,
      dayOfMonth: r.dayOfMonth,
      weekday: r.weekday,
      startDate: r.startDate,
      endDate: r.endDate,
      maxCount: r.maxCount,
      count: r.count,
      nextRunDate: r.nextRunDate,
      status: r.status,
      issueMode: r.issueMode,
      priceMode: r.priceMode,
      sendChannel: r.sendChannel,
      sendLocale: r.sendLocale,
      lastRunAt: r.lastRunAt,
      lastError: r.lastError,
      estimate: await this.estimate(r.tenantId, r.lines, r.placeOfSupply),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private async row(tenantId: string, id: string): Promise<RecurringProfileRow> {
    const [r] = await this.db
      .select()
      .from(recurringProfiles)
      .where(and(eq(recurringProfiles.tenantId, tenantId), eq(recurringProfiles.id, id)))
      .limit(1);
    if (!r) throw notFound("Recurring profile");
    return r;
  }

  /** The schedule's first date from today (or the start, when later); null when it has nothing left. */
  private firstDate(s: Schedule): string | null {
    const today = this.today();
    return nextOnOrAfter(s, s.startDate > today ? s.startDate : today);
  }

  private checkSchedule(s: Schedule, maxCount: number | null) {
    const problem = scheduleProblem({ ...s, maxCount });
    if (problem) throw badRequest(problem);
  }

  // ---------------------------------------------------------------- reads

  listConditions(tenantId: string, p: z.output<typeof recurringListQuerySchema>, withStatus = true): SQL | undefined {
    return and(
      eq(recurringProfiles.tenantId, tenantId),
      withStatus && p.status?.length ? inArray(recurringProfiles.status, p.status) : undefined,
      p.customerId ? eq(recurringProfiles.customerId, p.customerId) : undefined,
      p.frequency?.length ? inArray(recurringProfiles.frequency, p.frequency) : undefined,
      searchAny(p.q, [recurringProfiles.name, customerName]),
    );
  }

  async list(tenantId: string, query: RecurringListQuery = {}): Promise<ListPage<RecurringProfile>> {
    const p = recurringListQuerySchema.parse(query);
    const order = RECURRING_SORT.orderBy(p.sort);
    const where = this.listConditions(tenantId, p);
    const [page, byStatus] = await Promise.all([
      runList(p, {
        rows: () => this.db.select({ r: recurringProfiles, customerName }).from(recurringProfiles).where(where).orderBy(...order).limit(p.limit).offset(p.offset),
        count: () => this.db.select({ total: count() }).from(recurringProfiles).where(where),
      }),
      this.db
        .select({ key: recurringProfiles.status, n: count() })
        .from(recurringProfiles)
        .where(this.listConditions(tenantId, p, false))
        .groupBy(recurringProfiles.status),
    ]);
    const items = await Promise.all(page.items.map((x) => this.toProfile(x.r, x.customerName)));
    return { ...page, items, facets: { status: facetCounts(byStatus) } };
  }

  async get(tenantId: string, id: string): Promise<RecurringDetail> {
    const r = await this.row(tenantId, id);
    const runs = await this.db
      .select()
      .from(recurringRuns)
      .where(and(eq(recurringRuns.tenantId, tenantId), eq(recurringRuns.profileId, id)))
      .orderBy(desc(recurringRuns.runDate))
      .limit(100);
    const upcoming =
      r.status === "active" && r.nextRunDate
        ? previewDates(scheduleOf(r), r.nextRunDate, 5, r.maxCount === null ? null : Math.max(0, r.maxCount - r.count))
        : [];
    return { ...(await this.toProfile(r)), runs: runs.map(toRun), upcoming };
  }

  /** Header figures: active / paused profiles, bills due in the next 7 days, failed runs in the last 30 days. */
  async summary(tenantId: string) {
    const today = this.today();
    const [byStatus, [soon], [failed]] = await Promise.all([
      this.db.select({ key: recurringProfiles.status, n: count() }).from(recurringProfiles).where(eq(recurringProfiles.tenantId, tenantId)).groupBy(recurringProfiles.status),
      this.db
        .select({ n: count() })
        .from(recurringProfiles)
        .where(and(eq(recurringProfiles.tenantId, tenantId), eq(recurringProfiles.status, "active"), lte(recurringProfiles.nextRunDate, addDays(today, 7)))),
      this.db
        .select({ n: count() })
        .from(recurringRuns)
        .where(and(eq(recurringRuns.tenantId, tenantId), eq(recurringRuns.status, "failed"), sql`${recurringRuns.runDate} >= ${addDays(today, -30)}`)),
    ]);
    const s = facetCounts(byStatus);
    return { active: s.active ?? 0, paused: s.paused ?? 0, ended: s.ended ?? 0, dueThisWeek: soon?.n ?? 0, failed: failed?.n ?? 0 };
  }

  /** The next dates a schedule would bill on (the form's preview); no profile needed. */
  preview(input: { frequency?: unknown; interval?: unknown; dayOfMonth?: unknown; weekday?: unknown; startDate?: unknown; endDate?: unknown; maxCount?: unknown }) {
    const p = z
      .object({
        frequency: profileFields.frequency,
        interval: z.coerce.number().int().min(1).max(24).default(1),
        dayOfMonth: z.coerce.number().int().min(1).max(31).nullish(),
        weekday: z.coerce.number().int().min(0).max(6).nullish(),
        startDate: dateStr,
        endDate: dateStr.nullish(),
        maxCount: z.coerce.number().int().min(1).max(1000).nullish(),
      })
      .parse(input);
    const s: Schedule = { frequency: p.frequency, interval: p.interval, dayOfMonth: p.dayOfMonth ?? null, weekday: p.weekday ?? null, startDate: p.startDate, endDate: p.endDate ?? null };
    this.checkSchedule(s, p.maxCount ?? null);
    const today = this.today();
    return { dates: previewDates(s, s.startDate > today ? s.startDate : today, 6, p.maxCount ?? null) };
  }

  // ---------------------------------------------------------------- writes

  async create(tenant: TenantRef, input: RecurringInput, opts: { userId?: string | null; branchId?: string | null } = {}): Promise<RecurringDetail> {
    const b = recurringInputSchema.parse(input);
    const customer = await this.invoices.getCustomer(tenant.id, b.customerId);
    const s: Schedule = {
      frequency: b.frequency,
      interval: b.interval,
      dayOfMonth: b.frequency === "weekly" ? null : (b.dayOfMonth ?? null),
      weekday: b.frequency === "weekly" ? (b.weekday ?? null) : null,
      startDate: b.startDate,
      endDate: b.endDate ?? null,
    };
    this.checkSchedule(s, b.maxCount ?? null);
    const next = this.firstDate(s);
    if (!next) throw badRequest("No bill falls between today and the end date");
    const [row] = await this.db
      .insert(recurringProfiles)
      .values({
        tenantId: tenant.id,
        branchId: opts.branchId ?? null,
        customerId: customer.id,
        name: b.name ?? `${FREQUENCY_WORD[b.frequency]} – ${customer.name}`,
        lines: b.lines,
        placeOfSupply: b.placeOfSupply ?? null,
        notes: b.notes ?? null,
        dueDays: b.dueDays ?? null,
        ...s,
        maxCount: b.maxCount ?? null,
        nextRunDate: next,
        status: "active",
        issueMode: b.issueMode,
        priceMode: b.priceMode,
        sendChannel: b.sendChannel,
        sendLocale: b.sendLocale ?? null,
        createdBy: opts.userId ?? null,
      })
      .returning();
    return this.get(tenant.id, row!.id);
  }

  async update(tenantId: string, id: string, input: RecurringPatch): Promise<RecurringDetail> {
    const b = recurringPatchSchema.parse(input);
    const r = await this.row(tenantId, id);
    if (r.status === "ended") throw badRequest("This recurring profile has ended; make a new one");
    const frequency = b.frequency ?? r.frequency;
    const s: Schedule = {
      frequency,
      interval: b.interval ?? r.interval,
      dayOfMonth: frequency === "weekly" ? null : b.dayOfMonth !== undefined ? b.dayOfMonth : r.dayOfMonth,
      weekday: frequency === "weekly" ? (b.weekday !== undefined ? b.weekday : r.weekday) : null,
      startDate: b.startDate ?? r.startDate,
      endDate: b.endDate !== undefined ? b.endDate : r.endDate,
    };
    const maxCount = b.maxCount !== undefined ? b.maxCount : r.maxCount;
    this.checkSchedule(s, maxCount);
    if (maxCount !== null && maxCount < r.count) throw badRequest(`${r.count} bills were already made; the limit can't be lower`);
    const scheduleChanged = (["frequency", "interval", "dayOfMonth", "weekday", "startDate", "endDate"] as const).some((k) => b[k] !== undefined);
    const set: Partial<RecurringProfileRow> = { ...s, maxCount };
    if (b.name !== undefined) set.name = b.name ?? r.name;
    if (b.lines) set.lines = b.lines;
    if (b.placeOfSupply !== undefined) set.placeOfSupply = b.placeOfSupply;
    if (b.notes !== undefined) set.notes = b.notes;
    if (b.dueDays !== undefined) set.dueDays = b.dueDays;
    if (b.issueMode) set.issueMode = b.issueMode;
    if (b.priceMode) set.priceMode = b.priceMode;
    if (b.sendChannel) set.sendChannel = b.sendChannel;
    if (b.sendLocale !== undefined) set.sendLocale = b.sendLocale;
    if (scheduleChanged || (maxCount !== null && r.count >= maxCount)) {
      const next = maxCount !== null && r.count >= maxCount ? null : this.firstDate(s);
      set.nextRunDate = next;
      if (!next && r.status === "active") set.status = "ended";
    }
    await this.db.update(recurringProfiles).set(set).where(and(eq(recurringProfiles.tenantId, tenantId), eq(recurringProfiles.id, id)));
    return this.get(tenantId, id);
  }

  async pause(tenantId: string, id: string): Promise<RecurringDetail> {
    const r = await this.row(tenantId, id);
    if (r.status !== "active") throw badRequest("Only an active profile can be paused");
    await this.db.update(recurringProfiles).set({ status: "paused" }).where(and(eq(recurringProfiles.tenantId, tenantId), eq(recurringProfiles.id, id)));
    return this.get(tenantId, id);
  }

  /** Back to active from the next date on or after today: dates missed while paused are not billed. */
  async resume(tenantId: string, id: string): Promise<RecurringDetail> {
    const r = await this.row(tenantId, id);
    if (r.status !== "paused") throw badRequest("Only a paused profile can be resumed");
    const next = r.maxCount !== null && r.count >= r.maxCount ? null : this.firstDate(scheduleOf(r));
    await this.db
      .update(recurringProfiles)
      .set({ status: next ? "active" : "ended", nextRunDate: next })
      .where(and(eq(recurringProfiles.tenantId, tenantId), eq(recurringProfiles.id, id)));
    return this.get(tenantId, id);
  }

  /** Stops the profile for good (bills already made stay). */
  async end(tenantId: string, id: string): Promise<RecurringDetail> {
    await this.row(tenantId, id);
    await this.db
      .update(recurringProfiles)
      .set({ status: "ended", nextRunDate: null })
      .where(and(eq(recurringProfiles.tenantId, tenantId), eq(recurringProfiles.id, id)));
    return this.get(tenantId, id);
  }

  /** Skips the next date (recorded in the history); the one after becomes next. */
  async skipNext(tenantId: string, id: string): Promise<RecurringDetail> {
    await this.db.transaction(async (tx) => {
      const [r] = await tx
        .select()
        .from(recurringProfiles)
        .where(and(eq(recurringProfiles.tenantId, tenantId), eq(recurringProfiles.id, id)))
        .for("update");
      if (!r) throw notFound("Recurring profile");
      if (r.status !== "active" || !r.nextRunDate) throw badRequest("There is no next bill to skip");
      const claimed = await tx
        .insert(recurringRuns)
        .values({ tenantId, profileId: id, runDate: r.nextRunDate, status: "skipped", trigger: "user", error: null })
        .onConflictDoNothing()
        .returning({ id: recurringRuns.id });
      if (!claimed.length) throw conflict("That date was already billed; reload and try again");
      const next = nextAfter(scheduleOf(r), r.nextRunDate);
      await tx
        .update(recurringProfiles)
        .set({ nextRunDate: next, status: next ? "active" : "ended" })
        .where(and(eq(recurringProfiles.tenantId, tenantId), eq(recurringProfiles.id, id)));
    });
    return this.get(tenantId, id);
  }

  /** Only a profile that never made a bill can be deleted (otherwise end it: the history stays). */
  async remove(tenantId: string, id: string): Promise<void> {
    const r = await this.row(tenantId, id);
    if (r.count > 0) throw badRequest("This profile already made bills; end it instead so its history stays");
    await this.db.delete(recurringProfiles).where(and(eq(recurringProfiles.tenantId, tenantId), eq(recurringProfiles.id, id)));
  }

  /**
   * Makes today's bill now (button "Bill now"): a run dated today. If today is also a scheduled date it is that date's
   * bill (the scheduler then finds it done); otherwise it is an extra bill and the schedule is unchanged.
   */
  async runNow(tenant: TenantRef, id: string): Promise<{ run: RecurringRun; profile: RecurringDetail }> {
    const today = this.today();
    const r = await this.row(tenant.id, id);
    if (r.status === "ended") throw badRequest("This recurring profile has ended");
    if (r.maxCount !== null && r.count >= r.maxCount) throw badRequest("The number of bills of this profile is reached");
    const claimed = await this.db
      .insert(recurringRuns)
      .values({ tenantId: tenant.id, profileId: id, runDate: today, status: "pending", trigger: "manual" })
      .onConflictDoNothing()
      .returning();
    if (!claimed.length) throw conflict("Today's bill of this profile was already made");
    if (r.nextRunDate === today) {
      const next = nextAfter(scheduleOf(r), today);
      await this.db
        .update(recurringProfiles)
        .set({ nextRunDate: next, ...(r.status === "active" && !next ? { status: "ended" as const } : {}) })
        .where(and(eq(recurringProfiles.tenantId, tenant.id), eq(recurringProfiles.id, id)));
    }
    const run = await this.makeBill(tenant, r, claimed[0]!);
    return { run: toRun(run), profile: await this.get(tenant.id, id) };
  }

  // ---------------------------------------------------------------- the scheduler

  /** The scheduled job: every active profile that is due, in every shop with the feature on. */
  async runDue(now: Date = this.now()): Promise<RecurringRunResult> {
    const today = todayIST(now);
    const due = await this.db
      .select({ id: recurringProfiles.id, tenantId: recurringProfiles.tenantId })
      .from(recurringProfiles)
      .where(and(eq(recurringProfiles.status, "active"), lte(recurringProfiles.nextRunDate, today)))
      .orderBy(asc(recurringProfiles.nextRunDate))
      .limit(SCAN_LIMIT);
    // Failed runs waiting for a retry, and runs left pending by an interrupted job.
    const retry = await this.db
      .selectDistinct({ id: recurringRuns.profileId, tenantId: recurringRuns.tenantId })
      .from(recurringRuns)
      .where(
        sql`(${recurringRuns.status} = 'failed' and ${recurringRuns.attempts} < ${MAX_RUN_ATTEMPTS} and ${recurringRuns.runDate} >= ${addDays(today, -45)})
          or (${recurringRuns.status} = 'pending' and ${recurringRuns.updatedAt} < ${new Date(now.getTime() - STALE_PENDING_MS).toISOString()})`,
      )
      .limit(SCAN_LIMIT);
    const seen = new Set<string>();
    const result: RecurringRunResult = { profiles: 0, created: 0, failed: 0, skipped: 0, locked: 0 };
    const enabled = new Map<string, boolean>();
    for (const p of [...due, ...retry]) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      if (!enabled.has(p.tenantId)) enabled.set(p.tenantId, await this.featureOn(p.tenantId));
      if (!enabled.get(p.tenantId)) continue;
      result.profiles += 1;
      try {
        const r = await this.runProfile(p.tenantId, p.id, now);
        result.created += r.created;
        result.failed += r.failed;
        result.skipped += r.skipped;
        result.locked += r.locked;
      } catch (err) {
        result.failed += 1;
        this.log.error({ err, tenantId: p.tenantId, profileId: p.id }, "recurring: profile run failed");
      }
    }
    return result;
  }

  /**
   * One profile's due work: claims every due date (the latest `CATCH_UP_LIMIT` to bill, older missed ones recorded as
   * skipped) and moves the next date on in one transaction, then makes the bills. Safe to run twice at once: the
   * profile row is locked while claiming and each (profile, date) can be claimed once.
   */
  async runProfile(tenantId: string, id: string, now: Date = this.now()): Promise<Omit<RecurringRunResult, "profiles">> {
    const today = todayIST(now);
    const out = { created: 0, failed: 0, skipped: 0, locked: 0 };
    await this.reconcileStale(tenantId, id, now);
    const claimed = await this.db.transaction(async (tx) => {
      const [p] = await tx
        .select()
        .from(recurringProfiles)
        .where(and(eq(recurringProfiles.tenantId, tenantId), eq(recurringProfiles.id, id)))
        .for("update");
      if (!p || p.status === "paused") return { profile: p ?? null, runs: [] as RecurringRunRow[] };
      const runs: RecurringRunRow[] = [];
      // Retries first: failed runs (not too old, attempts left) go back to pending.
      const retried = await tx
        .update(recurringRuns)
        .set({ status: "pending", updatedAt: sql`now()` })
        .where(
          and(
            eq(recurringRuns.tenantId, tenantId),
            eq(recurringRuns.profileId, id),
            eq(recurringRuns.status, "failed"),
            lt(recurringRuns.attempts, MAX_RUN_ATTEMPTS),
            sql`${recurringRuns.runDate} >= ${addDays(today, -45)}`,
          ),
        )
        .returning();
      runs.push(...retried);
      if (p.status !== "active" || !p.nextRunDate || p.nextRunDate > today) return { profile: p, runs };
      const [{ inFlight } = { inFlight: 0 }] = await tx
        .select({ inFlight: count() })
        .from(recurringRuns)
        .where(and(eq(recurringRuns.tenantId, tenantId), eq(recurringRuns.profileId, id), eq(recurringRuns.status, "pending")));
      const remaining = p.maxCount === null ? null : Math.max(0, p.maxCount - p.count - Number(inFlight));
      const plan = planDue(scheduleOf(p), p.nextRunDate, today, remaining, CATCH_UP_LIMIT);
      if (plan.missed.length) {
        const missed = await tx
          .insert(recurringRuns)
          .values(plan.missed.map((d) => ({ tenantId, profileId: id, runDate: d, status: "skipped" as const, error: "Missed: older than the catch-up limit" })))
          .onConflictDoNothing()
          .returning({ id: recurringRuns.id });
        out.skipped += missed.length;
      }
      if (plan.bill.length) {
        const fresh = await tx
          .insert(recurringRuns)
          .values(plan.bill.map((d) => ({ tenantId, profileId: id, runDate: d, status: "pending" as const })))
          .onConflictDoNothing()
          .returning();
        runs.push(...fresh);
      }
      await tx
        .update(recurringProfiles)
        .set({ nextRunDate: plan.next, status: plan.next ? "active" : "ended", lastRunAt: now })
        .where(and(eq(recurringProfiles.tenantId, tenantId), eq(recurringProfiles.id, id)));
      return { profile: { ...p, nextRunDate: plan.next }, runs };
    });
    if (!claimed.profile || claimed.runs.length === 0) return out;
    const tenant = await this.deps.tenant(tenantId);
    for (const run of claimed.runs.sort((a, b) => a.runDate.localeCompare(b.runDate))) {
      if (!tenant) {
        await this.failRun(claimed.profile, run, "The shop could not be found");
        out.failed += 1;
        continue;
      }
      const done = await this.makeBill(tenant, claimed.profile, run);
      if (done.status === "created") out.created += 1;
      else if (done.status === "locked") out.locked += 1;
      else if (done.status === "failed") out.failed += 1;
    }
    return out;
  }

  /** Runs left "pending" by an interrupted job: done if their bill exists, else failed (and retried). */
  private async reconcileStale(tenantId: string, profileId: string, now: Date) {
    const stale = await this.db
      .select()
      .from(recurringRuns)
      .where(
        and(
          eq(recurringRuns.tenantId, tenantId),
          eq(recurringRuns.profileId, profileId),
          eq(recurringRuns.status, "pending"),
          lt(recurringRuns.updatedAt, new Date(now.getTime() - STALE_PENDING_MS)),
        ),
      );
    for (const run of stale) {
      const [bill] = await this.db
        .select({ id: invoices.id, number: invoices.number, total: invoices.total })
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.recurringRunId, run.id)))
        .limit(1);
      if (bill) {
        await this.db.update(recurringRuns).set({ status: "created", invoiceId: bill.id, invoiceNumber: bill.number, total: bill.total }).where(eq(recurringRuns.id, run.id));
        await this.db.update(recurringProfiles).set({ count: sql`${recurringProfiles.count} + 1` }).where(eq(recurringProfiles.id, profileId));
      } else {
        await this.db
          .update(recurringRuns)
          .set({ status: "failed", attempts: sql`${recurringRuns.attempts} + 1`, error: "Interrupted; will retry" })
          .where(eq(recurringRuns.id, run.id));
      }
    }
  }

  private async failRun(p: RecurringProfileRow, run: RecurringRunRow, message: string): Promise<RecurringRunRow> {
    const [updated] = await this.db
      .update(recurringRuns)
      .set({ status: "failed", attempts: sql`${recurringRuns.attempts} + 1`, error: message.slice(0, 500) })
      .where(eq(recurringRuns.id, run.id))
      .returning();
    await this.db.update(recurringProfiles).set({ lastError: message.slice(0, 500) }).where(eq(recurringProfiles.id, p.id));
    this.log.warn({ tenantId: p.tenantId, profileId: p.id, runDate: run.runDate, error: message }, "recurring: bill not made");
    return updated ?? run;
  }

  /** Makes the bill of one claimed run (draft or issued), sends it when asked, and records the outcome. Never throws. */
  private async makeBill(tenant: TenantRef, p: RecurringProfileRow, run: RecurringRunRow): Promise<RecurringRunRow> {
    try {
      const locked = this.deps.lockedThrough ? await this.deps.lockedThrough(tenant.id) : null;
      if (locked && run.runDate <= locked) {
        const [r] = await this.db
          .update(recurringRuns)
          .set({ status: "locked", error: `The books are locked up to ${locked}` })
          .where(eq(recurringRuns.id, run.id))
          .returning();
        return r ?? run;
      }
      let lines: unknown[] = p.lines;
      if (p.priceMode === "list" && this.deps.lines) {
        // Saved items are priced again from the customer's list on the bill date; free-text lines keep their price.
        lines = p.lines.map((l) => (l.itemId ? { ...l, rate: undefined, inclusiveTotal: undefined } : l));
      }
      if (this.deps.lines) lines = await this.deps.lines.prepare(tenant.id, lines, { customerId: p.customerId, date: run.runDate });
      const inv = await this.invoices.create(
        tenant,
        {
          customerId: p.customerId,
          date: run.runDate,
          dueDate: p.dueDays !== null ? addDays(run.runDate, p.dueDays) : null,
          placeOfSupply: p.placeOfSupply,
          lines: lines as never,
          notes: p.notes,
          issue: p.issueMode === "issue",
        },
        { branchId: p.branchId, recurringRunId: run.id },
      );
      let sentLogId: string | null = null;
      let sendError: string | null = null;
      if (p.issueMode === "issue" && p.sendChannel !== "none") {
        try {
          sentLogId = (await this.invoices.sendInvoice(tenant.id, inv.id, { channel: p.sendChannel, locale: p.sendLocale ?? undefined })).logId;
        } catch (err) {
          sendError = `Bill made; not sent: ${errorText(err)}`;
          this.log.warn({ err, tenantId: tenant.id, invoiceId: inv.id }, "recurring: sending the bill failed");
        }
      }
      const [r] = await this.db
        .update(recurringRuns)
        .set({ status: "created", invoiceId: inv.id, invoiceNumber: inv.number, total: inv.total, sentLogId, error: sendError, attempts: sql`${recurringRuns.attempts} + 1` })
        .where(eq(recurringRuns.id, run.id))
        .returning();
      const [after] = await this.db
        .update(recurringProfiles)
        .set({ count: sql`${recurringProfiles.count} + 1`, lastError: sendError, lastRunAt: this.now() })
        .where(eq(recurringProfiles.id, p.id))
        .returning({ count: recurringProfiles.count, maxCount: recurringProfiles.maxCount });
      if (after && after.maxCount !== null && after.count >= after.maxCount) {
        await this.db.update(recurringProfiles).set({ status: "ended", nextRunDate: null }).where(eq(recurringProfiles.id, p.id));
      }
      return r ?? run;
    } catch (err) {
      return this.failRun(p, run, errorText(err));
    }
  }
}

/** A bill's lines as a profile stores them (for "Make recurring" from an existing bill). */
export const profileLinesOf = (lines: Parameters<typeof toLineInput>[0][]) => lines.map(toLineInput);

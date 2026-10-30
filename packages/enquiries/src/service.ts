import { conflict, defineSort, facetCounts, listFilter, listQuerySchema, notFound, rangeOrder, searchAny, tooMany, type ListPage } from "@rbms/core";
import type { Db } from "@rbms/db";
import { and, count, desc, eq, gte, inArray, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { ALERT_RATE, ENQUIRY_DIGEST_JOB, formatEnquiryNumber, MemoryWindowCounter, REPEAT_WINDOW_MS, SHOP_RATE, toIndianE164, VISITOR_RATE } from "./logic";
import { noopLogger, type EnquiryCounterPort, type EnquiryNotifyPort, type EnquiryQueuePort, type LoggerPort } from "./ports";
import { ENQUIRY_STATUSES, enquiries as E, type EnquiryRow, type EnquiryStatus } from "./schema";

export interface EnquiriesDeps {
  db: Db;
  notify?: EnquiryNotifyPort;
  /** Shared counter for the form's limits and the alert cap (Redis in the API). Default: this process's memory. */
  counter?: EnquiryCounterPort;
  /** For the digest after the alert cap; without it held-back alerts are only logged. */
  queue?: EnquiryQueuePort;
  now?: () => Date;
  log?: LoggerPort;
}

/** Data of the `ENQUIRY_DIGEST_JOB` job. */
export interface EnquiryDigestJob {
  tenantId: string;
  /** ISO time of the first held-back enquiry. */
  since: string;
}

/** Collapses runs of whitespace; "" → undefined so empty optional fields are left out. */
const line = (max: number) =>
  z
    .string()
    .transform((v) => v.replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max))
    .optional()
    .transform((v) => v || undefined);

/** What the website form posts (`POST /public`). `website` is the honeypot: people never see it, bots fill it. */
export const publicEnquiryInput = z.object({
  name: z
    .string()
    .transform((v) => v.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(2, "Enter your name").max(80)),
  phone: z
    .string()
    .max(20)
    .transform((v, ctx) => {
      const e164 = toIndianE164(v);
      if (!e164) ctx.addIssue({ code: "custom", message: "Enter a 10-digit Indian mobile number" });
      return e164 ?? "";
    }),
  email: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => v || undefined)
    .pipe(z.string().email("Enter a valid email").optional()),
  topic: line(60),
  studentName: line(80),
  option: line(60),
  message: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => v || undefined),
  source: line(200),
  noticeVersion: line(40),
  website: z.string().max(200).optional(),
});
export type PublicEnquiryInput = z.input<typeof publicEnquiryInput>;

export const enquiryPatch = z
  .object({
    status: z.enum(ENQUIRY_STATUSES).optional(),
    note: z
      .string()
      .trim()
      .max(2000)
      .nullable()
      .optional()
      .transform((v) => (v === undefined ? undefined : v || null)),
  })
  .refine((b) => b.status !== undefined || b.note !== undefined, { message: "Nothing to change" });

export const enquiryListQuery = listQuerySchema()
  .extend({
    status: listFilter.oneOf(ENQUIRY_STATUSES),
    topic: z.string().trim().max(60).optional(),
    from: listFilter.date(),
    to: listFilter.date(),
  })
  .superRefine(rangeOrder("from", "to"));
export type EnquiryListQuery = z.input<typeof enquiryListQuery>;

export const ENQUIRY_SORT = defineSort(
  { date: E.createdAt, name: sql`lower(${E.name})`, status: E.status, number: E.enquiryNo },
  { default: "-date", tieBreaker: E.id },
);

export interface EnquiryView {
  id: string;
  number: string;
  name: string;
  phone: string;
  email: string | null;
  topic: string | null;
  studentName: string | null;
  option: string | null;
  message: string | null;
  source: string | null;
  noticeVersion: string | null;
  status: EnquiryStatus;
  note: string | null;
  contactedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnquiriesSummary {
  /** Still `new`. */
  open: number;
  today: number;
  last7Days: number;
  /** Converted in the last 30 days. */
  converted30Days: number;
}

const view = (r: EnquiryRow): EnquiryView => ({
  id: r.id,
  number: r.number,
  name: r.name,
  phone: r.phone,
  email: r.email,
  topic: r.topic,
  studentName: r.studentName,
  option: r.option,
  message: r.message,
  source: r.source,
  noticeVersion: r.noticeVersion,
  status: r.status,
  note: r.note,
  contactedAt: r.contactedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

/** Start of today in India (IST, UTC+5:30) as a Date. */
function istDayStart(now: Date): Date {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 330 * 60_000);
}

/** `YYYY-MM-DD` (IST day) → its start as a Date. */
const istDate = (d: string) => new Date(`${d}T00:00:00+05:30`);

function uniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export class EnquiriesService {
  private readonly db: Db;
  private readonly notify?: EnquiryNotifyPort;
  private readonly now: () => Date;
  private readonly log: LoggerPort;
  private readonly counter: EnquiryCounterPort;
  private readonly queue?: EnquiryQueuePort;

  constructor(deps: EnquiriesDeps) {
    this.db = deps.db;
    this.notify = deps.notify;
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? noopLogger;
    this.counter = deps.counter ?? new MemoryWindowCounter(() => this.now().getTime());
    this.queue = deps.queue;
  }

  /** Counts one hit; false once `max` hits fall in the current window. */
  private async under(key: string, max: number, windowMs: number): Promise<boolean> {
    return (await this.counter.hit(key, windowMs)).count <= max;
  }

  /**
   * An enquiry from the website. Limited per visitor (shop + IP) and per shop. The honeypot filled → a normal-looking
   * answer and nothing stored. The same phone and topic again within half an hour → the first enquiry's number.
   */
  async submit(tenantId: string, input: unknown, opts: { ip?: string | null } = {}): Promise<{ ok: true; number: string | null }> {
    const b = publicEnquiryInput.parse(input);
    if (
      !(await this.under(`enq:v:${tenantId}:${opts.ip ?? "?"}`, VISITOR_RATE.limit, VISITOR_RATE.windowMs)) ||
      !(await this.under(`enq:s:${tenantId}`, SHOP_RATE.limit, SHOP_RATE.windowMs))
    ) {
      throw tooMany("Too many enquiries from here: please try again in a few minutes");
    }
    if (b.website?.trim()) {
      this.log.info({ tenantId }, "enquiries: honeypot filled, dropped");
      return { ok: true, number: null };
    }
    const since = new Date(this.now().getTime() - REPEAT_WINDOW_MS);
    const [repeat] = await this.db
      .select({ number: E.number })
      .from(E)
      .where(and(eq(E.tenantId, tenantId), eq(E.phone, b.phone), b.topic ? eq(E.topic, b.topic) : sql`${E.topic} is null`, gte(E.createdAt, since)))
      .orderBy(desc(E.createdAt))
      .limit(1);
    if (repeat) return { ok: true, number: repeat.number };

    let row: EnquiryRow;
    try {
      row = await this.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`enquiries:no:${tenantId}`}))`);
        const [r] = await tx
          .select({ n: sql<number>`coalesce(max(${E.enquiryNo}), 0)::int` })
          .from(E)
          .where(eq(E.tenantId, tenantId));
        const enquiryNo = (r?.n ?? 0) + 1;
        const [created] = await tx
          .insert(E)
          .values({
            tenantId,
            enquiryNo,
            number: formatEnquiryNumber(enquiryNo),
            name: b.name,
            phone: b.phone,
            email: b.email ?? null,
            topic: b.topic ?? null,
            studentName: b.studentName ?? null,
            option: b.option ?? null,
            message: b.message ?? null,
            source: b.source ?? null,
            noticeVersion: b.noticeVersion ?? null,
          })
          .returning();
        return created!;
      });
    } catch (err) {
      if (uniqueViolation(err)) throw conflict("Please send the form again");
      throw err;
    }
    if (this.notify) {
      const n = this.notify;
      const e = { id: row.id, number: row.number, name: row.name, phone: row.phone, topic: row.topic, studentName: row.studentName, option: row.option };
      void this.alert(tenantId, n, e, row.createdAt).catch((err) => this.log.warn({ err, tenantId, enquiry: row.number }, "enquiries: owner alert failed"));
    }
    return { ok: true, number: row.number };
  }

  /**
   * One alert per enquiry up to `ALERT_RATE` an hour per shop (a flood of form posts must not flood the owners' phones
   * or the WhatsApp bill); past that, one digest job when the hour's window ends (same job id = scheduled once).
   */
  private async alert(tenantId: string, n: EnquiryNotifyPort, e: Parameters<EnquiryNotifyPort["received"]>[1], createdAt: Date) {
    const hit = await this.counter.hit(`enq:alert:${tenantId}`, ALERT_RATE.windowMs);
    if (hit.count <= ALERT_RATE.limit) return n.received(tenantId, e);
    if (!this.queue || !n.digest) {
      this.log.info({ tenantId, enquiry: e.number }, "enquiries: owner alert held back (hourly cap)");
      return;
    }
    const windowEnd = Math.round((this.now().getTime() + hit.resetMs) / 60_000);
    const data: EnquiryDigestJob = { tenantId, since: createdAt.toISOString() };
    await this.queue.enqueue(ENQUIRY_DIGEST_JOB, data, { delayMs: hit.resetMs, jobId: `enquiries-digest-${tenantId}-${windowEnd}` });
  }

  /** The digest job: how many enquiries came in since the first held-back one, sent to the owners in one message. */
  async sendDigest(job: EnquiryDigestJob): Promise<void> {
    if (!this.notify?.digest) return;
    const since = new Date(job.since);
    const [r] = await this.db
      .select({ n: count() })
      .from(E)
      .where(and(eq(E.tenantId, job.tenantId), gte(E.createdAt, since)));
    const n = Number(r?.n ?? 0);
    if (n > 0) await this.notify.digest(job.tenantId, { count: n, since });
  }

  private listWhere(tenantId: string, q: z.output<typeof enquiryListQuery>, withStatus = true): SQL | undefined {
    return and(
      eq(E.tenantId, tenantId),
      withStatus && q.status?.length ? inArray(E.status, q.status) : undefined,
      q.topic ? eq(E.topic, q.topic) : undefined,
      q.from ? gte(E.createdAt, istDate(q.from)) : undefined,
      q.to ? lt(E.createdAt, new Date(istDate(q.to).getTime() + 86_400_000)) : undefined,
      searchAny(q.q, [E.number, E.name, E.phone, E.studentName, E.email]),
    );
  }

  /** Paged list with `facets.status` (counts under every other filter) and the topics in use. */
  async list(tenantId: string, query: EnquiryListQuery = {}): Promise<ListPage<EnquiryView> & { topics: string[] }> {
    const q = enquiryListQuery.parse(query);
    const order = ENQUIRY_SORT.orderBy(q.sort);
    const where = this.listWhere(tenantId, q);
    const [rows, [total], byStatus, topics] = await Promise.all([
      this.db.select().from(E).where(where).orderBy(...order).limit(q.limit).offset(q.offset),
      this.db.select({ n: count() }).from(E).where(where),
      this.db
        .select({ key: E.status, n: count() })
        .from(E)
        .where(this.listWhere(tenantId, q, false))
        .groupBy(E.status),
      this.db
        .selectDistinct({ topic: E.topic })
        .from(E)
        .where(and(eq(E.tenantId, tenantId), sql`${E.topic} is not null`))
        .limit(50),
    ]);
    return {
      items: rows.map(view),
      total: total?.n ?? 0,
      limit: q.limit,
      offset: q.offset,
      facets: { status: facetCounts(byStatus) },
      topics: topics.map((t) => t.topic!).sort(),
    };
  }

  private async row(tenantId: string, id: string): Promise<EnquiryRow> {
    const [r] = await this.db
      .select()
      .from(E)
      .where(and(eq(E.tenantId, tenantId), eq(E.id, id)))
      .limit(1);
    if (!r) throw notFound("Enquiry not found");
    return r;
  }

  async get(tenantId: string, id: string): Promise<EnquiryView> {
    return view(await this.row(tenantId, id));
  }

  async update(tenantId: string, id: string, input: unknown): Promise<EnquiryView> {
    const b = enquiryPatch.parse(input);
    const cur = await this.row(tenantId, id);
    const now = this.now();
    const [r] = await this.db
      .update(E)
      .set({
        ...(b.status !== undefined ? { status: b.status } : {}),
        ...(b.note !== undefined ? { note: b.note } : {}),
        ...(b.status && b.status !== "new" && !cur.contactedAt ? { contactedAt: now } : {}),
        updatedAt: now,
      })
      .where(and(eq(E.tenantId, tenantId), eq(E.id, id)))
      .returning();
    return view(r!);
  }

  /** Deletes an enquiry for good (the visitor asked for their data to be erased, or it was spam). */
  async remove(tenantId: string, id: string): Promise<void> {
    const r = await this.db
      .delete(E)
      .where(and(eq(E.tenantId, tenantId), eq(E.id, id)))
      .returning({ id: E.id });
    if (r.length === 0) throw notFound("Enquiry not found");
  }

  /** Dashboard card. */
  async summary(tenantId: string): Promise<EnquiriesSummary> {
    const now = this.now();
    const today = istDayStart(now);
    const week = new Date(today.getTime() - 6 * 86_400_000);
    const month = new Date(now.getTime() - 30 * 86_400_000);
    const [r] = await this.db
      .select({
        open: sql<number>`count(*) filter (where ${E.status} = 'new')::int`,
        today: sql<number>`count(*) filter (where ${E.createdAt} >= ${today.toISOString()}::timestamptz)::int`,
        last7Days: sql<number>`count(*) filter (where ${E.createdAt} >= ${week.toISOString()}::timestamptz)::int`,
        converted30Days: sql<number>`count(*) filter (where ${E.status} = 'converted' and ${E.updatedAt} >= ${month.toISOString()}::timestamptz)::int`,
      })
      .from(E)
      .where(eq(E.tenantId, tenantId));
    return { open: r?.open ?? 0, today: r?.today ?? 0, last7Days: r?.last7Days ?? 0, converted30Days: r?.converted30Days ?? 0 };
  }

  // ------------------------------------------------------------------ privacy (DPDP) hooks for the host

  /** Every enquiry sent with this phone (E.164), for a data copy. */
  async byPhone(tenantId: string, phone: string): Promise<EnquiryView[]> {
    const rows = await this.db
      .select()
      .from(E)
      .where(and(eq(E.tenantId, tenantId), eq(E.phone, phone)))
      .orderBy(desc(E.createdAt));
    return rows.map(view);
  }

  /** Erases every enquiry sent with this phone; returns how many. */
  async eraseByPhone(tenantId: string, phone: string): Promise<number> {
    const r = await this.db
      .delete(E)
      .where(and(eq(E.tenantId, tenantId), eq(E.phone, phone)))
      .returning({ id: E.id });
    return r.length;
  }

  /** Retention: deletes enquiries created before `before`; returns how many. */
  async purgeBefore(tenantId: string, before: Date): Promise<number> {
    const r = await this.db
      .delete(E)
      .where(and(eq(E.tenantId, tenantId), lt(E.createdAt, before)))
      .returning({ id: E.id });
    return r.length;
  }
}


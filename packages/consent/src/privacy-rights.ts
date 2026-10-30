import {
  addDays,
  badRequest,
  conflict,
  defineSort,
  facetCounts,
  listFilter,
  listQuerySchema,
  notFound,
  runList,
  searchAny,
  type AuditPort,
  type ListPage,
} from "@rbms/core";
import type { Db } from "@rbms/db";
import { and, asc, count, desc, eq, inArray, lt, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { NoticeService } from "./privacy-notice-service";
import type { ConsentLogPort, PrivacyHostPort, SubjectHandler, SubjectQuery } from "./privacy-ports";
import type { LoggerPort } from "./ports";
import {
  consentRecords,
  PRIVACY_REQUEST_STATUSES,
  PRIVACY_REQUEST_TYPES,
  privacyRequestEvents,
  privacyRequests,
  type Nominee,
  type PrivacyRequestRow,
  type PrivacyRequestSource,
  type PrivacyRequestStatus,
  type PrivacyRequestType,
} from "./schema";

/** Rights a person can ask for, plus a grievance (a complaint about how their data is handled). */
export const RIGHTS_TYPES = [...PRIVACY_REQUEST_TYPES, "grievance"] as const;

export const rightsListQuerySchema = listQuerySchema({ defaultLimit: 25, maxLimit: 100 }).extend({
  status: listFilter.oneOf(PRIVACY_REQUEST_STATUSES),
  type: listFilter.oneOf(RIGHTS_TYPES),
  /** `1` = only open requests past their due date. */
  overdue: listFilter.bool(),
});
export type RightsListQuery = z.input<typeof rightsListQuerySchema>;

export const RIGHTS_SORT = defineSort(
  { due: privacyRequests.dueAt, created: privacyRequests.createdAt, status: privacyRequests.status, type: privacyRequests.type },
  { default: "due", tieBreaker: privacyRequests.id },
);

export const createRightsSchema = z.object({
  type: z.enum(RIGHTS_TYPES),
  details: z.string().trim().max(2000).optional(),
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  nominee: z.object({ name: z.string().trim().min(1).max(120), phone: z.string().trim().max(20).optional(), relation: z.string().trim().max(60).optional() }).optional(),
  purposes: z.array(z.string().regex(/^[a-z][a-z0-9_.:-]{0,63}$/)).max(10).optional(),
});
export type CreateRightsInput = z.infer<typeof createRightsSchema>;

export interface RightsView {
  id: string;
  type: PrivacyRequestType | "grievance";
  status: PrivacyRequestStatus;
  source: PrivacyRequestSource;
  subjectName: string | null;
  subjectPhone: string | null;
  subjectEmail: string | null;
  details: string | null;
  nominee: Nominee | null;
  purposes: string[] | null;
  dueAt: string;
  overdue: boolean;
  completedAt: string | null;
  resolution: string | null;
  hasResult: boolean;
  createdAt: string;
}

export const isOverdue = (r: { status: string; dueAt: Date }, now: Date) => (r.status === "open" || r.status === "in_progress") && r.dueAt.getTime() < now.getTime();

const toView = (r: PrivacyRequestRow, now = new Date()): RightsView => ({
  id: r.id,
  type: r.type,
  status: r.status,
  source: r.source,
  subjectName: r.subjectName,
  subjectPhone: r.subjectPhone,
  subjectEmail: r.subjectEmail,
  details: r.details,
  nominee: r.nominee ?? null,
  purposes: r.purposes ?? null,
  dueAt: r.dueAt.toISOString(),
  overdue: isOverdue(r, now),
  completedAt: r.completedAt?.toISOString() ?? null,
  resolution: r.resolution,
  hasResult: r.result != null,
  createdAt: r.createdAt.toISOString(),
});

/** Indian mobile to "+91XXXXXXXXXX"; anything else is returned trimmed. */
export function normalisePhone(p: string | null | undefined): string | null {
  const s = (p ?? "").replace(/[\s-]/g, "");
  if (!s) return null;
  if (/^\+?91[6-9]\d{9}$/.test(s)) return `+${s.replace(/^\+/, "")}`;
  if (/^[6-9]\d{9}$/.test(s)) return `+91${s}`;
  return s;
}

const OPEN: PrivacyRequestStatus[] = ["open", "in_progress"];

export interface RightsDeps {
  db: Db;
  host: PrivacyHostPort;
  notices: NoticeService;
  consentLog?: ConsentLogPort;
  audit?: AuditPort;
  log?: LoggerPort;
}

/** Rights requests of a shop's customers: queue with due dates, access / erasure actions and an event trail. */
export class RightsService {
  private readonly handlers = new Map<string, SubjectHandler>();

  constructor(private readonly deps: RightsDeps) {}

  registerHandler(h: SubjectHandler) {
    this.handlers.set(h.id, h);
  }

  handlerList() {
    return [...this.handlers.values()].map((h) => ({ id: h.id, label: h.label, correctionHint: h.correctionHint ?? null }));
  }

  /** Records a request from the store account page (`source` "store", with the user) or taken at the counter. */
  async create(tenantId: string, input: CreateRightsInput, ctx: { source: PrivacyRequestSource; userId?: string | null; actorId?: string | null; now?: Date }): Promise<RightsView> {
    const now = ctx.now ?? new Date();
    const settings = await this.deps.host.settings(tenantId);
    let { name, phone, email } = { name: input.name ?? null, phone: input.phone ?? null, email: input.email || null };
    if (ctx.userId && this.deps.host.contactOf) {
      const c = await this.deps.host.contactOf(tenantId, ctx.userId);
      name ??= c?.name ?? null;
      phone ??= c?.phone ?? null;
      email ??= c?.email ?? null;
    }
    phone = normalisePhone(phone);
    if (!ctx.userId && !phone && !email && !name) throw badRequest("Give the person's name, phone or email");
    if (input.type === "nominate" && !input.nominee) throw badRequest("Name the person to nominate");
    if (input.type === "correction" && !input.details) throw badRequest("Say what should be corrected");
    if (ctx.userId) {
      const [open] = await this.deps.db
        .select({ id: privacyRequests.id })
        .from(privacyRequests)
        .where(and(eq(privacyRequests.tenantId, tenantId), eq(privacyRequests.subjectUserId, ctx.userId), eq(privacyRequests.type, input.type as PrivacyRequestType), inArray(privacyRequests.status, OPEN)))
        .limit(1);
      if (open && input.type !== "grievance") throw conflict("You already have an open request of this kind");
    }
    const [row] = await this.deps.db
      .insert(privacyRequests)
      .values({
        tenantId,
        type: input.type as PrivacyRequestType,
        source: ctx.source,
        subjectUserId: ctx.userId ?? null,
        subjectName: name,
        subjectPhone: phone,
        subjectEmail: email,
        details: input.details || null,
        nominee: input.nominee ?? null,
        purposes: input.purposes ?? null,
        dueAt: addDays(now, settings.responseDays),
        createdBy: ctx.actorId ?? ctx.userId ?? null,
      })
      .returning();
    await this.event(tenantId, row!.id, ctx.actorId ?? ctx.userId ?? null, "created", null, { type: input.type, source: ctx.source });
    if (input.type === "withdraw_consent") return this.applyWithdrawal(tenantId, row!, ctx.actorId ?? null, now);
    return toView(row!, now);
  }

  /** Consent withdrawal is applied at once (it must be as easy as giving it): log it, stop marketing, complete. */
  private async applyWithdrawal(tenantId: string, row: PrivacyRequestRow, actorId: string | null, now: Date): Promise<RightsView> {
    const purposes = row.purposes?.length ? row.purposes : ["marketing"];
    const version = (await this.deps.notices.current(tenantId)).label;
    if (row.subjectUserId && this.deps.consentLog) {
      await this.deps.consentLog.record({ userId: row.subjectUserId, tenantId, purposes: Object.fromEntries(purposes.map((p) => [p, false])), version, source: "web" });
    }
    let stopped = 0;
    if (purposes.some((p) => p.startsWith("marketing") || p.startsWith("whatsapp"))) {
      for (const ref of await this.locateFor(tenantId, row)) {
        await this.handlers.get(ref.handler)?.stopMarketing?.(tenantId, ref.id);
        stopped++;
      }
    }
    await this.event(tenantId, row.id, actorId, "consent_withdrawn", null, { purposes, version, recordsUpdated: stopped });
    const [done] = await this.deps.db
      .update(privacyRequests)
      .set({ status: "completed", completedAt: now, handledBy: actorId, resolution: "Consent withdrawn." })
      .where(eq(privacyRequests.id, row.id))
      .returning();
    return toView(done!, now);
  }

  async mine(tenantId: string, userId: string): Promise<RightsView[]> {
    const rows = await this.deps.db
      .select()
      .from(privacyRequests)
      .where(and(eq(privacyRequests.tenantId, tenantId), eq(privacyRequests.subjectUserId, userId)))
      .orderBy(desc(privacyRequests.createdAt))
      .limit(50);
    return rows.map((r) => toView(r));
  }

  async cancelMine(tenantId: string, userId: string, id: string): Promise<RightsView> {
    const [row] = await this.deps.db
      .update(privacyRequests)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(and(eq(privacyRequests.id, id), eq(privacyRequests.tenantId, tenantId), eq(privacyRequests.subjectUserId, userId), eq(privacyRequests.status, "open")))
      .returning();
    if (!row) throw notFound("Open request");
    await this.event(tenantId, id, userId, "cancelled", null);
    return toView(row);
  }

  /** The person's own copy of their data, once an access request is completed. */
  async resultFor(tenantId: string, userId: string, id: string) {
    const [row] = await this.deps.db
      .select()
      .from(privacyRequests)
      .where(and(eq(privacyRequests.id, id), eq(privacyRequests.tenantId, tenantId), eq(privacyRequests.subjectUserId, userId)))
      .limit(1);
    if (!row || row.type !== "access" || row.status !== "completed" || row.result == null) throw notFound("Data copy");
    return row.result;
  }

  async list(tenantId: string, query: RightsListQuery = {}, now = new Date()): Promise<ListPage<RightsView> & { facets: Record<string, Record<string, number>>; overdueCount: number }> {
    const p = rightsListQuerySchema.parse(query);
    const where = (omit?: "status" | "type"): SQL | undefined =>
      and(
        eq(privacyRequests.tenantId, tenantId),
        omit !== "status" && p.status?.length ? inArray(privacyRequests.status, p.status) : undefined,
        omit !== "type" && p.type?.length ? inArray(privacyRequests.type, p.type as PrivacyRequestType[]) : undefined,
        p.overdue ? and(inArray(privacyRequests.status, OPEN), lt(privacyRequests.dueAt, now)) : undefined,
        searchAny(p.q, [privacyRequests.subjectName, privacyRequests.subjectPhone, privacyRequests.subjectEmail]),
      );
    const [page, byStatus, byType, [od]] = await Promise.all([
      runList(p, {
        rows: () => this.deps.db.select().from(privacyRequests).where(where()).orderBy(...RIGHTS_SORT.orderBy(p.sort)).limit(p.limit).offset(p.offset),
        count: () => this.deps.db.select({ total: count() }).from(privacyRequests).where(where()),
        map: (r: PrivacyRequestRow) => toView(r, now),
      }),
      this.deps.db.select({ key: privacyRequests.status, n: count() }).from(privacyRequests).where(where("status")).groupBy(privacyRequests.status),
      this.deps.db.select({ key: privacyRequests.type, n: count() }).from(privacyRequests).where(where("type")).groupBy(privacyRequests.type),
      this.deps.db
        .select({ n: count() })
        .from(privacyRequests)
        .where(and(eq(privacyRequests.tenantId, tenantId), inArray(privacyRequests.status, OPEN), lt(privacyRequests.dueAt, now))),
    ]);
    return { ...page, facets: { status: facetCounts(byStatus), type: facetCounts(byType) }, overdueCount: Number(od?.n ?? 0) };
  }

  async get(tenantId: string, id: string) {
    const row = await this.row(tenantId, id);
    const events = await this.deps.db.select().from(privacyRequestEvents).where(eq(privacyRequestEvents.requestId, id)).orderBy(asc(privacyRequestEvents.createdAt));
    return {
      request: toView(row),
      result: row.result ?? null,
      events: events.map((e) => ({ id: e.id, actorId: e.actorId, action: e.action, note: e.note, meta: e.meta, createdAt: e.createdAt.toISOString() })),
    };
  }

  async setStatus(tenantId: string, id: string, status: PrivacyRequestStatus, note: string | null, actorId: string | null): Promise<RightsView> {
    const row = await this.row(tenantId, id);
    if (!OPEN.includes(row.status)) throw conflict("This request is already closed");
    if (status === "rejected" && !note) throw badRequest("Say why the request is rejected");
    const done = status === "completed" || status === "rejected" || status === "cancelled";
    const [upd] = await this.deps.db
      .update(privacyRequests)
      .set({ status, handledBy: actorId, resolution: note ?? row.resolution, completedAt: done ? new Date() : null })
      .where(eq(privacyRequests.id, id))
      .returning();
    await this.event(tenantId, id, actorId, "status", note, { from: row.status, to: status });
    return toView(upd!);
  }

  async addNote(tenantId: string, id: string, note: string, actorId: string | null) {
    await this.row(tenantId, id);
    await this.event(tenantId, id, actorId, "note", note.slice(0, 2000));
    return { ok: true };
  }

  /** Customer records of this shop that belong to the requester (matched by account, phone or email). */
  async locate(tenantId: string, id: string, actorId: string | null) {
    const row = await this.row(tenantId, id);
    const refs = await this.locateFor(tenantId, row);
    await this.event(tenantId, id, actorId, "located", null, { records: refs.length });
    return { items: refs };
  }

  /** Builds the copy of the person's data from every module, stores it on the request and moves it to in progress. */
  async buildAccess(tenantId: string, id: string, actorId: string | null, now = new Date()) {
    const row = await this.row(tenantId, id);
    if (row.type !== "access") throw badRequest("This is not an access request");
    if (!OPEN.includes(row.status)) throw conflict("This request is already closed");
    const refs = await this.locateFor(tenantId, row);
    const records: Array<{ handler: string; label: string; data: unknown }> = [];
    for (const ref of refs) {
      try {
        records.push({ handler: ref.handler, label: ref.label, data: await this.handlers.get(ref.handler)!.export(tenantId, ref.id) });
      } catch (err) {
        this.deps.log?.error({ err, handler: ref.handler }, "privacy: export failed");
        records.push({ handler: ref.handler, label: ref.label, data: { error: "Could not be read" } });
      }
    }
    const consents = row.subjectUserId
      ? (
          await this.deps.db
            .select({ purpose: consentRecords.purpose, granted: consentRecords.granted, version: consentRecords.version, at: consentRecords.createdAt })
            .from(consentRecords)
            .where(and(eq(consentRecords.userId, row.subjectUserId), eq(consentRecords.tenantId, tenantId)))
            .orderBy(desc(consentRecords.createdAt))
            .limit(200)
        ).map((c) => ({ ...c, at: c.at.toISOString() }))
      : [];
    const result = { generatedAt: now.toISOString(), subject: { name: row.subjectName, phone: row.subjectPhone, email: row.subjectEmail }, records, consents };
    await this.deps.db.update(privacyRequests).set({ result, status: "in_progress", handledBy: actorId }).where(eq(privacyRequests.id, id));
    await this.event(tenantId, id, actorId, "exported", null, { records: records.length });
    return result;
  }

  /**
   * Anonymises the person in every module. Tax and accounting records stay (the handlers keep them and say so).
   * The request keeps only a minimal proof: type, dates and what was kept; the person's contact details are cleared.
   */
  async erase(tenantId: string, id: string, actorId: string | null, now = new Date()) {
    const row = await this.row(tenantId, id);
    if (row.type !== "erasure") throw badRequest("This is not an erasure request");
    if (!OPEN.includes(row.status)) throw conflict("This request is already closed");
    const refs = await this.locateFor(tenantId, row);
    const anonymised: string[] = [];
    const kept: string[] = [];
    for (const ref of refs) {
      const res = await this.handlers.get(ref.handler)!.anonymise(tenantId, ref.id);
      if (res.anonymised) anonymised.push(ref.label);
      kept.push(...res.kept);
    }
    if (row.subjectUserId) {
      await this.deps.db
        .update(consentRecords)
        .set({ ip: null, userAgent: null })
        .where(and(eq(consentRecords.userId, row.subjectUserId), eq(consentRecords.tenantId, tenantId)));
    }
    const result = { erasedAt: now.toISOString(), anonymised, kept };
    const resolution = kept.length ? `Personal data erased. Kept by law: ${kept.join("; ")}.` : "Personal data erased.";
    const [upd] = await this.deps.db
      .update(privacyRequests)
      .set({ status: "completed", completedAt: now, handledBy: actorId, result, resolution, subjectName: null, subjectPhone: null, subjectEmail: null, details: null, nominee: null })
      .where(eq(privacyRequests.id, id))
      .returning();
    await this.event(tenantId, id, actorId, "erased", null, { anonymised: anonymised.length, kept: kept.length });
    await this.deps.audit?.record({ tenantId, actorUserId: actorId, action: "privacy.erasure.done", entityType: "privacy_request", entityId: id, summary: `Erasure done: ${anonymised.length} records anonymised, ${kept.length} kept by law` });
    return { request: toView(upd!, now), result };
  }

  // ---------------------------------------------------------------- internals

  private async locateFor(tenantId: string, row: PrivacyRequestRow) {
    const q: SubjectQuery = { userId: row.subjectUserId, phone: row.subjectPhone, email: row.subjectEmail };
    if (!q.userId && !q.phone && !q.email) return [];
    const out: Array<{ handler: string; id: string; label: string }> = [];
    for (const h of this.handlers.values()) {
      for (const r of await h.locate(tenantId, q)) out.push({ handler: h.id, id: r.id, label: `${h.label}: ${r.label}` });
    }
    return out;
  }

  private async row(tenantId: string, id: string) {
    const [row] = await this.deps.db.select().from(privacyRequests).where(and(eq(privacyRequests.id, id), eq(privacyRequests.tenantId, tenantId))).limit(1);
    if (!row) throw notFound("Request");
    return row;
  }

  private async event(tenantId: string, requestId: string, actorId: string | null, action: string, note: string | null, meta?: unknown) {
    await this.deps.db.insert(privacyRequestEvents).values({ tenantId, requestId, actorId, action, note, meta: meta ?? null });
  }
}


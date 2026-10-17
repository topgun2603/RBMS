import {
  defineSort,
  listFilter,
  listQuerySchema,
  rangeOrder,
  searchAny,
  splitList,
  type AuditEvent,
  type AuditPort,
  type ListPage,
} from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, count, eq, gte, inArray, like, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { istDayEnd, istDayStart, MAX_SUMMARY, MAX_USER_AGENT } from "./derive";
import { auditEvents, type AuditEventRow } from "./schema";

export interface LoggerPort {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export interface AuditDeps {
  db: Db;
  log?: LoggerPort;
}

/** Most rows a single list call returns (larger `limit`s are clamped, not rejected: older callers send 500). */
export const MAX_LIST = 200;
/** Most rows a CSV export returns. */
export const MAX_CSV = 10_000;
/** The count stops here: `total` is at most this, with `totalCapped: true` when more events match. */
export const MAX_COUNT = 10_000;

const optText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().min(1).max(max).optional());
const textList = (maxItem: number, maxItems: number) =>
  z.preprocess(splitList, z.array(z.string().min(1).max(maxItem)).max(maxItems).optional());

const auditFilterShape = {
  entityType: textList(100, 20),
  entityId: optText(200),
  actorUserId: listFilter.ids(),
  /** Exact actions, or prefixes ending in `*` ("invoices.*,invoice.*"). */
  action: textList(200, 30),
  /** `YYYY-MM-DD` (IST), inclusive. */
  from: listFilter.date(),
  to: listFilter.date(),
  format: z.enum(["json", "csv"]).default("json"),
};

/**
 * `GET /v1/audit` query (docs/CONVENTIONS.md → "Lists and tables"):
 * `?q=&sort=-time&actorUserId=<uuid>,<uuid>&action=invoices.*,invoice.*&entityType=invoices,orders&entityId=&from=&to=`.
 * `limit` defaults to 50; JSON pages are clamped to MAX_LIST, CSV to MAX_CSV (so `limit=500` still works).
 */
export const auditListQuerySchema = listQuerySchema({ defaultLimit: 50, maxLimit: MAX_CSV })
  .extend(auditFilterShape)
  .superRefine(rangeOrder("from", "to"));
export type AuditQuery = z.input<typeof auditListQuerySchema>;
export type AuditListParams = z.output<typeof auditListQuerySchema>;

/** `GET /v1/audit/platform`: the same plus `tenantId`. */
export const auditPlatformQuerySchema = listQuerySchema({ defaultLimit: 50, maxLimit: MAX_CSV })
  .extend({ ...auditFilterShape, tenantId: listFilter.id() })
  .superRefine(rangeOrder("from", "to"));
export type AuditPlatformQuery = z.input<typeof auditPlatformQuerySchema>;

/** Sort: newest first by default; `id` keeps equal timestamps in a stable order across pages. */
export const AUDIT_SORT = defineSort({ time: auditEvents.createdAt }, { default: "-time", tieBreaker: auditEvents.id });

export interface AuditListPage extends ListPage<AuditEventRow> {
  /** True when more than MAX_COUNT events match (`total` is then MAX_COUNT). */
  totalCapped: boolean;
}

const clip = (s: string | null | undefined, max: number) => (s ? s.slice(0, max) : null);
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export class AuditService implements AuditPort {
  private readonly db: Db;

  constructor(private readonly deps: AuditDeps) {
    this.db = deps.db;
  }

  /**
   * Appends an event (tenant null = platform event, only listed by `listPlatform`). Never throws: failures are logged
   * so the caller's request is unaffected.
   */
  async record(e: AuditEvent): Promise<void> {
    try {
      await this.db.insert(auditEvents).values({
        tenantId: e.tenantId || null,
        actorUserId: e.actorUserId,
        action: e.action.slice(0, 200),
        entityType: e.entityType.slice(0, 100),
        entityId: e.entityId ? String(e.entityId).slice(0, 200) : null,
        summary: clip(e.summary, MAX_SUMMARY),
        before: e.before ?? null,
        after: e.after ?? null,
        ip: clip(e.ip, 100),
        userAgent: clip(e.userAgent, MAX_USER_AGENT),
      });
    } catch (err) {
      this.deps.log?.error({ err, tenantId: e.tenantId, action: e.action }, "audit: record failed");
    }
  }

  /** Tenant audit log, sorted by AUDIT_SORT (newest first by default). Bad params → ZodError, unknown sort → 400. */
  list(tenantId: string, q: AuditQuery = {}, maxLimit = MAX_LIST): Promise<AuditListPage> {
    const p = auditListQuerySchema.parse(q);
    return this.query(and(eq(auditEvents.tenantId, tenantId), ...auditConditions(p)), p, maxLimit);
  }

  /** Super-admin: across tenants incl. platform events (tenant null), or one tenant's. */
  listPlatform(q: AuditPlatformQuery = {}, maxLimit = MAX_LIST): Promise<AuditListPage> {
    const p = auditPlatformQuerySchema.parse(q);
    return this.query(and(...(p.tenantId ? [eq(auditEvents.tenantId, p.tenantId)] : []), ...auditConditions(p)), p, maxLimit);
  }

  /**
   * One page plus a capped count. The log can hold millions of rows, so the count reads at most MAX_COUNT + 1 matches
   * (`count(*) from (select 1 … limit 10001)`) instead of every one.
   */
  private async query(where: SQL | undefined, p: AuditListParams, maxLimit: number): Promise<AuditListPage> {
    const order = AUDIT_SORT.orderBy(p.sort);
    const limit = Math.min(p.limit, maxLimit);
    const offset = p.offset;
    const [items, counted] = await Promise.all([
      this.db.select().from(auditEvents).where(where).orderBy(...order).limit(limit).offset(offset),
      this.db.select({ n: count() }).from(cappedMatches(this.db, where)),
    ]);
    const n = Number(counted[0]?.n ?? 0);
    return { items, total: Math.min(n, MAX_COUNT), totalCapped: n > MAX_COUNT, limit, offset };
  }

  /** Retention: deletes events older than `olderThanDays` (default 400). Returns the number deleted. */
  async purge(olderThanDays = 400, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - olderThanDays * 86_400_000);
    const rows = await this.db.delete(auditEvents).where(lt(auditEvents.createdAt, cutoff)).returning({ id: auditEvents.id });
    this.deps.log?.info({ deleted: rows.length, cutoff }, "audit: purge");
    return rows.length;
  }
}

/** `select 1 from audit_events where … limit MAX_COUNT + 1`, the subquery of the capped count. */
export function cappedMatches(db: Db, where: SQL | undefined) {
  return db
    .select({ one: sql<number>`1`.as("one") })
    .from(auditEvents)
    .where(where)
    .limit(MAX_COUNT + 1)
    .as("matches");
}

/** One `action` item: exact, or a prefix when it ends with `*` ("invoice.*"). */
const actionCondition = (a: string): SQL =>
  a.endsWith("*") ? like(auditEvents.action, `${escapeLike(a.slice(0, -1))}%`) : eq(auditEvents.action, a);

type FilterParams = Pick<AuditListParams, "q" | "entityType" | "entityId" | "actorUserId" | "action" | "from" | "to">;

/** The list's filter conditions (tenant scoping is added by the caller). */
export function auditConditions(p: FilterParams): SQL[] {
  const out: (SQL | undefined)[] = [];
  if (p.entityType?.length) out.push(p.entityType.length === 1 ? eq(auditEvents.entityType, p.entityType[0]!) : inArray(auditEvents.entityType, p.entityType));
  if (p.entityId) out.push(eq(auditEvents.entityId, p.entityId));
  if (p.actorUserId?.length) out.push(p.actorUserId.length === 1 ? eq(auditEvents.actorUserId, p.actorUserId[0]!) : inArray(auditEvents.actorUserId, p.actorUserId));
  if (p.action?.length) out.push(p.action.length === 1 ? actionCondition(p.action[0]!) : or(...p.action.map(actionCondition)));
  if (p.from) out.push(gte(auditEvents.createdAt, istDayStart(p.from)));
  if (p.to) out.push(lt(auditEvents.createdAt, istDayEnd(p.to)));
  out.push(searchAny(p.q, [auditEvents.summary, auditEvents.action, auditEvents.entityId]));
  return out.filter((c): c is SQL => !!c);
}

/** Filter conditions from a raw query (all optional). */
export function filters(q: AuditQuery): SQL[] {
  return auditConditions(auditListQuerySchema.parse(q));
}

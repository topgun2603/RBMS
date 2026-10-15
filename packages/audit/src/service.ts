import type { AuditEvent, AuditPort } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, count, desc, eq, gte, like, lt, type SQL } from "drizzle-orm";
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

export interface AuditQuery {
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  /** Exact action, or a prefix when it ends with `*` ("invoice.*"). */
  action?: string;
  /** `YYYY-MM-DD` (IST), inclusive. */
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** Most rows a single list/CSV call returns. */
export const MAX_LIST = 200;
export const MAX_CSV = 10_000;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const clip = (s: string | null | undefined, max: number) => (s ? s.slice(0, max) : null);

export class AuditService implements AuditPort {
  private readonly db: Db;

  constructor(private readonly deps: AuditDeps) {
    this.db = deps.db;
  }

  /** Appends an event. Never throws: failures are logged so the caller's request is unaffected. */
  async record(e: AuditEvent): Promise<void> {
    try {
      if (!e.tenantId) throw new Error("audit event without tenantId");
      await this.db.insert(auditEvents).values({
        tenantId: e.tenantId,
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

  /** Tenant audit log, newest first. */
  list(tenantId: string, q: AuditQuery = {}, maxLimit = MAX_LIST) {
    return this.query(and(eq(auditEvents.tenantId, tenantId), ...filters(q)), q, maxLimit);
  }

  /** Super-admin: across tenants (optionally one). */
  listPlatform(q: AuditQuery & { tenantId?: string } = {}, maxLimit = MAX_LIST) {
    return this.query(and(...(q.tenantId ? [eq(auditEvents.tenantId, q.tenantId)] : []), ...filters(q)), q, maxLimit);
  }

  private async query(where: SQL | undefined, q: AuditQuery, maxLimit: number): Promise<{ items: AuditEventRow[]; total: number }> {
    const limit = Math.min(Math.max(q.limit ?? 50, 1), maxLimit);
    const offset = Math.max(q.offset ?? 0, 0);
    const [items, totals] = await Promise.all([
      this.db.select().from(auditEvents).where(where).orderBy(desc(auditEvents.createdAt)).limit(limit).offset(offset),
      this.db.select({ n: count() }).from(auditEvents).where(where),
    ]);
    return { items, total: totals[0]?.n ?? 0 };
  }

  /** Retention: deletes events older than `olderThanDays` (default 400). Returns the number deleted. */
  async purge(olderThanDays = 400, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - olderThanDays * 86_400_000);
    const rows = await this.db.delete(auditEvents).where(lt(auditEvents.createdAt, cutoff)).returning({ id: auditEvents.id });
    this.deps.log?.info({ deleted: rows.length, cutoff }, "audit: purge");
    return rows.length;
  }
}

/** Query filters as SQL conditions (all optional). */
export function filters(q: AuditQuery): SQL[] {
  const out: SQL[] = [];
  if (q.entityType) out.push(eq(auditEvents.entityType, q.entityType));
  if (q.entityId) out.push(eq(auditEvents.entityId, q.entityId));
  if (q.actorUserId) out.push(eq(auditEvents.actorUserId, q.actorUserId));
  if (q.action) {
    out.push(
      q.action.endsWith("*") ? like(auditEvents.action, `${escapeLike(q.action.slice(0, -1))}%`) : eq(auditEvents.action, q.action),
    );
  }
  if (q.from) out.push(gte(auditEvents.createdAt, istDayStart(q.from)));
  if (q.to) out.push(lt(auditEvents.createdAt, istDayEnd(q.to)));
  return out;
}

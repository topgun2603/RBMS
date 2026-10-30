import { addDays, badRequest, conflict, facetCounts, notFound, runList, type ListPage } from "@rbms/core";
import type { Db } from "@rbms/db";
import { and, count, desc, eq, inArray, isNotNull, isNull, lt, lte, or, type SQL } from "drizzle-orm";
import { DATA_REQUEST_SORT, dataRequestListConditions, dataRequestListQuerySchema, type DataRequestListQuery } from "./list";
import { latestByPurpose, runErasers, runExporters, type ConsentDecision } from "./logic";
import type { DataEraser, DataExporter, LoggerPort, QueuePort } from "./ports";
import {
  consentRecords,
  dataRequests,
  type ConsentSource,
  type DataRequestRow,
  type DataRequestStatus,
  type DataRequestType,
} from "./schema";

export interface ConsentConfig {
  /** Days between a deletion request and the actual erasure (user can cancel meanwhile). Default 7. */
  deletionGraceDays?: number;
  /** Days an export payload is kept before it is cleared. Default 7. */
  exportRetentionDays?: number;
}

export interface ConsentDeps {
  db: Db;
  config?: ConsentConfig;
  queue?: QueuePort;
  log?: LoggerPort;
}

export interface DataRequestView {
  id: string;
  userId: string;
  tenantId: string | null;
  type: DataRequestType;
  status: DataRequestStatus;
  scheduledFor: Date;
  completedAt: Date | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const PROCESS_JOB = "consent.process";
export const SWEEP_JOB = "consent.sweep";

const toView = (r: DataRequestRow): DataRequestView => ({
  id: r.id,
  userId: r.userId,
  tenantId: r.tenantId,
  type: r.type,
  status: r.status,
  scheduledFor: r.scheduledFor,
  completedAt: r.completedAt,
  error: r.error,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const OPEN: DataRequestStatus[] = ["pending", "processing"];
const isUniqueViolation = (err: unknown) =>
  (err as { code?: string } | null)?.code === "23505" ||
  (err as { cause?: { code?: string } } | null)?.cause?.code === "23505";
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 2000);

export class ConsentService {
  private readonly db: Db;
  private readonly graceDays: number;
  private readonly retentionDays: number;
  private readonly exporters = new Map<string, DataExporter>();
  private readonly erasers = new Map<string, DataEraser>();

  constructor(private readonly deps: ConsentDeps) {
    this.db = deps.db;
    this.graceDays = deps.config?.deletionGraceDays ?? 7;
    this.retentionDays = deps.config?.exportRetentionDays ?? 7;
    if (deps.queue) {
      deps.queue.define(PROCESS_JOB, async (data: { requestId: string }) => {
        await this.processRequest(data.requestId);
      });
      deps.queue.define(SWEEP_JOB, async () => {
        await this.sweep(new Date());
      });
    }
  }

  // ---------------------------------------------------------------- registry

  /** Registers a module's exporter. apps/api registers auth first, then the others. */
  registerExporter(moduleId: string, fn: DataExporter) {
    this.exporters.set(moduleId, fn);
  }

  /** Registers a module's eraser. Erasers run in reverse registration order, so register auth first. */
  registerEraser(moduleId: string, fn: DataEraser) {
    this.erasers.set(moduleId, fn);
  }

  /** The recurring job apps/api should schedule via the jobs module (only meaningful with a queue). */
  scheduleSweep(): { name: string; cron: string } {
    return { name: SWEEP_JOB, cron: "0 * * * *" };
  }

  // ---------------------------------------------------------------- consent records

  async record(input: {
    userId?: string | null;
    anonymousId?: string | null;
    tenantId?: string | null;
    purposes: Record<string, boolean>;
    version: string;
    source: ConsentSource;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<{ recorded: number }> {
    if (!input.userId && !input.anonymousId) throw badRequest("A signed-in user or anonymousId is required");
    const entries = Object.entries(input.purposes);
    if (entries.length === 0) throw badRequest("No purposes given");
    await this.db.insert(consentRecords).values(
      entries.map(([purpose, granted]) => ({
        userId: input.userId ?? null,
        anonymousId: input.userId ? (input.anonymousId ?? null) : input.anonymousId!,
        tenantId: input.tenantId ?? null,
        purpose,
        version: input.version,
        granted,
        source: input.source,
        ip: input.ip ?? null,
        userAgent: input.userAgent ? input.userAgent.slice(0, 512) : null,
      })),
    );
    return { recorded: entries.length };
  }

  /**
   * Latest decision per purpose. With `tenantId`, considers platform-wide records plus that
   * tenant's; without, considers all of the user's records.
   */
  async current(userId: string, tenantId?: string | null): Promise<Record<string, ConsentDecision>> {
    const rows = await this.db
      .select()
      .from(consentRecords)
      .where(and(eq(consentRecords.userId, userId), this.tenantFilter(tenantId)))
      .orderBy(consentRecords.createdAt);
    return latestByPurpose(rows);
  }

  async history(userId: string, limit = 500) {
    const rows = await this.db
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.userId, userId))
      .orderBy(desc(consentRecords.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      purpose: r.purpose,
      version: r.version,
      granted: r.granted,
      source: r.source,
      createdAt: r.createdAt,
    }));
  }

  /** Attaches pre-signup consent given under `anonymousId` to the user. Returns rows linked. */
  async linkAnonymous(anonymousId: string, userId: string): Promise<number> {
    const res = await this.db
      .update(consentRecords)
      .set({ userId })
      .where(and(eq(consentRecords.anonymousId, anonymousId), isNull(consentRecords.userId)))
      .returning({ id: consentRecords.id });
    return res.length;
  }

  async hasConsent(userId: string, purpose: string, tenantId?: string | null): Promise<boolean> {
    const [row] = await this.db
      .select({ granted: consentRecords.granted })
      .from(consentRecords)
      .where(and(eq(consentRecords.userId, userId), eq(consentRecords.purpose, purpose), this.tenantFilter(tenantId)))
      .orderBy(desc(consentRecords.createdAt))
      .limit(1);
    return row?.granted ?? false;
  }

  // ---------------------------------------------------------------- data requests

  async requestExport(userId: string, tenantId?: string | null): Promise<DataRequestView> {
    const [open] = await this.db
      .select({ id: dataRequests.id })
      .from(dataRequests)
      .where(and(eq(dataRequests.userId, userId), eq(dataRequests.type, "export"), inArray(dataRequests.status, OPEN)))
      .limit(1);
    if (open) throw conflict("An export is already in progress");
    let row: DataRequestRow | undefined;
    try {
      [row] = await this.db
        .insert(dataRequests)
        .values({ userId, tenantId: tenantId ?? null, type: "export", status: "pending", scheduledFor: new Date() })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("An export is already in progress");
      throw err;
    }
    if (!row) throw new Error("consent: failed to create export request");
    if (this.deps.queue) {
      await this.deps.queue.enqueue(PROCESS_JOB, { requestId: row.id });
      return toView(row);
    }
    await this.processRequest(row.id);
    return toView((await this.getRow(row.id)) ?? row);
  }

  /** The user's own export request, with its payload once completed. */
  async getExport(userId: string, id: string): Promise<DataRequestView & { result: unknown }> {
    const row = await this.getRow(id);
    if (!row || row.userId !== userId || row.type !== "export") throw notFound("Export");
    return { ...toView(row), result: row.status === "completed" ? row.result : null };
  }

  /** Schedules account deletion after the grace period. Idempotent: returns an existing open request. */
  async requestDeletion(userId: string, tenantId?: string | null): Promise<DataRequestView> {
    const existing = await this.openDeletion(userId);
    if (existing) return toView(existing);
    try {
      const [row] = await this.db
        .insert(dataRequests)
        .values({
          userId,
          tenantId: tenantId ?? null,
          type: "delete",
          status: "pending",
          scheduledFor: addDays(new Date(), this.graceDays),
        })
        .returning();
      this.deps.log?.info({ userId, requestId: row!.id }, "consent: account deletion scheduled");
      return toView(row!);
    } catch (err) {
      if (isUniqueViolation(err)) {
        const again = await this.openDeletion(userId);
        if (again) return toView(again);
      }
      throw err;
    }
  }

  /** Cancels a pending (not yet started) deletion. */
  async cancelDeletion(userId: string): Promise<DataRequestView> {
    const [row] = await this.db
      .update(dataRequests)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(
        and(
          eq(dataRequests.userId, userId),
          eq(dataRequests.type, "delete"),
          inArray(dataRequests.status, ["pending", "failed"]),
        ),
      )
      .returning();
    if (!row) throw notFound("Pending deletion request");
    this.deps.log?.info({ userId, requestId: row.id }, "consent: account deletion cancelled");
    return toView(row);
  }

  /** Open (pending/processing/failed) requests of the user. */
  async pendingRequests(userId: string): Promise<DataRequestView[]> {
    const rows = await this.db
      .select()
      .from(dataRequests)
      .where(and(eq(dataRequests.userId, userId), inArray(dataRequests.status, [...OPEN, "failed"])))
      .orderBy(desc(dataRequests.createdAt));
    return rows.map(toView);
  }

  /**
   * Processes one request: an export runs immediately, a deletion only once it is due.
   * Called inline, by the "consent.process" job, and by `processDue`.
   */
  async processRequest(id: string, now: Date = new Date()): Promise<DataRequestStatus | null> {
    const [row] = await this.db
      .update(dataRequests)
      .set({ status: "processing", error: null })
      .where(
        and(
          eq(dataRequests.id, id),
          inArray(dataRequests.status, ["pending", "failed"]),
          lte(dataRequests.scheduledFor, now),
        ),
      )
      .returning();
    if (!row) return null; // already taken, cancelled, finished or not due

    try {
      if (row.type === "export") {
        const result = await runExporters(this.exporters, row.userId, now, (moduleId, err) =>
          this.deps.log?.error({ err, moduleId, requestId: row.id }, "consent: exporter failed"),
        );
        await this.db
          .update(dataRequests)
          .set({ status: "completed", result, completedAt: new Date() })
          .where(eq(dataRequests.id, row.id));
      } else {
        await runErasers([...this.erasers], row.userId);
        await this.anonymiseUser(row.userId);
        await this.db
          .update(dataRequests)
          .set({ status: "completed", completedAt: new Date() })
          .where(eq(dataRequests.id, row.id));
        this.deps.log?.info({ requestId: row.id }, "consent: account erased");
      }
      return "completed";
    } catch (err) {
      this.deps.log?.error({ err, requestId: row.id, type: row.type }, "consent: request failed");
      await this.db
        .update(dataRequests)
        .set({ status: "failed", error: errorMessage(err) })
        .where(eq(dataRequests.id, row.id));
      return "failed";
    }
  }

  /** Runs every due deletion (pending or previously failed). */
  async processDue(now: Date = new Date(), batch = 50): Promise<{ processed: number; failed: number }> {
    const due = await this.db
      .select({ id: dataRequests.id })
      .from(dataRequests)
      .where(
        and(
          eq(dataRequests.type, "delete"),
          inArray(dataRequests.status, ["pending", "failed"]),
          lte(dataRequests.scheduledFor, now),
        ),
      )
      .orderBy(dataRequests.scheduledFor)
      .limit(batch);
    let processed = 0;
    let failed = 0;
    for (const { id } of due) {
      const status = await this.processRequest(id, now);
      if (status === "completed") processed++;
      else if (status === "failed") failed++;
    }
    return { processed, failed };
  }

  /** Clears export payloads older than the retention period. Returns how many were cleared. */
  async purgeExpiredExports(now: Date = new Date()): Promise<number> {
    const cutoff = addDays(now, -this.retentionDays);
    const res = await this.db
      .update(dataRequests)
      .set({ result: null })
      .where(
        and(
          eq(dataRequests.type, "export"),
          isNotNull(dataRequests.result),
          or(lt(dataRequests.completedAt, cutoff), and(isNull(dataRequests.completedAt), lt(dataRequests.createdAt, cutoff))),
        ),
      )
      .returning({ id: dataRequests.id });
    return res.length;
  }

  /** What the "consent.sweep" job runs: due deletions plus export purge. */
  async sweep(now: Date = new Date()) {
    const deletions = await this.processDue(now);
    const purgedExports = await this.purgeExpiredExports(now);
    return { ...deletions, purgedExports };
  }

  /** Super-admin list: filters status / type, `q` on the user or request id, sort, facet counts. See ./list.ts. */
  async listRequests(query: DataRequestListQuery = {}): Promise<ListPage<DataRequestView> & { facets: Record<string, Record<string, number>> }> {
    const p = dataRequestListQuerySchema.parse(query);
    const where = dataRequestListConditions(p);
    const [page, byStatus, byType] = await Promise.all([
      runList(p, {
        rows: () => this.db.select().from(dataRequests).where(where).orderBy(...DATA_REQUEST_SORT.orderBy(p.sort)).limit(p.limit).offset(p.offset),
        count: () => this.db.select({ total: count() }).from(dataRequests).where(where),
        map: toView,
      }),
      this.db.select({ key: dataRequests.status, n: count() }).from(dataRequests).where(dataRequestListConditions(p, "status")).groupBy(dataRequests.status),
      this.db.select({ key: dataRequests.type, n: count() }).from(dataRequests).where(dataRequestListConditions(p, "type")).groupBy(dataRequests.type),
    ]);
    return { ...page, facets: { status: facetCounts(byStatus), type: facetCounts(byType) } };
  }

  // ---------------------------------------------------------------- internals

  /** Keeps consent decisions as a legal record but unlinks them from the person. Also drops old export payloads. */
  private async anonymiseUser(userId: string) {
    await this.db
      .update(consentRecords)
      .set({ userId: null, anonymousId: null, ip: null, userAgent: null })
      .where(eq(consentRecords.userId, userId));
    await this.db
      .update(dataRequests)
      .set({ result: null })
      .where(and(eq(dataRequests.userId, userId), eq(dataRequests.type, "export")));
  }

  private tenantFilter(tenantId?: string | null): SQL | undefined {
    if (!tenantId) return undefined;
    return or(isNull(consentRecords.tenantId), eq(consentRecords.tenantId, tenantId));
  }

  private async getRow(id: string) {
    const [row] = await this.db.select().from(dataRequests).where(eq(dataRequests.id, id)).limit(1);
    return row;
  }

  private async openDeletion(userId: string) {
    const [row] = await this.db
      .select()
      .from(dataRequests)
      .where(
        and(
          eq(dataRequests.userId, userId),
          eq(dataRequests.type, "delete"),
          inArray(dataRequests.status, [...OPEN, "failed"]),
        ),
      )
      .limit(1);
    return row;
  }
}

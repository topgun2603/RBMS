import { badRequest, tooMany } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import {
  addDaysISO,
  DailySalt,
  hostOfUrl,
  ingestSchema,
  istDate,
  istDayStart,
  RateLimiter,
  rollupDates,
  toEventRows,
} from "./ingest";
import { assembleOverview, withProductNames, type DatedMetricRow, type Overview } from "./overview";
import type { AnalyticsConfig, CatalogPort, LoggerPort } from "./ports";
import { aggregateDay, type RollupEvent } from "./rollup";
import { analyticsDaily, analyticsEvents, type NewAnalyticsEvent } from "./schema";
import { isBot } from "./ua";

export interface AnalyticsDeps {
  db: Db;
  config: AnalyticsConfig;
  /** Product names for the overview. Without it names are empty. */
  catalog?: CatalogPort;
  log?: LoggerPort;
  now?: () => Date;
}

export interface IngestRequest {
  ip: string | null;
  userAgent: string | null;
  /** Request host (the shop's own host). */
  host: string | null;
  /** Origin or Referer header of the ingest call (the page's origin). */
  origin?: string | null;
}

/** Longest overview period. */
export const MAX_OVERVIEW_DAYS = 366;
const INSERT_CHUNK = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class AnalyticsService {
  private readonly db: Db;
  private readonly salt: DailySalt;
  private readonly limiter: RateLimiter;
  private readonly now: () => Date;
  private buffer: NewAnalyticsEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> = Promise.resolve();

  constructor(private readonly deps: AnalyticsDeps) {
    this.db = deps.db;
    this.salt = new DailySalt(deps.config.ipSaltSecret);
    this.limiter = new RateLimiter(deps.config.rateLimitPerMinute ?? 120, 60_000);
    this.now = deps.now ?? (() => new Date());
  }

  // ---------------------------------------------------------------- ingest

  /**
   * Validates and queues storefront events. Bots are accepted silently (0 stored). Throws 429 over the per-IP limit and
   * 400 (ZodError) for a bad body.
   */
  async ingest(tenantId: string, body: unknown, req: IngestRequest): Promise<{ accepted: number }> {
    const now = this.now();
    if (!this.limiter.hit(req.ip ?? "unknown", now.getTime())) throw tooMany("Too many analytics calls");
    const input = ingestSchema.parse(body);
    if (isBot(req.userAgent)) return { accepted: 0 };
    const rows = toEventRows(tenantId, input, {
      userAgent: req.userAgent,
      ipHash: this.salt.hashIp(req.ip, now),
      selfHosts: [req.host, hostOfUrl(req.origin)],
      now,
    });
    this.enqueue(rows);
    return { accepted: rows.length };
  }

  private enqueue(rows: NewAnalyticsEvent[]) {
    this.buffer.push(...rows);
    const flushMs = this.deps.config.flushMs ?? 2000;
    if (flushMs <= 0 || this.buffer.length >= (this.deps.config.maxBatch ?? 500)) {
      void this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), flushMs);
      (this.timer as { unref?: () => void }).unref?.();
    }
  }

  /** Writes buffered events (also called on module stop). Insert errors are logged and the batch is dropped. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = this.buffer;
    this.buffer = [];
    this.flushing = this.flushing.then(async () => {
      for (let i = 0; i < batch.length; i += INSERT_CHUNK) {
        try {
          await this.db.insert(analyticsEvents).values(batch.slice(i, i + INSERT_CHUNK));
        } catch (err) {
          this.deps.log?.error({ err, count: Math.min(INSERT_CHUNK, batch.length - i) }, "analytics insert failed");
        }
      }
    });
    return this.flushing;
  }

  // ---------------------------------------------------------------- rollup + purge

  private async dayEvents(tenantId: string, date: string): Promise<RollupEvent[]> {
    const start = istDayStart(date);
    const end = istDayStart(addDaysISO(date, 1));
    return this.db
      .select({
        at: analyticsEvents.at,
        type: analyticsEvents.type,
        sessionId: analyticsEvents.sessionId,
        anonymousId: analyticsEvents.anonymousId,
        productId: analyticsEvents.productId,
        value: analyticsEvents.value,
        query: analyticsEvents.query,
        referrerHost: analyticsEvents.referrerHost,
        utmSource: analyticsEvents.utmSource,
        device: analyticsEvents.device,
      })
      .from(analyticsEvents)
      .where(and(eq(analyticsEvents.tenantId, tenantId), gte(analyticsEvents.at, start), lt(analyticsEvents.at, end)))
      .orderBy(asc(analyticsEvents.at));
  }

  /** Recomputes one tenant's rollup for one IST date (replaces that day's rows). */
  async rollupDay(tenantId: string, date: string): Promise<number> {
    const rows = aggregateDay(await this.dayEvents(tenantId, date));
    await this.db.transaction(async (tx) => {
      await tx.delete(analyticsDaily).where(and(eq(analyticsDaily.tenantId, tenantId), eq(analyticsDaily.date, date)));
      for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
        await tx
          .insert(analyticsDaily)
          .values(rows.slice(i, i + INSERT_CHUNK).map((r) => ({ tenantId, date, ...r })))
          .onConflictDoUpdate({
            target: [analyticsDaily.tenantId, analyticsDaily.date, analyticsDaily.metric, analyticsDaily.dimension],
            set: { value: sql`excluded.value`, updatedAt: sql`now()` },
          });
      }
    });
    return rows.length;
  }

  /**
   * Job `analytics.rollup` (hourly): flushes the buffer, then recomputes today and yesterday (IST) for every tenant with
   * events on that day. Idempotent. `days` widens the window for a backfill (e.g. 90 = every day raw events are kept;
   * at most the retention), recomputing each day from the raw events.
   */
  async rollup(opts: { now?: Date; tenantId?: string; days?: number } = {}): Promise<{ dates: string[]; tenants: number; rows: number }> {
    await this.flush();
    const today = istDate(opts.now ?? this.now());
    const dates = rollupDates(today, opts.days ?? 2, this.deps.config.retentionDays ?? 90);
    const tenants = new Set<string>();
    let rowCount = 0;
    for (const date of dates) {
      const ids = opts.tenantId
        ? [opts.tenantId]
        : (
            await this.db
              .selectDistinct({ tenantId: analyticsEvents.tenantId })
              .from(analyticsEvents)
              .where(and(gte(analyticsEvents.at, istDayStart(date)), lt(analyticsEvents.at, istDayStart(addDaysISO(date, 1)))))
          ).map((r) => r.tenantId);
      for (const id of ids) {
        try {
          rowCount += await this.rollupDay(id, date);
          tenants.add(id);
        } catch (err) {
          this.deps.log?.error({ err, tenantId: id, date }, "analytics rollup failed");
        }
      }
    }
    return { dates, tenants: tenants.size, rows: rowCount };
  }

  /** Deletes raw events older than the retention (default 90 days). Rollups are kept. */
  async purge(opts: { now?: Date } = {}): Promise<{ deleted: number }> {
    const days = this.deps.config.retentionDays ?? 90;
    const cutoff = new Date((opts.now ?? this.now()).getTime() - days * 86_400_000);
    const rows = await this.db
      .delete(analyticsEvents)
      .where(lt(analyticsEvents.at, cutoff))
      .returning({ id: analyticsEvents.id });
    return { deleted: rows.length };
  }

  // ---------------------------------------------------------------- overview

  /** Full days from analytics_daily; today (IST) computed from raw events. Default period: the last 30 days. */
  async overview(tenantId: string, q: { from?: string; to?: string } = {}): Promise<Overview> {
    const today = istDate(this.now());
    const to = q.to ?? today;
    const from = q.from ?? addDaysISO(to, -29);
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) throw badRequest("Dates must be YYYY-MM-DD");
    if (to < from) throw badRequest("'to' must be on or after 'from'");
    if (Date.parse(to) - Date.parse(from) > MAX_OVERVIEW_DAYS * 86_400_000) throw badRequest("At most one year");

    const lastFull = to < today ? to : addDaysISO(today, -1);
    const rows: DatedMetricRow[] =
      from <= lastFull
        ? await this.db
            .select({
              date: analyticsDaily.date,
              metric: analyticsDaily.metric,
              dimension: analyticsDaily.dimension,
              value: analyticsDaily.value,
            })
            .from(analyticsDaily)
            .where(
              and(eq(analyticsDaily.tenantId, tenantId), gte(analyticsDaily.date, from), sql`${analyticsDaily.date} <= ${lastFull}`),
            )
            .orderBy(asc(analyticsDaily.date))
        : [];
    if (from <= today && to >= today) {
      for (const r of aggregateDay(await this.dayEvents(tenantId, today))) rows.push({ date: today, ...r });
    }

    const overview = assembleOverview(from, to, rows);
    const ids = overview.topProducts.map((p) => p.productId);
    if (!ids.length || !this.deps.catalog) return overview;
    try {
      return withProductNames(overview, await this.deps.catalog.names(tenantId, ids));
    } catch (err) {
      this.deps.log?.warn({ err, tenantId }, "analytics: product names failed");
      return overview;
    }
  }
}

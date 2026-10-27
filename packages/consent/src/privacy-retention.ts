import { addDays, type AuditPort } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { PrivacyHostPort, RetentionCategory } from "./privacy-ports";
import type { PrivacySettings } from "./privacy-settings";
import { privacyRetentionRuns, type PrivacyRetentionRunRow } from "./schema";
import type { LoggerPort } from "./ports";

export interface EffectiveRetention {
  key: string;
  scope: "shop" | "platform";
  action: "delete" | "anonymise";
  enabled: boolean;
  days: number;
  defaultDays: number;
  minDays: number;
  /** Another job already does this; the fixed period it uses. */
  managedBy: { job: string; days: number } | null;
}

export interface RetentionPreviewItem extends EffectiveRetention {
  cutoff: string | null;
  /** Rows that would be purged now; null for a category another job manages. */
  affected: number | null;
  error?: string;
}

/** A category's effective settings: enabled unless switched off, days from the settings but never below the legal floor. */
export function effectiveRetention(cat: RetentionCategory, settings: Pick<PrivacySettings, "retention">): EffectiveRetention {
  const own = settings.retention?.[cat.key];
  const days = Math.max(cat.minDays, own?.days ?? cat.defaultDays);
  return {
    key: cat.key,
    scope: cat.scope,
    action: cat.action,
    enabled: cat.managedBy ? true : (own?.enabled ?? true),
    days: cat.managedBy ? cat.managedBy.days : days,
    defaultDays: cat.defaultDays,
    minDays: cat.minDays,
    managedBy: cat.managedBy ?? null,
  };
}

/** The instant before which data is past its retention period. */
export const retentionCutoff = (now: Date, days: number) => addDays(now, -days);

export interface RetentionDeps {
  db: Db;
  host: PrivacyHostPort;
  audit?: AuditPort;
  log?: LoggerPort;
}

/**
 * Scheduled purge / anonymise per data category, with a dry-run preview. Categories are registered by the host
 * (each knows its own tables); this service applies the per-shop days, logs every run and never throws for one category.
 */
export class RetentionService {
  private readonly categories = new Map<string, RetentionCategory>();

  constructor(private readonly deps: RetentionDeps) {}

  register(category: RetentionCategory) {
    this.categories.set(category.key, category);
  }

  list(scope?: "shop" | "platform"): RetentionCategory[] {
    return [...this.categories.values()].filter((c) => !scope || c.scope === scope);
  }

  /** Days in force per category, for a shop (shop-scope categories) or the platform (`tenantId` null: platform-scope ones). */
  async effective(tenantId: string | null): Promise<EffectiveRetention[]> {
    const settings = await this.deps.host.settings(tenantId);
    return this.list(tenantId ? "shop" : "platform").map((c) => effectiveRetention(c, settings));
  }

  /** What a run would do right now. Counts only; nothing changes. Each preview is logged as a dry run. */
  async preview(tenantId: string | null, now: Date = new Date()): Promise<RetentionPreviewItem[]> {
    const out: RetentionPreviewItem[] = [];
    const settings = await this.deps.host.settings(tenantId);
    for (const cat of this.list(tenantId ? "shop" : "platform")) {
      const eff = effectiveRetention(cat, settings);
      if (cat.managedBy || !cat.count) {
        out.push({ ...eff, cutoff: null, affected: null });
        continue;
      }
      if (!eff.enabled) {
        out.push({ ...eff, cutoff: null, affected: 0 });
        continue;
      }
      const cutoff = retentionCutoff(now, eff.days);
      try {
        const affected = await cat.count({ tenantId }, cutoff);
        await this.log(tenantId, cat.key, true, cutoff, eff.days, affected, "ok", null, "manual");
        out.push({ ...eff, cutoff: cutoff.toISOString(), affected });
      } catch (err) {
        const error = errorText(err);
        await this.log(tenantId, cat.key, true, cutoff, eff.days, 0, "failed", error, "manual");
        out.push({ ...eff, cutoff: cutoff.toISOString(), affected: null, error });
      }
    }
    return out;
  }

  /** Runs every enabled category of one scope. A failing category is logged and the others still run. */
  async run(tenantId: string | null, trigger: "job" | "manual", now: Date = new Date()): Promise<RetentionPreviewItem[]> {
    const out: RetentionPreviewItem[] = [];
    const settings = await this.deps.host.settings(tenantId);
    for (const cat of this.list(tenantId ? "shop" : "platform")) {
      const eff = effectiveRetention(cat, settings);
      if (cat.managedBy || !cat.purge || !eff.enabled) {
        out.push({ ...eff, cutoff: null, affected: cat.managedBy ? null : 0 });
        continue;
      }
      const cutoff = retentionCutoff(now, eff.days);
      try {
        const affected = await cat.purge({ tenantId }, cutoff);
        await this.log(tenantId, cat.key, false, cutoff, eff.days, affected, "ok", null, trigger);
        out.push({ ...eff, cutoff: cutoff.toISOString(), affected });
      } catch (err) {
        const error = errorText(err);
        this.deps.log?.error({ err, category: cat.key, tenantId }, "privacy: retention purge failed");
        await this.log(tenantId, cat.key, false, cutoff, eff.days, 0, "failed", error, trigger);
        out.push({ ...eff, cutoff: cutoff.toISOString(), affected: null, error });
      }
    }
    const purged = out.reduce((n, r) => n + (r.affected ?? 0), 0);
    if (purged > 0) {
      await this.deps.audit?.record({
        tenantId,
        actorUserId: null,
        action: "privacy.retention.run",
        entityType: "privacy_retention",
        summary: `Retention run (${trigger}): ${purged} rows purged or anonymised`,
      });
    }
    return out;
  }

  /** The scheduled job: the platform's categories once, then every shop's. */
  async runAll(now: Date = new Date()): Promise<{ shops: number; purged: number }> {
    let purged = 0;
    const platform = await this.run(null, "job", now);
    purged += platform.reduce((n, r) => n + (r.affected ?? 0), 0);
    const ids = await this.deps.host.tenantIds();
    for (const id of ids) {
      try {
        const res = await this.run(id, "job", now);
        purged += res.reduce((n, r) => n + (r.affected ?? 0), 0);
      } catch (err) {
        this.deps.log?.error({ err, tenantId: id }, "privacy: retention run failed for a shop");
      }
    }
    return { shops: ids.length, purged };
  }

  async recentRuns(tenantId: string | null, limit = 50): Promise<PrivacyRetentionRunRow[]> {
    return this.deps.db
      .select()
      .from(privacyRetentionRuns)
      .where(tenantId ? eq(privacyRetentionRuns.tenantId, tenantId) : isNull(privacyRetentionRuns.tenantId))
      .orderBy(desc(privacyRetentionRuns.createdAt))
      .limit(Math.min(limit, 200));
  }

  /** The latest real (not dry-run) run per category, for the settings screen. */
  async lastRunByCategory(tenantId: string | null): Promise<Record<string, { at: string; affected: number; status: string }>> {
    const rows = await this.deps.db
      .select()
      .from(privacyRetentionRuns)
      .where(and(tenantId ? eq(privacyRetentionRuns.tenantId, tenantId) : isNull(privacyRetentionRuns.tenantId), eq(privacyRetentionRuns.dryRun, false)))
      .orderBy(desc(privacyRetentionRuns.createdAt))
      .limit(300);
    const out: Record<string, { at: string; affected: number; status: string }> = {};
    for (const r of rows) out[r.category] ??= { at: r.createdAt.toISOString(), affected: r.affected, status: r.status };
    return out;
  }

  private async log(
    tenantId: string | null,
    category: string,
    dryRun: boolean,
    cutoff: Date,
    days: number,
    affected: number,
    status: "ok" | "failed",
    error: string | null,
    trigger: "job" | "manual",
  ) {
    await this.deps.db.insert(privacyRetentionRuns).values({ tenantId, category, dryRun, cutoff, days, affected, status, error, trigger });
  }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 500);

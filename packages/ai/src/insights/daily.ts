import { notFound } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { resolveDailySummary, dueNow, type DailySummarySettings } from "./daily-settings";
import { aiDailySummaries, type AiDailySummaryRow, type SummaryDelivery } from "./schema";
import { SUMMARY_FEATURE, whatsappText, writeSummary, type SummaryFacts, type SummaryLang, type SummaryResult, type SummaryText } from "./summary";
import type { AiRunner } from "../assist/hsn";

export const DAILY_JOB = "ai.daily-summary";
/** A "running" claim older than this is taken to be a crashed run and may be retried. */
const STALE_MS = 30 * 60_000;
const MAX_ATTEMPTS = 3;

/** AI errors where the shop should still get the (template) summary; the others mean the owner switched AI off. */
const TEMPLATE_OK = new Set(["ai_credits_exhausted", "ai_busy", "ai_failed", "ai_truncated", "ai_invalid_output", "ai_refused", "ai_unavailable"]);
const SWITCHED_OFF = new Set(["ai_off", "ai_feature_off", "ai_not_available", "ai_disabled"]);

export interface DailyPorts {
  /** The shop's numbers for one IST date (computed in code from its own tables). */
  facts(tenantId: string, date: string, now: Date): Promise<SummaryFacts>;
  shopName(tenantId: string): Promise<string>;
  /** The shop's `ai` settings: master switch, helper switches and the daily-summary block. */
  aiSettings(tenantId: string): Promise<{ enabled: boolean; features: Record<string, boolean>; dailySummary?: unknown }>;
  /** Shops that switched the daily summary on (the job only looks at these). */
  candidates(): Promise<string[]>;
  /** Sends the summary to the owner and chosen phones; never throws. The in-app copy is the stored row. */
  deliver(input: { tenantId: string; shop: string; date: string; text: SummaryText; whatsappText: string; language: SummaryLang; settings: DailySummarySettings }): Promise<Omit<SummaryDelivery, "inApp">>;
}

export interface DailyLog {
  info(o: object, m?: string): void;
  warn(o: object, m?: string): void;
}

export type RunOutcome =
  | { status: "ready"; summary: DailySummaryView }
  | { status: "skipped"; reason: string };

export interface DailySummaryView {
  id: string;
  date: string;
  status: string;
  source: string | null;
  fallbackReason: string | null;
  language: string;
  narrative: string | null;
  actions: string[];
  facts: SummaryFacts | null;
  credits: number;
  delivery: SummaryDelivery | null;
  createdAt: string;
}

export const summaryView = (r: AiDailySummaryRow): DailySummaryView => ({
  id: r.id,
  date: r.date,
  status: r.status,
  source: r.source,
  fallbackReason: r.fallbackReason,
  language: r.language,
  narrative: r.narrative,
  actions: r.actions ?? [],
  facts: r.facts ?? null,
  credits: r.credits,
  delivery: r.delivery ?? null,
  createdAt: r.createdAt.toISOString(),
});

export class DailySummaryService {
  private readonly now: () => Date;
  constructor(
    private readonly d: { db: Db; ai: AiRunner; ports: DailyPorts; log?: DailyLog; now?: () => Date },
  ) {
    this.now = d.now ?? (() => new Date());
  }

  /** A preview: facts and the narrative for a date (credits are used), nothing stored and nothing sent. */
  async preview(tenantId: string, userId: string | null, opts: { date?: string; language?: SummaryLang }): Promise<{ date: string; language: SummaryLang; result: SummaryResult; facts: SummaryFacts }> {
    const s = resolveDailySummary((await this.d.ports.aiSettings(tenantId)).dailySummary);
    const date = opts.date ?? this.defaultDate(s);
    const language = opts.language ?? s.language;
    const facts = await this.d.ports.facts(tenantId, date, this.now());
    const result = await writeSummary(this.d.ai, { tenantId, userId, facts, lang: language, fallbackOnError: (c) => TEMPLATE_OK.has(c) });
    return { date, language, result, facts };
  }

  private defaultDate(s: DailySummarySettings): string {
    return dueNow({ enabled: true, time: s.time }, this.now()).date;
  }

  /**
   * Writes and delivers the summary of one day. `schedule` claims the day first (idempotent) and only runs for shops that
   * switched it on; `manual` (Send now) replaces that day's row.
   */
  async run(tenantId: string, opts: { trigger: "schedule" | "manual"; userId?: string | null; date?: string }): Promise<RunOutcome> {
    const ai = await this.d.ports.aiSettings(tenantId);
    const s = resolveDailySummary(ai.dailySummary);
    if (!ai.enabled) return { status: "skipped", reason: "ai_off" };
    if (ai.features[SUMMARY_FEATURE] === false) return { status: "skipped", reason: "ai_feature_off" };
    if (opts.trigger === "schedule" && !s.enabled) return { status: "skipped", reason: "summary_off" };
    const date = opts.date ?? this.defaultDate(s);
    const row = await this.claim(tenantId, date, opts.trigger, s.language);
    if (!row) return { status: "skipped", reason: "already_done" };
    try {
      const facts = await this.d.ports.facts(tenantId, date, this.now());
      const result = await writeSummary(this.d.ai, { tenantId, userId: opts.userId ?? null, facts, lang: s.language, fallbackOnError: (c) => TEMPLATE_OK.has(c) });
      const shop = await this.d.ports.shopName(tenantId).catch(() => "");
      const delivered = await this.d.ports
        .deliver({ tenantId, shop, date, text: result, whatsappText: whatsappText(result), language: s.language, settings: s })
        .catch((err) => ({ whatsapp: [], email: [], skipped: [`delivery_error:${String((err as Error)?.message ?? err).slice(0, 80)}`] }));
      const [saved] = await this.d.db
        .update(aiDailySummaries)
        .set({
          status: "ready",
          source: result.source,
          fallbackReason: result.fallbackReason,
          facts,
          narrative: result.narrative,
          actions: result.actions,
          runId: result.runId,
          credits: result.credits,
          delivery: { inApp: true, ...delivered },
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(aiDailySummaries.id, row.id))
        .returning();
      this.d.log?.info({ tenantId, date, source: result.source, credits: result.credits }, "ai: daily summary ready");
      return { status: "ready", summary: summaryView(saved!) };
    } catch (e) {
      const code = (e as { code?: string }).code ?? "error";
      if (opts.trigger === "manual") {
        // The person pressed the button: tell them why (the error carries a friendly message), keep a failed marker.
        await this.d.db.update(aiDailySummaries).set({ status: "failed", error: code, updatedAt: new Date() }).where(eq(aiDailySummaries.id, row.id));
        throw e;
      }
      if (SWITCHED_OFF.has(code)) {
        await this.d.db.delete(aiDailySummaries).where(eq(aiDailySummaries.id, row.id));
        return { status: "skipped", reason: code };
      }
      await this.d.db
        .update(aiDailySummaries)
        .set({ status: "failed", error: String((e as Error)?.message ?? e).slice(0, 300), updatedAt: new Date() })
        .where(eq(aiDailySummaries.id, row.id));
      this.d.log?.warn({ tenantId, date, code }, "ai: daily summary failed");
      return { status: "skipped", reason: code };
    }
  }

  /** The one place the day is claimed: the unique (tenant, date) row. Null = somebody else has it (or it is done). */
  private async claim(tenantId: string, date: string, trigger: "schedule" | "manual", language: SummaryLang): Promise<AiDailySummaryRow | null> {
    const [inserted] = await this.d.db
      .insert(aiDailySummaries)
      .values({ tenantId, date, trigger, language, status: "running" })
      .onConflictDoNothing()
      .returning();
    if (inserted) return inserted;
    if (trigger === "manual") {
      const [again] = await this.d.db
        .update(aiDailySummaries)
        .set({ status: "running", trigger, language, attempts: sql`${aiDailySummaries.attempts} + 1`, updatedAt: new Date() })
        .where(and(eq(aiDailySummaries.tenantId, tenantId), eq(aiDailySummaries.date, date)))
        .returning();
      return again ?? null;
    }
    // Scheduled: retry a failed day (up to MAX_ATTEMPTS) or a run that died half way; never one that is ready.
    const stale = new Date(this.now().getTime() - STALE_MS).toISOString();
    const [retry] = await this.d.db
      .update(aiDailySummaries)
      .set({ status: "running", attempts: sql`${aiDailySummaries.attempts} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(aiDailySummaries.tenantId, tenantId),
          eq(aiDailySummaries.date, date),
          sql`${aiDailySummaries.attempts} < ${MAX_ATTEMPTS}`,
          sql`(${aiDailySummaries.status} = 'failed' or (${aiDailySummaries.status} = 'running' and ${aiDailySummaries.updatedAt} < ${stale}::timestamptz))`,
        ),
      )
      .returning();
    return retry ?? null;
  }

  /** The job body: every shop whose time has come gets its summary once (see `claim`). Returns what happened per shop. */
  async tick(): Promise<{ tenantId: string; outcome: string }[]> {
    const now = this.now();
    const out: { tenantId: string; outcome: string }[] = [];
    for (const tenantId of await this.d.ports.candidates()) {
      try {
        const ai = await this.d.ports.aiSettings(tenantId);
        const s = resolveDailySummary(ai.dailySummary);
        const { due, date } = dueNow(s, now);
        if (!due || !ai.enabled) continue;
        const r = await this.run(tenantId, { trigger: "schedule", date });
        out.push({ tenantId, outcome: r.status === "ready" ? "ready" : r.reason });
      } catch (err) {
        this.d.log?.warn({ tenantId, err }, "ai: daily summary tick failed for a shop");
        out.push({ tenantId, outcome: "error" });
      }
    }
    return out;
  }

  async latest(tenantId: string): Promise<DailySummaryView | null> {
    const [r] = await this.d.db
      .select()
      .from(aiDailySummaries)
      .where(and(eq(aiDailySummaries.tenantId, tenantId), eq(aiDailySummaries.status, "ready")))
      .orderBy(desc(aiDailySummaries.date))
      .limit(1);
    return r ? summaryView(r) : null;
  }

  async list(tenantId: string, limit = 14): Promise<DailySummaryView[]> {
    const rows = await this.d.db.select().from(aiDailySummaries).where(eq(aiDailySummaries.tenantId, tenantId)).orderBy(desc(aiDailySummaries.date)).limit(Math.min(60, limit));
    return rows.map(summaryView);
  }

  async get(tenantId: string, id: string): Promise<DailySummaryView> {
    const [r] = await this.d.db.select().from(aiDailySummaries).where(and(eq(aiDailySummaries.tenantId, tenantId), eq(aiDailySummaries.id, id))).limit(1);
    if (!r) throw notFound("Summary");
    return summaryView(r);
  }
}

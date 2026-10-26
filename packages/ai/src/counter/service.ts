import { AppError } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { AiService } from "../service";
import { addDays } from "../insights/calendar";
import { detectAlerts, type CounterFacts, type DrillRef, type UnusualAlert } from "./alerts";
import { coachMetrics, writeCoaching, type CoachFacts, type CoachLang, type StaffWeek } from "./coaching";
import type { CounterIndex } from "./match";
import { aiActivityReviews, aiCounterEvents, aiStaffCoaching } from "./schema";
import { mondayOf, planShifts, planSummary, upliftFor, type HourRow, type ShiftPlan } from "./shifts";
import { VOICE_FEATURE, parseVoiceOrder, type VoiceResult } from "./voice";
import { ALERTS_FEATURE, COACHING_FEATURE_KEY, SHIFTS_FEATURE } from "./registry";
import type { PlanFestival } from "../insights/calendar";

export interface DrillRow {
  id: string;
  number: string | null;
  /** ISO time. */
  at: string;
  /** Paise. */
  total: number;
  discount: number;
  reason: string | null;
  /** Free text such as the customer's name or the register. */
  label: string | null;
}

export interface CounterSettings {
  /** Bills one person handles in an hour; null clears it (back to the shop's own median). */
  billsPerStaffHour?: number | null;
  /** Add the top unusual-activity lines to the Phase 2 daily summary. Default false. */
  alertsInSummary?: boolean;
}

export interface CounterPorts {
  /** The shop's items as an index (cached per shop by the kit). */
  catalogue(tenantId: string): Promise<CounterIndex>;
  /** Per person per day counts for the last ~67 days plus closed till sessions. */
  facts(tenantId: string, today: string): Promise<CounterFacts>;
  drill(tenantId: string, ref: DrillRef): Promise<DrillRow[]>;
  /** Every person with bills in the week starting `weekStart` (Monday), and the same people the week before. */
  week(tenantId: string, weekStart: string): Promise<{ people: StaffWeek[]; previous: StaffWeek[] }>;
  /** Bills per hour per day (IST) from `from` to `to`, with how many people rang them. */
  hours(tenantId: string, from: string, to: string): Promise<HourRow[]>;
  /** This shop's own lift around a festival last year (ratio of daily bills), or null when there is no data. */
  festivalRatio?(tenantId: string, festival: PlanFestival): Promise<number | null>;
  /** The till session the person is working in (their own open one, else the latest open one), for no-sale events. */
  currentTill?(tenantId: string, userId: string | null): Promise<string | null>;
  /** A member's display name, for "reviewed by". */
  userName?(tenantId: string, userId: string): Promise<string | null>;
  settings(tenantId: string): Promise<CounterSettings>;
  saveSettings(tenantId: string, patch: CounterSettings): Promise<void>;
}

export interface CounterDeps {
  db: Db;
  ai: AiService;
  ports: CounterPorts;
  now?: () => Date;
  today?: () => string;
}

const istDate = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);

export class CounterService {
  constructor(private readonly d: CounterDeps) {}

  private today() {
    return this.d.today ? this.d.today() : istDate((this.d.now ?? (() => new Date()))());
  }

  /** The helper must be on for the shop (module feature, AI opt-in, its own switch). Same error codes as `ai.run`. */
  async gate(tenantId: string, feature: string): Promise<void> {
    if (await this.d.ai.helperOn(tenantId, feature)) return;
    // the blocked run says exactly why (plan, AI off, helper off) in the usual error codes and is recorded like any other
    await this.d.ai.runLocal({ tenantId, feature, model: "gate" }, async () => undefined);
    throw new AppError(403, "ai_feature_off", "This helper is switched off for this shop.");
  }

  // ------------------------------------------------------------------ voice billing

  async voice(tenantId: string, userId: string | null, transcript: string, useAi = true) {
    const r = await parseVoiceOrder({ ai: this.d.ai, catalogue: this.d.ports.catalogue, now: () => Date.now() }, { tenantId, userId, transcript, useAi });
    return { ...r.output, runId: r.runId, credits: r.credits };
  }

  /** The drawer was opened with no sale (sent by the POS). Only counted when the activity-alerts helper is on. */
  async noSale(tenantId: string, user: { id: string | null; name: string | null }, tillSessionId: string | null): Promise<{ recorded: boolean }> {
    if (!(await this.d.ai.helperOn(tenantId, ALERTS_FEATURE))) return { recorded: false };
    const till = tillSessionId ?? (await this.d.ports.currentTill?.(tenantId, user.id).catch(() => null)) ?? null;
    if (!user.name && user.id) user = { id: user.id, name: (await this.d.ports.userName?.(tenantId, user.id).catch(() => null)) ?? null };
    await this.d.db.insert(aiCounterEvents).values({ tenantId, kind: "no_sale", userId: user.id, userName: user.name, tillSessionId: till });
    return { recorded: true };
  }

  // ------------------------------------------------------------------ unusual-activity alerts

  async alerts(tenantId: string, days = 7): Promise<{ today: string; from: string; alerts: (UnusualAlert & { reviewed: { at: string; by: string | null; note: string | null } | null })[]; open: number }> {
    await this.gate(tenantId, ALERTS_FEATURE);
    const today = this.today();
    const n = Math.min(Math.max(Math.floor(days), 1), 30);
    const from = addDays(today, -(n - 1));
    const facts = await this.d.ports.facts(tenantId, today);
    const found = detectAlerts(facts, { from, to: today });
    const keys = found.map((a) => a.key);
    const rows = keys.length ? await this.d.db.select().from(aiActivityReviews).where(and(eq(aiActivityReviews.tenantId, tenantId), inArray(aiActivityReviews.alertKey, keys))) : [];
    const by = new Map(rows.map((r) => [r.alertKey, r]));
    const alerts = found.map((a) => {
      const r = by.get(a.key);
      return { ...a, reviewed: r ? { at: r.reviewedAt.toISOString(), by: r.reviewedByName ?? r.reviewedBy, note: r.note } : null };
    });
    return { today, from, alerts, open: alerts.filter((a) => !a.reviewed).length };
  }

  /** Alerts for one day without the review join: for the daily summary (owner-chosen). */
  async alertsForDay(tenantId: string, date: string): Promise<UnusualAlert[]> {
    const facts = await this.d.ports.facts(tenantId, this.today());
    return detectAlerts(facts, { from: date, to: date });
  }

  async review(tenantId: string, user: { id: string | null; name: string | null }, key: string, opts: { note?: string; undo?: boolean }) {
    await this.gate(tenantId, ALERTS_FEATURE);
    if (!user.name && user.id) user = { id: user.id, name: await this.d.ports.userName?.(tenantId, user.id).catch(() => null) ?? null };
    if (opts.undo) {
      await this.d.db.delete(aiActivityReviews).where(and(eq(aiActivityReviews.tenantId, tenantId), eq(aiActivityReviews.alertKey, key)));
      return { reviewed: null };
    }
    const note = opts.note?.trim().slice(0, 300) || null;
    await this.d.db
      .insert(aiActivityReviews)
      .values({ tenantId, alertKey: key, reviewedBy: user.id, reviewedByName: user.name, note })
      .onConflictDoUpdate({ target: [aiActivityReviews.tenantId, aiActivityReviews.alertKey], set: { reviewedBy: user.id, reviewedByName: user.name, note, reviewedAt: new Date() } });
    return { reviewed: { at: new Date().toISOString(), by: user.name ?? user.id, note } };
  }

  async drill(tenantId: string, ref: DrillRef): Promise<DrillRow[]> {
    await this.gate(tenantId, ALERTS_FEATURE);
    return this.d.ports.drill(tenantId, ref);
  }

  // ------------------------------------------------------------------ staff coaching

  /** The last complete Monday-to-Sunday week (IST) unless a week is given. */
  defaultWeek(): string {
    return addDays(mondayOf(this.today()), -7);
  }

  async coaching(tenantId: string, weekStart?: string) {
    await this.gate(tenantId, COACHING_FEATURE_KEY);
    const week = mondayOf(weekStart ?? this.defaultWeek());
    const { people, previous } = await this.d.ports.week(tenantId, week);
    const prevBy = new Map(previous.map((p) => [p.staff, p]));
    const saved = await this.d.db.select().from(aiStaffCoaching).where(and(eq(aiStaffCoaching.tenantId, tenantId), eq(aiStaffCoaching.weekStart, week))).orderBy(desc(aiStaffCoaching.updatedAt));
    const out = people
      .sort((a, b) => b.bills - a.bills)
      .map((p) => {
        const m = coachMetrics({ weekStart: week, weekEnd: addDays(week, 6), person: p, previous: prevBy.get(p.staff) ?? null, team: people });
        const mine = saved.filter((s) => s.staffKey === p.staff);
        return {
          staff: p.staff,
          name: p.name,
          metrics: m,
          notes: Object.fromEntries(mine.map((s) => [s.lang, { notes: s.notes, source: s.source, credits: s.credits, createdAt: s.updatedAt.toISOString() }])) as Partial<Record<CoachLang, { notes: string[]; source: string; credits: number; createdAt: string }>>,
        };
      });
    return { weekStart: week, weekEnd: addDays(week, 6), people: out };
  }

  async generateCoaching(tenantId: string, userId: string | null, opts: { week?: string; staff?: string[]; lang: CoachLang; useAi?: boolean }) {
    await this.gate(tenantId, COACHING_FEATURE_KEY);
    const week = mondayOf(opts.week ?? this.defaultWeek());
    const { people, previous } = await this.d.ports.week(tenantId, week);
    const prevBy = new Map(previous.map((p) => [p.staff, p]));
    const chosen = people.filter((p) => !opts.staff?.length || opts.staff.includes(p.staff));
    const done: { staff: string; name: string; notes: string[]; source: "ai" | "template"; credits: number; fallbackReason: string | null }[] = [];
    let credits = 0;
    for (const p of chosen) {
      const facts: CoachFacts = { weekStart: week, weekEnd: addDays(week, 6), person: p, previous: prevBy.get(p.staff) ?? null, team: people };
      const r = await writeCoaching(this.d.ai, {
        tenantId,
        userId,
        facts,
        lang: opts.lang,
        useAi: opts.useAi,
        // switched off, no credits or busy: the plain wording is still useful and free
        fallbackOnError: (c) => ["ai_off", "ai_feature_off", "ai_credits_exhausted", "ai_busy", "ai_unavailable", "ai_disabled", "ai_not_available"].includes(c),
      });
      credits += r.credits;
      await this.d.db
        .insert(aiStaffCoaching)
        .values({ tenantId, weekStart: week, staffKey: p.staff, staffName: p.name, lang: opts.lang, notes: r.notes, metrics: r.metrics as unknown as Record<string, unknown>, source: r.source, fallbackReason: r.fallbackReason, runId: r.runId, credits: r.credits, createdBy: userId })
        .onConflictDoUpdate({
          target: [aiStaffCoaching.tenantId, aiStaffCoaching.weekStart, aiStaffCoaching.staffKey, aiStaffCoaching.lang],
          set: { staffName: p.name, notes: r.notes, metrics: r.metrics as unknown as Record<string, unknown>, source: r.source, fallbackReason: r.fallbackReason, runId: r.runId, credits: r.credits, createdBy: userId, updatedAt: new Date() },
        });
      done.push({ staff: p.staff, name: p.name, notes: r.notes, source: r.source, credits: r.credits, fallbackReason: r.fallbackReason });
    }
    return { weekStart: week, lang: opts.lang, people: done, credits };
  }

  // ------------------------------------------------------------------ shift planning

  async shifts(tenantId: string, which: "next" | "this" = "next"): Promise<{ plan: ShiftPlan; summary: { en: string; ta: string } }> {
    await this.gate(tenantId, SHIFTS_FEATURE);
    const today = this.today();
    const [rows, settings] = await Promise.all([this.d.ports.hours(tenantId, addDays(today, -56), addDays(today, -1)), this.d.ports.settings(tenantId)]);
    // festival lifts from this shop's own sales last year, where it has them
    const cache = new Map<string, number | null>();
    const weekStart = which === "this" ? mondayOf(today) : addDays(mondayOf(today), 7);
    const wanted = new Map<string, PlanFestival>();
    for (let i = 0; i < 7; i++) {
      const u = upliftFor(addDays(weekStart, i));
      if (u) wanted.set(u.festival.id + u.festival.date, { id: u.festival.id, year: Number(u.festival.date.slice(0, 4)), name: u.festival.name, nameTa: u.festival.nameTa, date: u.festival.date, leadDays: 0 });
    }
    if (this.d.ports.festivalRatio) for (const [k, f] of wanted) cache.set(k, await this.d.ports.festivalRatio(tenantId, f).catch(() => null));
    const plan = planShifts(rows, today, { billsPerStaffHour: settings.billsPerStaffHour ?? undefined }, { history: (f) => cache.get(f.id + f.date) ?? null }, { thisWeek: which === "this" });
    return { plan, summary: { en: planSummary(plan, "en"), ta: planSummary(plan, "ta") } };
  }

  // ------------------------------------------------------------------ settings

  settings(tenantId: string) {
    return this.d.ports.settings(tenantId);
  }
  async saveSettings(tenantId: string, patch: CounterSettings) {
    await this.d.ports.saveSettings(tenantId, patch);
    return this.d.ports.settings(tenantId);
  }
}

export type { VoiceResult };
export { VOICE_FEATURE };

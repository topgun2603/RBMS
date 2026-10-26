import { AppError, badRequest, forbidden, hasPermission, requirePermission, requireRole, requireTenant, requireUser, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AI_FEATURE, AI_PERMISSION_KEYS } from "../features";
import { WindowLimiter } from "../store/common";
import type { CounterService } from "./service";
import { VOICE_MAX_CHARS } from "./voice";

/**
 * AI Phase 5 part A, routes under /v1/ai/counter (docs/ai.md "Phase 5 part A").
 *
 *   POST /voice/parse      {transcript, useAi?}          the order as lines to review         invoices.create + ai.use
 *   POST /voice/no-sale    {tillSessionId?}              the drawer opened with no sale       invoices.create or pos.till
 *   GET  /alerts?days=7                                  unusual-activity alerts              owner / manager
 *   GET  /alerts/drill?kind&staff&date[&days&sessionId]  the bills behind an alert            owner / manager
 *   POST /alerts/review    {key, note?, undo?}           mark looked at                       owner / manager
 *   GET  /coaching?week=YYYY-MM-DD                       facts and saved notes per person     owner / manager
 *   POST /coaching/generate {week?, staff?, lang, useAi?} write the notes                     owner / manager + ai.use
 *   GET  /shifts?week=next|this                          suggested headcount grid             owner / manager
 *   GET/PUT /settings                                    billsPerStaffHour, alertsInSummary   owner / manager
 *
 * "Owner / manager" = a full-access role, or a holder of `reports.manage` (the Manager template) or `staff.manage`. A cashier,
 * the plain staff role and the read-only demo role are refused, so nobody sees measurements of themselves or their colleagues.
 */
export const COUNTER_PERMISSIONS = { bill: "invoices.create", till: "pos.till", reports: "reports.manage", staff: "staff.manage" } as const;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const voiceBody = z.object({ transcript: z.string().trim().min(1).max(VOICE_MAX_CHARS * 2), useAi: z.boolean().optional() });
const noSaleBody = z.object({ tillSessionId: z.string().max(64).optional() });
const reviewBody = z.object({ key: z.string().min(3).max(200), note: z.string().max(300).optional(), undo: z.boolean().optional() });
const genBody = z.object({ week: dateStr.optional(), staff: z.array(z.string().max(80)).max(50).optional(), lang: z.enum(["en", "ta"]).default("en"), useAi: z.boolean().optional() });
const drillQuery = z.object({
  kind: z.enum(["voids", "returns", "discounts", "late_discounts", "price_edits", "no_sale", "till"]),
  staff: z.string().min(1).max(80),
  date: dateStr,
  days: z.coerce.number().int().min(1).max(60).optional(),
  sessionId: z.string().max(64).optional(),
});
const settingsBody = z.object({ billsPerStaffHour: z.number().min(1).max(200).nullable().optional(), alertsInSummary: z.boolean().optional() });

const cfg = { config: { feature: AI_FEATURE } };

export interface CounterRouteDeps {
  counter: CounterService;
  limiter?: WindowLimiter;
}

export function isManager(ctx: RequestContext): boolean {
  return hasPermission(ctx, COUNTER_PERMISSIONS.reports) || hasPermission(ctx, COUNTER_PERMISSIONS.staff);
}

export function counterRoutes(d: CounterRouteDeps) {
  const limiter = d.limiter ?? new WindowLimiter();
  const parse = <T extends z.ZodTypeAny>(schema: T, v: unknown): z.infer<T> => {
    const r = schema.safeParse(v ?? {});
    if (!r.success) throw badRequest(r.error.issues[0]?.message ?? "Invalid request");
    return r.data;
  };
  const who = (ctx: RequestContext, route: string, max: number) => {
    requireUser(ctx);
    requireRole(ctx, "owner", "admin", "staff");
    const tenantId = requireTenant(ctx).id;
    const userId = ctx.user?.id ?? null;
    if (!limiter.take(`${tenantId}:${userId}:${route}`, max, 60_000)) throw new AppError(429, "rate_limited", "You are asking too fast. Please wait a minute and try again.");
    return { tenantId, userId, name: null as string | null };
  };
  const manager = (ctx: RequestContext, route: string, max: number) => {
    const w = who(ctx, route, max);
    if (!isManager(ctx)) throw forbidden("Only the owner or a manager can see this.");
    return w;
  };

  return async (app: FastifyInstance) => {
    // ---- voice billing
    app.post("/voice/parse", cfg, async (req) => {
      const { tenantId, userId } = who(req.ctx, "voice", 60);
      requirePermission(req.ctx, COUNTER_PERMISSIONS.bill);
      requirePermission(req.ctx, AI_PERMISSION_KEYS.use);
      const b = parse(voiceBody, req.body);
      return d.counter.voice(tenantId, userId, b.transcript, b.useAi);
    });
    app.post("/voice/no-sale", cfg, async (req) => {
      const { tenantId, userId, name } = who(req.ctx, "no-sale", 120);
      if (!hasPermission(req.ctx, COUNTER_PERMISSIONS.till) && !hasPermission(req.ctx, COUNTER_PERMISSIONS.bill)) requirePermission(req.ctx, COUNTER_PERMISSIONS.till);
      const b = parse(noSaleBody, req.body);
      return d.counter.noSale(tenantId, { id: userId, name: name ? String(name) : null }, b.tillSessionId ?? null);
    });

    // ---- alerts
    app.get("/alerts", cfg, async (req) => {
      const { tenantId } = manager(req.ctx, "alerts", 60);
      const q = parse(z.object({ days: z.coerce.number().int().min(1).max(30).default(7) }), req.query);
      return d.counter.alerts(tenantId, q.days);
    });
    app.get("/alerts/drill", cfg, async (req) => {
      const { tenantId } = manager(req.ctx, "drill", 120);
      const q = parse(drillQuery, req.query);
      return { items: await d.counter.drill(tenantId, q) };
    });
    app.post("/alerts/review", cfg, async (req) => {
      const { tenantId, userId, name } = manager(req.ctx, "review", 120);
      const b = parse(reviewBody, req.body);
      return d.counter.review(tenantId, { id: userId, name: name ? String(name) : null }, b.key, { note: b.note, undo: b.undo });
    });

    // ---- coaching
    app.get("/coaching", cfg, async (req) => {
      const { tenantId } = manager(req.ctx, "coaching", 60);
      const q = parse(z.object({ week: dateStr.optional() }), req.query);
      return d.counter.coaching(tenantId, q.week);
    });
    app.post("/coaching/generate", cfg, async (req) => {
      const { tenantId, userId } = manager(req.ctx, "coaching-gen", 6);
      requirePermission(req.ctx, AI_PERMISSION_KEYS.use);
      const b = parse(genBody, req.body);
      return d.counter.generateCoaching(tenantId, userId, b);
    });

    // ---- shifts
    app.get("/shifts", cfg, async (req) => {
      const { tenantId } = manager(req.ctx, "shifts", 60);
      const q = parse(z.object({ week: z.enum(["next", "this"]).default("next") }), req.query);
      return d.counter.shifts(tenantId, q.week);
    });

    // ---- settings
    app.get("/settings", cfg, async (req) => {
      const { tenantId } = manager(req.ctx, "settings", 60);
      return d.counter.settings(tenantId);
    });
    app.put("/settings", cfg, async (req) => {
      const { tenantId } = manager(req.ctx, "settings-put", 30);
      const b = parse(settingsBody, req.body);
      return d.counter.saveSettings(tenantId, { ...(b.billsPerStaffHour !== undefined ? { billsPerStaffHour: b.billsPerStaffHour } : {}), ...(b.alertsInSummary !== undefined ? { alertsInSummary: b.alertsInSummary } : {}) });
    });
  };
}

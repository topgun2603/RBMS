import { AppError, badRequest, requirePermission, requireRole, requireTenant, requireUser, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AI_FEATURE, AI_PERMISSION_KEYS } from "../features";
import { RateLimiter } from "../assist/routes";
import type { AiRunner } from "../assist/hsn";
import { applySegment, draftCampaign, suggestSendTime, type SegCustomer, type SegmentSpec } from "./campaign";
import type { DailySummaryService } from "./daily";
import { explainGroups, groupSuggestions, suggestItem, REORDER_GROUPS, type ReorderInput, type ReorderSuggestion } from "./reorder";
import { countThemes, draftReviewReply, summariseThemes, type ReviewForReply, type ThemeReview } from "./reviews";

/** Other modules' permissions the Phase 2 helpers need on top of `ai.use` (the AI only drafts; acting needs them anyway). */
export const INSIGHT_PERMISSIONS = { purchases: "inventory.purchases", campaigns: "whatsapp.manage", reviews: "reviews.manage" } as const;

export interface ReorderData {
  today: string;
  /** Days of sales history the shop has (up to 90). */
  historyDays: number;
  inputs: ReorderInput[];
  /** Upcoming festivals considered (name, days away) for the header line. */
  festivals: { id: string; name: string; nameTa: string; date: string; daysAway: number; hasLastYearData: boolean }[];
}

export interface InsightPorts {
  reorder(tenantId: string, opts: { leadDays?: number }): Promise<ReorderData>;
  /** Customer summaries for a segment (bills, keyword match, opt-outs, last message). */
  segment(tenantId: string, spec: SegmentSpec, today: string): Promise<SegCustomer[]>;
  /** The hour (0-23, IST) with the most bills over the last 90 days; null when there is no history. */
  peakHour(tenantId: string): Promise<number | null>;
  shop(tenantId: string): Promise<{ name: string; trade: string | null }>;
  review(tenantId: string, id: string): Promise<(ReviewForReply & { id: string }) | null>;
  reviewTexts(tenantId: string, days: number, productId?: string): Promise<ThemeReview[]>;
  today(): string;
  now(): Date;
}

export interface InsightRouteDeps {
  ai: AiRunner;
  daily: DailySummaryService;
  ports: InsightPorts;
  limiter?: RateLimiter;
}

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const lang = z.enum(["en", "ta"]);
const previewBody = z.object({ date: dateStr.optional(), language: lang.optional() });
const reorderBody = z.object({ leadDays: z.number().int().min(0).max(30).optional(), lang: lang.default("en"), explain: z.boolean().default(true) });
const campaignBody = z.object({ goal: z.string().trim().min(8).max(600) });
const replyBody = z.object({ note: z.string().trim().max(500).optional(), language: lang.optional() });
const themesBody = z.object({ days: z.number().int().min(7).max(365).default(90), productId: z.string().uuid().optional(), lang: lang.default("en") });
const idParam = z.object({ id: z.string().uuid() });

const use = { config: { feature: AI_FEATURE, permission: AI_PERMISSION_KEYS.use } };
const manage = { config: { feature: AI_FEATURE, permission: AI_PERMISSION_KEYS.manage } };

export function insightRoutes(d: InsightRouteDeps) {
  const limiter = d.limiter ?? new RateLimiter();
  return async (app: FastifyInstance) => {
    const who = (req: { ctx: RequestContext }, route: string, max: number, ...permissions: string[]) => {
      requireUser(req.ctx);
      requireRole(req.ctx, "owner", "admin", "staff");
      const tenantId = requireTenant(req.ctx).id;
      const userId = req.ctx.user?.id ?? null;
      for (const p of permissions) requirePermission(req.ctx, p);
      limiter.check(`${tenantId}:${userId}:${route}`, max, 60_000);
      return { tenantId, userId };
    };
    const parse = <T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> => {
      const r = schema.safeParse(body ?? {});
      if (!r.success) throw badRequest(r.error.issues[0]?.message ?? "Invalid request");
      return r.data;
    };

    // ---- daily summary (Settings > AI > Daily summary, dashboard card)
    app.get("/daily/latest", manage, async (req) => {
      const { tenantId } = who(req, "daily-latest", 60, AI_PERMISSION_KEYS.manage);
      return { summary: await d.daily.latest(tenantId) };
    });
    app.get("/daily", manage, async (req) => {
      const { tenantId } = who(req, "daily-list", 30, AI_PERMISSION_KEYS.manage);
      return { items: await d.daily.list(tenantId, 14) };
    });
    app.post("/daily/preview", manage, async (req) => {
      const { tenantId, userId } = who(req, "daily-preview", 6, AI_PERMISSION_KEYS.manage, AI_PERMISSION_KEYS.use);
      const b = parse(previewBody, req.body);
      const p = await d.daily.preview(tenantId, userId, b);
      return { date: p.date, language: p.language, narrative: p.result.narrative, actions: p.result.actions, source: p.result.source, fallbackReason: p.result.fallbackReason, facts: p.facts, runId: p.result.runId, credits: p.result.credits };
    });
    app.post("/daily/send", manage, async (req) => {
      const { tenantId, userId } = who(req, "daily-send", 4, AI_PERMISSION_KEYS.manage, AI_PERMISSION_KEYS.use);
      const b = parse(previewBody.pick({ date: true }), req.body);
      const r = await d.daily.run(tenantId, { trigger: "manual", userId, date: b.date });
      if (r.status === "skipped") throw new AppError(409, r.reason === "ai_off" ? "ai_off" : "ai_feature_off", "The daily summary could not be made: AI is switched off for your shop or for this helper.");
      return r.summary;
    });
    // ---- reorder suggestions
    app.post("/reorder", use, async (req) => {
      const { tenantId, userId } = who(req, "reorder", 10, AI_PERMISSION_KEYS.use, INSIGHT_PERMISSIONS.purchases);
      const b = parse(reorderBody, req.body);
      const data = await d.ports.reorder(tenantId, { leadDays: b.leadDays });
      const suggestions: ReorderSuggestion[] = data.inputs.map((i) => suggestItem(i)).filter((x): x is ReorderSuggestion => !!x);
      const grouped = groupSuggestions(suggestions);
      const ex = b.explain
        ? await explainGroups(d.ai, { tenantId, userId, groups: grouped.map((g) => g.summary), lang: b.lang })
        : { lines: [], runId: null, credits: 0, aiNote: null };
      const line = new Map(ex.lines.map((l) => [l.group, l]));
      return {
        today: data.today,
        historyDays: data.historyDays,
        festivals: data.festivals,
        groups: grouped.map((g) => ({ group: g.summary.group, count: g.summary.items, reason: line.get(g.summary.group)?.text ?? null, reasonSource: line.get(g.summary.group)?.source ?? null, items: g.items })),
        total: suggestions.length,
        order: REORDER_GROUPS,
        aiNote: ex.aiNote,
        runId: ex.runId,
        credits: ex.credits,
      };
    });

    // ---- campaign writer
    app.post("/campaign/draft", use, async (req) => {
      const { tenantId, userId } = who(req, "campaign", 8, AI_PERMISSION_KEYS.use, INSIGHT_PERMISSIONS.campaigns);
      const b = parse(campaignBody, req.body);
      const shop = await d.ports.shop(tenantId);
      const r = await draftCampaign(d.ai, { tenantId, userId, goal: b.goal, shop: shop.name, trade: shop.trade });
      const today = d.ports.today();
      const rows = await d.ports.segment(tenantId, r.spec, today);
      const seg = applySegment(rows, r.spec, today);
      const send = suggestSendTime(d.ports.now(), await d.ports.peakHour(tenantId));
      return {
        draft: r.draft,
        audience: r.audience,
        segment: {
          spec: r.spec,
          counts: seg.counts,
          // The owner's own customers' numbers go back to the owner's browser so the campaign wizard can use them; the AI never saw them.
          members: seg.members.slice(0, 5000),
        },
        sendAt: send,
        runId: r.runId,
        credits: r.credits,
      };
    });

    // ---- store reviews
    app.post("/reviews/:id/reply", use, async (req) => {
      const { tenantId, userId } = who(req, "review-reply", 20, AI_PERMISSION_KEYS.use, INSIGHT_PERMISSIONS.reviews);
      const { id } = parse(idParam, req.params);
      const b = parse(replyBody, req.body);
      const review = await d.ports.review(tenantId, id);
      if (!review) throw new AppError(404, "not_found", "Review not found");
      const shop = await d.ports.shop(tenantId);
      return draftReviewReply(d.ai, { tenantId, userId, review, shop: shop.name, ownerNote: b.note, language: b.language });
    });
    app.post("/reviews/themes", use, async (req) => {
      const { tenantId, userId } = who(req, "review-themes", 8, AI_PERMISSION_KEYS.use, INSIGHT_PERMISSIONS.reviews);
      const b = parse(themesBody, req.body);
      const texts = await d.ports.reviewTexts(tenantId, b.days, b.productId);
      const themes = countThemes(texts, b.days);
      const summary = await summariseThemes(d.ai, { tenantId, userId, themes, lang: b.lang });
      return { themes, summary: summary.summary, source: summary.source, runId: summary.runId, credits: summary.credits };
    });
  };
}

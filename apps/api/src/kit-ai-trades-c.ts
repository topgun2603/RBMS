import { AI_PERMISSION_KEYS, RateLimiter, tradesC, type AiService } from "@srirealtime/ai";
import { AppError, badRequest, hasPermission, permissionDenied, requireRole, requireTenant, requireUser, type RequestContext, type SrModule } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { todayIST } from "@srirealtime/gst";
import { warrantyDaysLeft, warrantyEnd } from "@srirealtime/serials";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { peopleHistories, phoneKey, recentlyMessaged, soldUnits } from "./ai-trades-c/data";
import { parseScanBody, SCAN_BODY_LIMIT } from "./kit-ai-vision";

/**
 * Phase 3 part C routes, `/v1/ai/trades-c/*` (docs/ai.md "Phase 3 part C"): repair & electronics (fault note, serial / IMEI
 * reading), tailoring (measurement sheet, design notes), salon / spa / gym (at-risk list, win-back message) and hardware
 * (material quotation draft). Every route only drafts: nothing is saved, sent or quoted. Each needs `ai.use` plus the permission
 * of the module it fills, and the module's feature switched on for the shop.
 */
export interface AiTradesCDeps {
  ai: AiService;
  db: Db;
  items: {
    listItems(tenantId: string, q: { q?: string; limit?: number }): Promise<{ items: { id: string; name: string; hsn: string | null; unit: string; rate: number; gstRate: number; active?: boolean; stockQty?: number | null }[] }>;
  };
  isEnabled: (tenantId: string, key: string) => Promise<boolean>;
  shopName: (tenantId: string) => Promise<string>;
  now?: () => Date;
  limiter?: RateLimiter;
}

const lang = z.enum(["en", "ta"]).default("en");
const faultBody = z.object({
  complaint: z.string().trim().min(3).max(1500),
  brand: z.string().trim().max(60).nullish(),
  model: z.string().trim().max(80).nullish(),
  language: lang,
});
const winbackBody = z.object({ clientKey: z.string().min(3).max(80), language: lang, offer: z.string().trim().max(160).nullish() });
const quoteBody = z.object({ description: z.string().trim().min(8).max(800), language: lang });
const extraBody = z.object({ for: z.enum(["jobcard", "serial"]).default("jobcard"), garment: z.enum(["blouse", "salwar", "shirt", "pant", "other"]).default("blouse"), language: lang });

type Req = { ctx: RequestContext };

export function createAiTradesC(d: AiTradesCDeps): SrModule {
  const now = d.now ?? (() => new Date());
  const limiter = d.limiter ?? new RateLimiter();

  /** Signed-in shop member, with every permission in `all` and at least one in `any`, and at least one of `features` on. */
  const gate = async (req: Req, o: { all?: string[]; any?: string[]; features: string[]; rate?: { name: string; max: number } }) => {
    const user = requireUser(req.ctx);
    requireRole(req.ctx, "owner", "admin", "staff");
    const tenant = requireTenant(req.ctx);
    for (const k of o.all ?? []) if (!hasPermission(req.ctx, k)) throw permissionDenied(k);
    if (o.any?.length && !o.any.some((k) => hasPermission(req.ctx, k))) throw permissionDenied(o.any[0]!);
    let on = false;
    for (const f of o.features) if (await d.isEnabled(tenant.id, f).catch(() => false)) on = true;
    if (!on) throw new AppError(403, "feature_unavailable", "This shop does not have that module switched on.");
    if (o.rate) limiter.check(`trades-c:${o.rate.name}:${user.id}`, o.rate.max, 60_000);
    return { tenantId: tenant.id, userId: user.id };
  };

  const imagesOnly = (body: unknown, max: number) => {
    const input = parseScanBody(body);
    if (input.pdfs.length > 0) throw new AppError(400, "ai_bad_image", "Send photos, not a PDF.");
    if (input.images.length > max) throw badRequest(`Send at most ${max} photo${max === 1 ? "" : "s"}`);
    return { images: input.images };
  };
  const unreadable = () => new AppError(422, "ai_unreadable_image", "The photo could not be read. Retake it in good light, flat and fully in the frame.");

  const search = (tenantId: string) => async (q: string, limit = 12) => {
    const r = await d.items.listItems(tenantId, { q: q.slice(0, 80), limit });
    return r.items.filter((i) => i.active !== false).map((i) => ({ id: i.id, name: i.name, rate: i.rate, gstRate: Number(i.gstRate), unit: i.unit || "pcs", hsn: i.hsn, stockQty: i.stockQty ?? null }));
  };

  const loadPeople = async (tenantId: string) => {
    const [memberships, bookings] = await Promise.all([d.isEnabled(tenantId, "memberships").catch(() => false), d.isEnabled(tenantId, "bookings").catch(() => false)]);
    const people = await peopleHistories(d.db, tenantId, { memberships, bookings });
    const today = todayIST(now());
    return { today, list: tradesC.computeAtRisk(people, today), people: people.length };
  };

  return {
    id: "ai/trades-c",
    routes: async (app: FastifyInstance) => {
      const VISION = { bodyLimit: SCAN_BODY_LIMIT, config: { audit: false as const } };
      const PLAIN = { config: { audit: false as const } };

      // ---- repair & electronics -------------------------------------------------------------------------------------

      app.post("/fault-note", PLAIN, async (req) => {
        const { tenantId, userId } = await gate(req, { all: [AI_PERMISSION_KEYS.use, "jobcards.manage"], features: ["jobcards"], rate: { name: "fault", max: 20 } });
        const b = faultBody.parse(req.body ?? {});
        const r = await tradesC.draftFaultNote(d.ai, { search: search(tenantId) }, { tenantId, userId, complaint: b.complaint, brand: b.brand ?? null, model: b.model ?? null, language: b.language });
        return { draft: r.draft, runId: r.runId, credits: r.credits, provider: r.provider };
      });

      app.post("/device-label", VISION, async (req) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const kind = extraBody.shape.for.parse(body.for ?? "jobcard");
        const { tenantId, userId } = await gate(req, {
          all: [AI_PERMISSION_KEYS.use, kind === "serial" ? "serials.manage" : "jobcards.manage"],
          features: [kind === "serial" ? "serials" : "jobcards"],
          rate: { name: "device", max: 12 },
        });
        const input = imagesOnly(body, 3);
        const r = await tradesC.readDeviceLabel(d.ai, { tenantId, userId, ...input });
        if (!r.draft) throw unreadable();
        const draft = r.draft;
        // Warranty only from this shop's own sales records, and only for numbers that passed the checks.
        let warranty: tradesC.WarrantyAnswer | null = null;
        if (await d.isEnabled(tenantId, "serials").catch(() => false)) {
          const wanted = [draft.fill.serial, draft.fill.imei1, draft.fill.imei2].filter((x): x is string => !!x);
          if (wanted.length) warranty = tradesC.warrantyFromUnits(wanted, await soldUnits(d.db, tenantId, wanted), todayIST(now()), { warrantyEnd, daysLeft: (end, today) => warrantyDaysLeft(end, today) });
        }
        return { draft, warranty, runId: r.runId, credits: r.credits, provider: r.provider };
      });

      // ---- tailoring ------------------------------------------------------------------------------------------------

      app.post("/measurements", VISION, async (req) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const { garment } = extraBody.parse({ garment: body.garment, language: body.language });
        const { tenantId, userId } = await gate(req, { all: [AI_PERMISSION_KEYS.use, "jobcards.manage"], features: ["jobcards"], rate: { name: "measure", max: 12 } });
        const input = imagesOnly(body, 2);
        const r = await tradesC.readMeasurementSheet(d.ai, { tenantId, userId, garment, ...input });
        if (!r.draft) throw unreadable();
        return { draft: r.draft, runId: r.runId, credits: r.credits, provider: r.provider };
      });

      app.post("/design-notes", VISION, async (req) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const { language } = extraBody.parse({ language: body.language });
        const { tenantId, userId } = await gate(req, { all: [AI_PERMISSION_KEYS.use, "jobcards.manage"], features: ["jobcards"], rate: { name: "design", max: 12 } });
        const input = imagesOnly(body, 2);
        const r = await tradesC.readDesignNotes(d.ai, { tenantId, userId, language, ...input });
        if (!r.draft) throw unreadable();
        return { draft: r.draft, runId: r.runId, credits: r.credits, provider: r.provider };
      });

      // ---- salon / spa / gym ----------------------------------------------------------------------------------------

      /** The list is computed in code and costs nothing; drafting a message needs `ai.use`. */
      app.get("/at-risk", PLAIN, async (req) => {
        const { tenantId } = await gate(req, { any: ["memberships.manage", "bookings.manage"], features: ["memberships", "bookings"] });
        const { today, list, people } = await loadPeople(tenantId);
        const messaged = await recentlyMessaged(d.db, tenantId);
        const clients = list.map((c) => ({ ...c, lastMessagedAt: (c.phone && messaged.get(phoneKey(c.phone) ?? "")) || null }));
        return {
          today,
          people,
          clients,
          counts: { total: clients.length, optedOut: clients.filter((c) => c.optedOut).length, noPhone: clients.filter((c) => c.noPhone).length, reachable: clients.filter((c) => !c.optedOut && !c.noPhone).length },
          rules: tradesC.AT_RISK,
        };
      });

      app.post("/winback", PLAIN, async (req) => {
        const { tenantId, userId } = await gate(req, { all: [AI_PERMISSION_KEYS.use], any: ["memberships.manage", "bookings.manage"], features: ["memberships", "bookings"], rate: { name: "winback", max: 30 } });
        const b = winbackBody.parse(req.body ?? {});
        const { list } = await loadPeople(tenantId);
        const client = list.find((c) => c.key === b.clientKey);
        if (!client) throw new AppError(404, "not_at_risk", "That person is no longer on the at-risk list.");
        if (client.optedOut) throw new AppError(409, "opted_out", "This person has opted out of messages. Do not message them.");
        if (client.noPhone) throw new AppError(409, "no_phone", "There is no phone number for this person.");
        const r = await tradesC.draftWinback(d.ai, { tenantId, userId, client, shop: await d.shopName(tenantId), language: b.language, offer: b.offer ?? null });
        return { draft: r.draft, runId: r.runId, credits: r.credits, provider: r.provider };
      });

      // ---- hardware -------------------------------------------------------------------------------------------------

      app.post("/quote-draft", PLAIN, async (req) => {
        const { tenantId, userId } = await gate(req, { all: [AI_PERMISSION_KEYS.use, "quotations.manage"], features: ["invoices.quotations"], rate: { name: "quote", max: 6 } });
        const b = quoteBody.parse(req.body ?? {});
        const r = await tradesC.draftHardwareQuote(d.ai, { search: search(tenantId) }, { tenantId, userId, description: b.description, language: b.language });
        return { draft: r.draft, disclaimer: tradesC.QUOTE_DISCLAIMER[b.language], runId: r.runId, credits: r.credits, provider: r.provider };
      });
    },
  };
}

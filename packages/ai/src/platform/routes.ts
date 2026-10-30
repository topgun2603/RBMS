import { FULL_ACCESS_ROLES, badRequest, forbidden, isSuperAdmin, requireRole, requireSuperAdmin, requireTenant, requireUser, type RequestContext, type SrModule } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RateLimiter } from "../assist/routes";
import type { ChurnFilter } from "./churn";
import { PLATFORM_TICKET_STATUSES, TICKET_CATEGORIES, TICKET_URGENCIES } from "./schema";
import type { PlatformService, ShopActor, TeamActor } from "./service";
import { TICKET_LIMITS } from "./tickets";

/**
 * Phase 7 part B routes (docs/ai.md "Phase 7 part B: platform tools").
 *
 * Shop side, /v1/platform (any signed-in member of the shop; never the read-only demo role):
 *   POST /support/tickets {subject, body, screen?, question?, source?}  raise a ticket with RBMS support (triage is queued)
 *   GET  /support/tickets                    the shop's tickets (owners / admins: all; staff: their own)
 *   GET  /support/tickets/:id                one ticket with the replies (opening it clears the unread badge)
 *   POST /support/tickets/:id/messages {body}   reply      POST /support/tickets/:id/resolve
 *   GET  /badges                             { support: unread RBMS replies, whatsNew: unseen notes }
 *   GET  /whats-new                          published notes for this shop's app and trade    POST /whats-new/seen
 *
 * RBMS side, /v1/admin/platform (super-admin only):
 *   GET  /churn?filter=at-risk|snoozed|contacted|all       POST /churn/:tenantId/followup {kind, ...}
 *   GET  /support/tickets?status=&category=&urgency=&q=      GET /support/tickets/:id
 *   POST /support/tickets/:id/reply {body, fromDraft?, status?}   /note {body}   /status {status}   /triage
 *   GET  /support/common?weeks=8
 *   GET  /release-notes, POST /release-notes {text|commits, source?, sinceRef?}, GET|PUT /release-notes/:id
 *   POST /release-notes/:id/draft   /publish   /archive
 */

const idParam = z.object({ id: z.string().uuid() });
const tenantParam = z.object({ tenantId: z.string().uuid() });

const ticketBody = z.object({
  subject: z.string().trim().min(3, "Add a short subject").max(TICKET_LIMITS.subject),
  body: z.string().trim().min(5, "Tell us what happened").max(TICKET_LIMITS.body),
  screen: z.string().trim().max(TICKET_LIMITS.screen).nullish(),
  question: z.string().trim().max(TICKET_LIMITS.question).nullish(),
  source: z.enum(["help", "menu"]).optional(),
});
const messageBody = z.object({ body: z.string().trim().min(1, "Write a message").max(TICKET_LIMITS.body) });

const replyBody = z.object({
  body: z.string().trim().min(2, "Write a reply").max(TICKET_LIMITS.reply),
  fromDraft: z.enum(["as-drafted", "edited"]).nullish(),
  status: z.enum(PLATFORM_TICKET_STATUSES).nullish(),
});
const followupBody = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("contacted"), text: z.string().max(1000).optional() }),
  z.object({ kind: z.literal("note"), text: z.string().trim().min(1).max(1000) }),
  z.object({ kind: z.literal("snooze"), days: z.number().int().min(1).max(90), text: z.string().max(1000).optional() }),
  z.object({ kind: z.literal("unsnooze") }),
  z.object({ kind: z.literal("ignore"), ignored: z.boolean(), text: z.string().max(1000).optional() }),
]);
const commitSchema = z.object({ sha: z.string().max(40).default(""), subject: z.string().max(600), date: z.string().max(30).nullish() });
const createNoteBody = z
  .object({ text: z.string().max(200_000).optional(), commits: z.array(commitSchema).max(500).optional(), source: z.enum(["paste", "script"]).optional(), sinceRef: z.string().max(80).nullish() })
  .refine((b) => !!b.text?.trim() || !!b.commits?.length, "Paste the list of changes");
const noteItem = z.object({ id: z.string().max(40).optional(), en: z.string().max(300), ta: z.string().max(500), apps: z.array(z.string().max(4)).max(5), trades: z.array(z.string().max(30)).max(30) });
const saveNoteBody = z.object({ titleEn: z.string().max(120), titleTa: z.string().max(200), items: z.array(noteItem).max(30) });

const parse = <T>(s: z.ZodType<T>, v: unknown): T => {
  const r = s.safeParse(v ?? {});
  if (!r.success) throw badRequest(r.error.issues[0]?.message ?? "Check the form");
  return r.data;
};

/** The shop member asking. The read-only demo role is refused (it can never raise tickets); super-admins act as full access. */
export function shopActor(ctx: RequestContext, opts: { write?: boolean } = {}): { tenantId: string; actor: ShopActor } {
  const user = requireUser(ctx);
  const tenant = requireTenant(ctx);
  requireRole(ctx, "owner", "admin", "staff");
  const roles = user.tenantRoles ?? [];
  const demo = roles.includes("role:demo") || user.platformRoles.includes("demo");
  if (demo && opts.write) throw forbidden("The demo cannot contact support");
  const role = roles.find((r) => r === "owner" || r === "admin" || r === "staff") ?? null;
  return {
    tenantId: tenant.id,
    actor: { userId: user.id, name: null, role, fullAccess: isSuperAdmin(ctx) || roles.some((r) => FULL_ACCESS_ROLES.includes(r)), appId: tenant.appId },
  };
}

export interface PlatformRouteDeps {
  service: PlatformService;
  /** The requester's display name (from the auth module), stored on the ticket for the team. */
  userName?: (userId: string) => Promise<string | null>;
  limiter?: RateLimiter;
}

/** Shop routes at /v1/platform. */
export function platformShopModule(d: PlatformRouteDeps): SrModule {
  const limiter = d.limiter ?? new RateLimiter();
  const opts = { config: { audit: false as const } };
  return {
    id: "platform",
    routes: async (app: FastifyInstance) => {
      app.post("/support/tickets", opts, async (req) => {
        const { tenantId, actor } = shopActor(req.ctx, { write: true });
        limiter.check(`${tenantId}:${actor.userId}:platform:ticket`, 6, 60 * 60_000);
        const b = parse(ticketBody, req.body);
        actor.name = (await d.userName?.(actor.userId).catch(() => null)) ?? null;
        return d.service.createTicket(tenantId, actor, b);
      });
      app.get("/support/tickets", opts, async (req) => {
        const { tenantId, actor } = shopActor(req.ctx);
        return d.service.shopList(tenantId, actor);
      });
      app.get("/support/tickets/:id", opts, async (req) => {
        const { tenantId, actor } = shopActor(req.ctx);
        return d.service.shopGet(tenantId, actor, idParam.parse(req.params).id);
      });
      app.post("/support/tickets/:id/messages", opts, async (req) => {
        const { tenantId, actor } = shopActor(req.ctx, { write: true });
        limiter.check(`${tenantId}:${actor.userId}:platform:reply`, 30, 60 * 60_000);
        actor.name = (await d.userName?.(actor.userId).catch(() => null)) ?? null;
        return d.service.shopReply(tenantId, actor, idParam.parse(req.params).id, parse(messageBody, req.body).body);
      });
      app.post("/support/tickets/:id/resolve", opts, async (req) => {
        const { tenantId, actor } = shopActor(req.ctx, { write: true });
        return d.service.shopResolve(tenantId, actor, idParam.parse(req.params).id);
      });
      app.get("/badges", opts, async (req) => {
        const { tenantId, actor } = shopActor(req.ctx);
        return d.service.shopBadges(tenantId, actor);
      });
      app.get("/whats-new", opts, async (req) => {
        const { tenantId, actor } = shopActor(req.ctx);
        return d.service.whatsNew(tenantId, actor);
      });
      app.post("/whats-new/seen", opts, async (req) => {
        const { actor } = shopActor(req.ctx);
        return d.service.markWhatsNewSeen(actor.userId);
      });
    },
  };
}

const teamActor = async (ctx: RequestContext, userName?: (id: string) => Promise<string | null>): Promise<TeamActor> => {
  const u = requireSuperAdmin(ctx);
  return { userId: u.id, name: (await userName?.(u.id).catch(() => null)) ?? null };
};

/** Platform routes at /v1/admin/platform (super-admin). */
export function platformAdminModule(d: PlatformRouteDeps): SrModule {
  const limiter = d.limiter ?? new RateLimiter();
  return {
    id: "admin/platform",
    routes: async (app: FastifyInstance) => {
      app.addHook("preHandler", async (req) => {
        requireSuperAdmin(req.ctx);
      });
      // ---- churn signals
      app.get("/churn", async (req) => {
        const f = (req.query as { filter?: string } | undefined)?.filter;
        const filter: ChurnFilter = f === "snoozed" || f === "contacted" || f === "all" ? f : "at-risk";
        return d.service.churn(filter);
      });
      app.post("/churn/:tenantId/followup", async (req) => {
        const actor = await teamActor(req.ctx, d.userName);
        return d.service.followup(tenantParam.parse(req.params).tenantId, actor, parse(followupBody, req.body));
      });
      // ---- support inbox
      app.get("/support/tickets", async (req) => {
        const q = (req.query ?? {}) as Record<string, string | undefined>;
        const status = q.status === "active" || (PLATFORM_TICKET_STATUSES as readonly string[]).includes(q.status ?? "") ? (q.status as never) : undefined;
        const category = (TICKET_CATEGORIES as readonly string[]).includes(q.category ?? "") ? (q.category as never) : undefined;
        const urgency = (TICKET_URGENCIES as readonly string[]).includes(q.urgency ?? "") ? (q.urgency as never) : undefined;
        return d.service.adminTickets({ status, category, urgency, q: q.q?.slice(0, 100), limit: Number(q.limit) || 100 });
      });
      app.get("/support/tickets/:id", async (req) => d.service.adminTicket(idParam.parse(req.params).id));
      app.post("/support/tickets/:id/reply", async (req) => {
        const actor = await teamActor(req.ctx, d.userName);
        return d.service.adminReply(idParam.parse(req.params).id, actor, parse(replyBody, req.body));
      });
      app.post("/support/tickets/:id/note", async (req) => {
        const actor = await teamActor(req.ctx, d.userName);
        return d.service.adminNote(idParam.parse(req.params).id, actor, parse(messageBody, req.body).body);
      });
      app.post("/support/tickets/:id/status", async (req) => {
        const b = parse(z.object({ status: z.enum(PLATFORM_TICKET_STATUSES) }), req.body);
        return d.service.adminStatus(idParam.parse(req.params).id, b.status);
      });
      app.post("/support/tickets/:id/triage", async (req) => {
        const actor = await teamActor(req.ctx);
        limiter.check(`${actor.userId}:platform:triage`, 30, 60_000);
        await d.service.triage(idParam.parse(req.params).id);
        return d.service.adminTicket(idParam.parse(req.params).id);
      });
      app.get("/support/common", async (req) => d.service.commonProblems(Number((req.query as { weeks?: string } | undefined)?.weeks) || 8));
      // ---- What's new
      app.get("/release-notes", async () => d.service.notes());
      app.post("/release-notes", async (req) => {
        const actor = await teamActor(req.ctx);
        const b = parse(createNoteBody, req.body);
        return d.service.createNote(actor, { text: b.text, commits: b.commits?.map((c) => ({ sha: c.sha ?? "", subject: c.subject, date: c.date ?? null })), source: b.source ?? "paste", sinceRef: b.sinceRef ?? null });
      });
      app.get("/release-notes/:id", async (req) => d.service.note(idParam.parse(req.params).id));
      app.put("/release-notes/:id", async (req) => d.service.saveNote(idParam.parse(req.params).id, parse(saveNoteBody, req.body)));
      app.post("/release-notes/:id/draft", async (req) => {
        const actor = await teamActor(req.ctx);
        limiter.check(`${actor.userId}:platform:notes`, 10, 60_000);
        return d.service.draftNote(idParam.parse(req.params).id, actor);
      });
      app.post("/release-notes/:id/publish", async (req) => d.service.publishNote(idParam.parse(req.params).id, await teamActor(req.ctx)));
      app.post("/release-notes/:id/archive", async (req) => d.service.archiveNote(idParam.parse(req.params).id));
    },
  };
}


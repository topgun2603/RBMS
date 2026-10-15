import { hasPermission, requirePermission, requireRole, requireTenant, requireUser, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { WHATSAPP_FEATURE_KEYS, WHATSAPP_PERMISSION_KEYS } from "./features";
import { recipientsCsv, type WhatsAppService } from "./service";

/** What the routes use of the service (tests pass a stub). */
export type WhatsAppRouteService = Pick<
  WhatsAppService,
  | "verifyWebhook"
  | "handleWebhook"
  | "getAccount"
  | "putAccount"
  | "deleteAccount"
  | "testAccount"
  | "settingsFor"
  | "putSettings"
  | "listConversations"
  | "getConversation"
  | "startConversation"
  | "listMessages"
  | "sendText"
  | "sendMedia"
  | "sendTemplate"
  | "markRead"
  | "assign"
  | "setTags"
  | "updateContact"
  | "listTags"
  | "addNote"
  | "deleteNote"
  | "listTemplates"
  | "syncTemplates"
  | "setTemplateMapping"
  | "audienceSources"
  | "previewAudience"
  | "listCampaigns"
  | "getCampaign"
  | "createCampaign"
  | "updateCampaign"
  | "deleteCampaign"
  | "startCampaign"
  | "cancelCampaign"
  | "listRecipients"
>;

const ID = "/:id([0-9a-fA-F-]{36})";
const idParam = z.object({ id: z.string().uuid() });
const tenantParam = z.object({ tenantId: z.string().uuid() });
const body = (req: { body: unknown }) => req.body ?? {};
const query = (req: { query: unknown }) => (req.query ?? {}) as Record<string, string | undefined>;
const tid = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;
const id = (req: { params: unknown }) => idParam.parse(req.params).id;
const header = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const WEBHOOK_BODY_LIMIT = 2 * 1024 * 1024;

const base = WHATSAPP_FEATURE_KEYS.base;
const campaigns = [WHATSAPP_FEATURE_KEYS.base, WHATSAPP_FEATURE_KEYS.campaigns];
const manage = WHATSAPP_PERMISSION_KEYS.manage;

const READ = { config: { feature: base, permission: manage, audit: false as const } };
const CAMPAIGN_READ = { config: { feature: campaigns, permission: manage, audit: false as const } };
/** Inbox traffic is conversation, not shop administration: no audit entries. */
const CHAT = { config: { feature: base, permission: manage, audit: false as const } };
const write = (action: string, entity: string, feature: string | string[] = base, idParamName = "id") => ({
  config: { feature, permission: manage, audit: { action, entity, idParam: idParamName } },
});

const sendSchema = z.object({ type: z.enum(["text", "image", "document", "template"]).default("text") }).passthrough();

/**
 * Routes under /v1/whatsapp.
 * - Public (Meta): `GET /webhooks/:tenantId` (verification challenge), `POST /webhooks/:tenantId` (signed events).
 * - Owner/admin: `GET|PUT|DELETE /account`, `POST /account/test`, `PUT /settings`.
 * - Staff with `whatsapp.manage` (feature `whatsapp`): inbox, templates, `GET /settings`.
 * - Campaigns additionally need feature `whatsapp.campaigns`.
 */
export function whatsappRoutes(service: WhatsAppRouteService) {
  return async (app: FastifyInstance) => {
    // ---- Meta webhooks (no session). Raw body kept for the HMAC, in this scope only.
    await app.register(async (hooks) => {
      hooks.get("/webhooks/:tenantId", { config: { audit: false } }, async (req, reply) => {
        const { tenantId } = tenantParam.parse(req.params);
        const challenge = await service.verifyWebhook(tenantId, (req.query ?? {}) as Record<string, unknown>);
        return reply.type("text/plain; charset=utf-8").send(challenge);
      });
      hooks.removeAllContentTypeParsers();
      hooks.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: WEBHOOK_BODY_LIMIT }, (_req, raw, done) => done(null, raw));
      hooks.post("/webhooks/:tenantId", { bodyLimit: WEBHOOK_BODY_LIMIT, config: { audit: false } }, async (req) => {
        const { tenantId } = tenantParam.parse(req.params);
        const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        return service.handleWebhook(tenantId, raw, header(req.headers["x-hub-signature-256"]));
      });
    });

    // ---- owner / admin: the connection itself
    await app.register(async (owner) => {
      owner.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin");
        requireTenant(req.ctx);
      });
      owner.get("/account", { config: { feature: base, audit: false } }, async (req) => service.getAccount(tid(req)));
      owner.put("/account", { config: { feature: base, audit: { action: "whatsapp.account.update", entity: "whatsapp_account" } } }, async (req) =>
        service.putAccount(tid(req), body(req)),
      );
      owner.delete("/account", { config: { feature: base, audit: { action: "whatsapp.account.delete", entity: "whatsapp_account" } } }, async (req) => {
        await service.deleteAccount(tid(req));
        return { ok: true };
      });
      owner.post("/account/test", { config: { feature: base, audit: false } }, async (req) => service.testAccount(tid(req)));
      owner.put("/settings", { config: { feature: base, audit: { action: "whatsapp.settings.update", entity: "settings" } } }, async (req) =>
        service.putSettings(tid(req), body(req)),
      );
    });

    // ---- staff with whatsapp.manage
    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin", "staff");
        requireTenant(req.ctx);
        requirePermission(req.ctx, manage);
      });

      staff.get("/settings", READ, async (req) => service.settingsFor(tid(req)));

      // inbox
      staff.get("/conversations", READ, async (req) => service.listConversations(tid(req), query(req), req.ctx.user?.id ?? null));
      staff.post("/conversations", write("whatsapp.conversation.start", "whatsapp_contact"), async (req) => service.startConversation(tid(req), body(req)));
      staff.get(`/conversations${ID}`, READ, async (req) => service.getConversation(tid(req), id(req)));
      staff.patch(`/conversations${ID}`, write("whatsapp.contact.update", "whatsapp_contact"), async (req) => service.updateContact(tid(req), id(req), body(req)));
      staff.get(`/conversations${ID}/messages`, READ, async (req) => service.listMessages(tid(req), id(req), query(req)));
      staff.post(`/conversations${ID}/messages`, CHAT, async (req) => {
        const b = sendSchema.parse(body(req));
        const user = requireUser(req.ctx).id;
        if (b.type === "template") return service.sendTemplate(tid(req), id(req), b, user);
        if (b.type === "image" || b.type === "document") return service.sendMedia(tid(req), id(req), b, user);
        return service.sendText(tid(req), id(req), b, user);
      });
      staff.post(`/conversations${ID}/read`, CHAT, async (req) => service.markRead(tid(req), id(req)));
      staff.post(`/conversations${ID}/assign`, write("whatsapp.conversation.assign", "whatsapp_contact"), async (req) => service.assign(tid(req), id(req), body(req)));
      staff.put(`/conversations${ID}/tags`, write("whatsapp.conversation.tags", "whatsapp_contact"), async (req) => service.setTags(tid(req), id(req), body(req)));
      staff.post(`/conversations${ID}/notes`, CHAT, async (req) => service.addNote(tid(req), id(req), body(req), requireUser(req.ctx).id));
      staff.delete(`/notes${ID}`, CHAT, async (req) => {
        const canAny = req.ctx.user?.tenantRoles.some((r) => r === "owner" || r === "admin") ?? false;
        await service.deleteNote(tid(req), id(req), requireUser(req.ctx).id, canAny || hasPermission(req.ctx, "*"));
        return { ok: true };
      });
      staff.get("/tags", READ, async (req) => service.listTags(tid(req)));

      // templates
      staff.get("/templates", READ, async (req) => service.listTemplates(tid(req), { status: query(req).status }));
      staff.post("/templates/sync", write("whatsapp.templates.sync", "whatsapp_template"), async (req) => service.syncTemplates(tid(req)));
      staff.put(`/templates${ID}/mapping`, write("whatsapp.template.mapping", "whatsapp_template"), async (req) =>
        service.setTemplateMapping(tid(req), id(req), body(req)),
      );

      // campaigns
      staff.get("/campaigns/audience-sources", CAMPAIGN_READ, async (req) => service.audienceSources(tid(req)));
      staff.post("/campaigns/preview", CAMPAIGN_READ, async (req) => service.previewAudience(tid(req), body(req)));
      staff.get("/campaigns", CAMPAIGN_READ, async (req) => service.listCampaigns(tid(req), query(req)));
      staff.post("/campaigns", write("whatsapp.campaign.create", "whatsapp_campaign", campaigns), async (req) =>
        service.createCampaign(tid(req), body(req), requireUser(req.ctx).id),
      );
      staff.get(`/campaigns${ID}`, CAMPAIGN_READ, async (req) => service.getCampaign(tid(req), id(req)));
      staff.patch(`/campaigns${ID}`, write("whatsapp.campaign.update", "whatsapp_campaign", campaigns), async (req) =>
        service.updateCampaign(tid(req), id(req), body(req)),
      );
      staff.delete(`/campaigns${ID}`, write("whatsapp.campaign.delete", "whatsapp_campaign", campaigns), async (req) => {
        await service.deleteCampaign(tid(req), id(req));
        return { ok: true };
      });
      staff.post(`/campaigns${ID}/start`, write("whatsapp.campaign.start", "whatsapp_campaign", campaigns), async (req) =>
        service.startCampaign(tid(req), id(req), body(req)),
      );
      staff.post(`/campaigns${ID}/cancel`, write("whatsapp.campaign.cancel", "whatsapp_campaign", campaigns), async (req) =>
        service.cancelCampaign(tid(req), id(req)),
      );
      staff.get(`/campaigns${ID}/recipients`, CAMPAIGN_READ, async (req, reply) => {
        const q = query(req);
        if (q.format !== "csv") return service.listRecipients(tid(req), id(req), q);
        const { items } = await service.listRecipients(tid(req), id(req), { ...q, format: undefined, limit: 500, offset: 0 });
        let all = items;
        for (let offset = 500; all.length === offset && offset < 50_000; offset += 500) {
          all = all.concat((await service.listRecipients(tid(req), id(req), { status: q.status, limit: 500, offset })).items);
        }
        return reply
          .header("content-type", "text/csv; charset=utf-8")
          .header("content-disposition", `attachment; filename="whatsapp-campaign-recipients.csv"`)
          .send(recipientsCsv(all));
      });
    });
  };
}

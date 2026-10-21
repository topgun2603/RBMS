import { notFound, requirePermission, requireSuperAdmin, requireTenant, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { PlatformInvoiceListQuery, SubscriptionListQuery } from "./list";
import { BILLING_INTERVALS } from "./schema";
import { parseUntil, type Actor, type SubscriptionsService } from "./service";

export const SUBSCRIPTIONS_PERMISSION = "subscriptions.manage";

const planBody = z.object({ planId: z.string().trim().min(1).max(40), interval: z.enum(BILLING_INTERVALS).default("monthly") });
const providerSubBody = z.object({ subscriptionId: z.string().trim().min(1).max(100) });
const chargeBody = providerSubBody.extend({ amountPaise: z.number().int().positive().optional() });
const lifecycleBody = z.object({ tenantId: z.string().uuid(), now: z.string().datetime({ offset: true }).optional() });
const fileParam = z.object({ file: z.string().regex(/^[0-9a-fA-F-]{36}\.pdf$/, "Not a PDF") });
const tenantParam = z.object({ tenantId: z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });
const extendBody = z.object({ days: z.number().int().min(1).max(365) });
const compBody = z.object({ planId: z.string().trim().min(1).max(40), until: z.string().max(40).nullable().optional() });
const voidBody = z.object({ reason: z.string().trim().max(300).optional() });
const addonBody = z.object({ addonId: z.string().trim().min(1).max(40), quantity: z.number().int().min(0).max(1000) });
const addonParam = z.object({ addonId: z.string().trim().min(1).max(40) });
const tenantAddonParam = tenantParam.extend({ addonId: z.string().trim().min(1).max(40) });
const addonCompBody = z.object({ addonId: z.string().trim().min(1).max(40), quantity: z.number().int().min(1).max(1000).default(1), until: z.string().max(40).nullable().optional() });
const mockPayBody = z.object({ paymentId: z.string().trim().min(1).max(100) });
const WEBHOOK_BODY_LIMIT = 1024 * 1024;
const header = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The service records these itself (subscription.* with the shop and before/after): skip the host's generic entry. */
const SELF_AUDITED = { config: { audit: false as const } };
const actorOf = (ctx: RequestContext): Actor => ({ userId: ctx.user?.id ?? null, ip: ctx.ip, userAgent: ctx.userAgent });

function sendPdf(reply: FastifyReply, doc: { pdf: Buffer; filename: string }) {
  return reply
    .header("content-type", "application/pdf")
    .header("content-disposition", `inline; filename="${doc.filename.replace(/"/g, "")}"`)
    .header("cache-control", "private, no-store")
    .header("x-content-type-options", "nosniff")
    .send(doc.pdf);
}

/**
 * Routes under /v1/subscriptions (docs/batch5.md):
 * - shop (tenant + `subscriptions.manage`, owners/admins): GET /current, POST /change, /change/preview,
 *   /change/cancel, /checkout, /cancel, /resume,
 *   GET /invoices, GET /invoices/:id.pdf, GET /addons, POST /addons, /addons/preview, /addons/:addonId/cancel,
 *   /addons/payments/:id/cancel
 * - public: POST /webhooks/razorpay (raw body, HMAC, dedup); non-production: POST /mock/authorize, /mock/charge,
 *   /mock/fail, /mock/pay, /mock/lifecycle
 * - super-admin: /admin/subscriptions, /admin/stats, /admin/:tenantId/extend-trial, /admin/:tenantId/comp, /admin/:tenantId/addons (+ /comp, /:addonId/end),
 *   /admin/invoices, /admin/invoices/:id.pdf, /admin/invoices/:id/void
 */
export function subscriptionsRoutes(service: SubscriptionsService) {
  return async (app: FastifyInstance) => {
    // ---- shop owner / admin
    await app.register(async (shop) => {
      shop.addHook("preHandler", async (req) => {
        requireTenant(req.ctx);
        requirePermission(req.ctx, SUBSCRIPTIONS_PERMISSION);
      });
      const tenantOf = (ctx: RequestContext) => requireTenant(ctx).id;
      shop.get("/current", async (req) => service.current(tenantOf(req.ctx), req.ctx.user?.id));
      shop.post("/change", SELF_AUDITED, async (req) => service.change(tenantOf(req.ctx), planBody.parse(req.body ?? {}), actorOf(req.ctx)));
      // What a change would do and charge (credit for the unused days, amount due now with GST, when it starts).
      shop.post("/change/preview", { config: { audit: false as const } }, async (req) => service.preview(tenantOf(req.ctx), planBody.parse(req.body ?? {}), actorOf(req.ctx)));
      // Drops an upgrade that is waiting for payment.
      shop.post("/change/cancel", SELF_AUDITED, async (req) => service.cancelUpgrade(tenantOf(req.ctx), actorOf(req.ctx)));
      shop.post("/checkout", SELF_AUDITED, async (req) => service.checkout(tenantOf(req.ctx), planBody.parse(req.body ?? {}), actorOf(req.ctx)));
      shop.post("/cancel", SELF_AUDITED, async (req) => service.cancel(tenantOf(req.ctx), actorOf(req.ctx)));
      shop.post("/resume", SELF_AUDITED, async (req) => service.resume(tenantOf(req.ctx), actorOf(req.ctx)));
      shop.get("/invoices", async (req) => service.listInvoices(tenantOf(req.ctx)));
      // Add-ons: the app's catalogue for this plan, the shop's own, unpaid payments, credits and usage.
      shop.get("/addons", async (req) => service.addons(tenantOf(req.ctx)));
      shop.post("/addons/preview", { config: { audit: false as const } }, async (req) => service.addonPreview(tenantOf(req.ctx), addonBody.parse(req.body ?? {})));
      shop.post("/addons", SELF_AUDITED, async (req) => service.setAddon(tenantOf(req.ctx), addonBody.parse(req.body ?? {}), actorOf(req.ctx)));
      shop.post("/addons/:addonId/cancel", SELF_AUDITED, async (req) => service.cancelAddon(tenantOf(req.ctx), addonParam.parse(req.params).addonId, actorOf(req.ctx)));
      shop.post("/addons/payments/:id/cancel", SELF_AUDITED, async (req) => service.cancelAddonPayment(tenantOf(req.ctx), idParam.parse(req.params).id, actorOf(req.ctx)));
      shop.get("/invoices/:file", async (req, reply) => {
        const { file } = fileParam.parse(req.params);
        return sendPdf(reply, await service.invoicePdf(file.slice(0, -4), tenantOf(req.ctx)));
      });
    });

    // ---- provider webhooks: the exact bytes are needed for the HMAC, so JSON stays a raw Buffer in this scope.
    await app.register(async (hooks) => {
      hooks.removeAllContentTypeParsers();
      hooks.addContentTypeParser(["application/json", "text/plain"], { parseAs: "buffer", bodyLimit: WEBHOOK_BODY_LIMIT }, (_req, raw, done) => done(null, raw));
      hooks.post("/webhooks/razorpay", { bodyLimit: WEBHOOK_BODY_LIMIT, config: { audit: false } }, async (req) => {
        const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        return service.handleWebhook(raw, header(req.headers["x-razorpay-signature"]), header(req.headers["x-razorpay-event-id"]));
      });
    });

    // ---- mock provider (development only): plays Razorpay's part.
    if (service.allowMock && service.providerName === "mock") {
      app.post("/mock/authorize", async (req) => service.mockAuthorize(providerSubBody.parse(req.body ?? {}).subscriptionId));
      app.post("/mock/charge", async (req) => {
        const b = chargeBody.parse(req.body ?? {});
        return service.mockCharge(b.subscriptionId, { amountPaise: b.amountPaise });
      });
      app.post("/mock/fail", async (req) => service.mockFail(providerSubBody.parse(req.body ?? {}).subscriptionId));
      // Pays an add-on payment link (the shop's ?mockPay=<id> dialog).
      app.post("/mock/pay", async (req) => service.mockPay(mockPayBody.parse(req.body ?? {}).paymentId));
      // Runs the daily job for one shop with a clock override (tests; super-admin).
      app.post("/mock/lifecycle", SELF_AUDITED, async (req) => {
        requireSuperAdmin(req.ctx);
        const b = lifecycleBody.parse(req.body ?? {});
        return service.runLifecycle({ tenantId: b.tenantId, now: b.now ? new Date(b.now) : undefined });
      });
    }

    // ---- super-admin
    await app.register(async (admin) => {
      admin.addHook("preHandler", async (req) => {
        requireSuperAdmin(req.ctx);
      });
      admin.get("/admin/subscriptions", async (req) => service.adminList((req.query ?? {}) as SubscriptionListQuery));
      admin.get("/admin/stats", async () => service.adminStats());
      admin.post("/admin/:tenantId/extend-trial", SELF_AUDITED, async (req) => {
        const { tenantId } = tenantParam.parse(req.params);
        return service.extendTrial(tenantId, extendBody.parse(req.body ?? {}).days, actorOf(req.ctx));
      });
      admin.post("/admin/:tenantId/comp", SELF_AUDITED, async (req) => {
        const { tenantId } = tenantParam.parse(req.params);
        const b = compBody.parse(req.body ?? {});
        return service.comp(tenantId, { planId: b.planId, until: parseUntil(b.until) }, actorOf(req.ctx));
      });
      admin.get("/admin/:tenantId/addons", async (req) => service.adminAddons(tenantParam.parse(req.params).tenantId));
      admin.post("/admin/:tenantId/addons/comp", SELF_AUDITED, async (req) => {
        const { tenantId } = tenantParam.parse(req.params);
        const b = addonCompBody.parse(req.body ?? {});
        return service.compAddon(tenantId, { addonId: b.addonId, quantity: b.quantity, until: parseUntil(b.until) }, actorOf(req.ctx));
      });
      admin.post("/admin/:tenantId/addons/:addonId/end", SELF_AUDITED, async (req) => {
        const { tenantId, addonId } = tenantAddonParam.parse(req.params);
        return service.endAddon(tenantId, addonId, actorOf(req.ctx));
      });
      admin.get("/admin/invoices", async (req) => service.adminInvoices((req.query ?? {}) as PlatformInvoiceListQuery));
      admin.get("/admin/invoices/:file", async (req, reply) => {
        const parsed = fileParam.safeParse(req.params);
        if (!parsed.success) throw notFound("Invoice");
        return sendPdf(reply, await service.invoicePdf(parsed.data.file.slice(0, -4)));
      });
      admin.post("/admin/invoices/:id/void", SELF_AUDITED, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.voidInvoice(id, voidBody.parse(req.body ?? {}).reason ?? null, actorOf(req.ctx));
      });
    });
  };
}

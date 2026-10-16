import { notFound, requirePermission, requireSuperAdmin, requireTenant, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { BILLING_INTERVALS, SUBSCRIPTION_STATUSES } from "./schema";
import { parseUntil, type Actor, type SubscriptionsService } from "./service";

export const SUBSCRIPTIONS_PERMISSION = "subscriptions.manage";

const planBody = z.object({ planId: z.string().trim().min(1).max(40), interval: z.enum(BILLING_INTERVALS).default("monthly") });
const providerSubBody = z.object({ subscriptionId: z.string().trim().min(1).max(100) });
const chargeBody = providerSubBody.extend({ amountPaise: z.number().int().positive().optional() });
const lifecycleBody = z.object({ tenantId: z.string().uuid(), now: z.string().datetime({ offset: true }).optional() });
const fileParam = z.object({ file: z.string().regex(/^[0-9a-fA-F-]{36}\.pdf$/, "Not a PDF") });
const tenantParam = z.object({ tenantId: z.string().uuid() });
const idParam = z.object({ id: z.string().uuid() });
const adminListQuery = z.object({
  status: z.enum(SUBSCRIPTION_STATUSES).optional(),
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const invoiceListQuery = z.object({
  status: z.enum(["paid", "void"]).optional(),
  tenantId: z.string().uuid().optional(),
  q: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const extendBody = z.object({ days: z.number().int().min(1).max(365) });
const compBody = z.object({ planId: z.string().trim().min(1).max(40), until: z.string().max(40).nullable().optional() });
const voidBody = z.object({ reason: z.string().trim().max(300).optional() });
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
 *   GET /invoices, GET /invoices/:id.pdf
 * - public: POST /webhooks/razorpay (raw body, HMAC, dedup); non-production: POST /mock/authorize, /mock/charge,
 *   /mock/fail, /mock/lifecycle
 * - super-admin: /admin/subscriptions, /admin/stats, /admin/:tenantId/extend-trial, /admin/:tenantId/comp,
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
      admin.get("/admin/subscriptions", async (req) => service.adminList(adminListQuery.parse(req.query ?? {})));
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
      admin.get("/admin/invoices", async (req) => service.adminInvoices(invoiceListQuery.parse(req.query ?? {})));
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

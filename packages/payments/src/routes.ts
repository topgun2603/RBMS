import { requireRole, requireTenant } from "@rbms/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  PAYMENTS_FEATURE,
  type AccountInput,
  type CheckoutInput,
  type MockCompleteInput,
  type OrderListQuery,
  type PaymentsService,
  type VerifyInput,
} from "./service";

const tenantParam = z.object({ tenantId: z.string().uuid() });
const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
const header = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const WEBHOOK_BODY_LIMIT = 1024 * 1024;
/** Enforced by the API host for requests with a tenant; checkout also checks the paying shop itself. */
const PAYMENTS = { config: { feature: PAYMENTS_FEATURE } };

/**
 * Routes under /v1/payments. Checkout, verify, mock completion and webhooks are public;
 * account management is owner/admin; the orders list is owner/admin/staff. Secrets are never returned.
 */
export function paymentsRoutes(service: PaymentsService) {
  return async (app: FastifyInstance) => {
    // ---- public
    app.post("/checkout", PAYMENTS, async (req) => service.checkout(body(req) as CheckoutInput));
    app.post("/verify", async (req) => service.verify(body(req) as VerifyInput));
    if (service.allowMock) {
      app.post("/mock/complete", async (req) => service.mockComplete(body(req) as MockCompleteInput));
    }

    // Webhooks need the exact bytes for the HMAC, so JSON is kept as a raw Buffer in this scope only.
    await app.register(async (hooks) => {
      hooks.removeAllContentTypeParsers();
      hooks.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: WEBHOOK_BODY_LIMIT }, (_req, raw, done) =>
        done(null, raw),
      );
      hooks.post("/webhooks/razorpay/:tenantId", { bodyLimit: WEBHOOK_BODY_LIMIT }, async (req) => {
        const { tenantId } = tenantParam.parse(req.params);
        const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
        return service.handleWebhook(
          tenantId,
          raw,
          header(req.headers["x-razorpay-signature"]),
          header(req.headers["x-razorpay-event-id"]),
        );
      });
    });

    // ---- owner/admin
    await app.register(async (owner) => {
      owner.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin");
        requireTenant(req.ctx);
      });
      owner.get("/account", PAYMENTS, async (req) => service.getAccount(requireTenant(req.ctx).id));
      owner.put("/account", PAYMENTS, async (req) => service.putAccount(requireTenant(req.ctx).id, body(req) as AccountInput));
      owner.delete("/account", PAYMENTS, async (req) => {
        await service.deleteAccount(requireTenant(req.ctx).id);
        return { ok: true };
      });
    });

    // ---- staff
    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin", "staff");
        requireTenant(req.ctx);
      });
      staff.get("/orders", PAYMENTS, async (req) => service.listOrders(requireTenant(req.ctx).id, req.query as OrderListQuery));
    });
  };
}

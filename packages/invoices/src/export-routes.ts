import { CURRENCIES, COUNTRIES, formatForeign } from "@srirealtime/gst";
import { requireRole, requireTenant, requireUser } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ForeignPaymentRequest } from "./export-calc";
import type { InvoicesService } from "./service";

const idParam = z.object({ id: z.string().uuid() });
const ID = "/:id([0-9a-fA-F-]{36})";

/**
 * Routes under /v1/export-billing (docs/recurring-export-gstin.md): the currency and country lists, and a payment
 * received in a bill's foreign currency at the bank's rate (`payments.receive`, attached by apps/api permissions.ts).
 * Export bills themselves are ordinary bills (`supplyType`, `foreign`, `exportDetails` on POST/PATCH /v1/invoices).
 */
export function exportBillingRoutes(service: InvoicesService) {
  return async (app: FastifyInstance) => {
    app.addHook("preHandler", async (req) => {
      requireRole(req.ctx, "owner", "admin", "staff");
      requireTenant(req.ctx);
    });
    app.get("/currencies", async () => ({ items: CURRENCIES }));
    app.get("/countries", async () => ({ items: COUNTRIES }));
    app.post(`/invoices${ID}/payments`, { config: { audit: { action: "invoices.payment.foreign", entity: "invoice" } } }, async (req) => {
      const body = (req.body ?? {}) as ForeignPaymentRequest;
      const inv = await service.addForeignPayment(requireTenant(req.ctx).id, idParam.parse(req.params).id, body, requireUser(req.ctx).id);
      const p = inv.payments[inv.payments.length - 1];
      req.auditSummary = `Payment of ${p?.foreign ? formatForeign(p.foreign.amount, p.foreign.currency) : ""} at ${p?.foreign?.rate ?? ""} on ${inv.number ?? "bill"}`;
      return inv;
    });
  };
}

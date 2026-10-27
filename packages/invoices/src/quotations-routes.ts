import { formatINR } from "@srirealtime/gst";
import { requireRole, requireTenant, requireUser } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  QUOTATIONS_FEATURE,
  quotationListQuerySchema,
  type QuotationConvertInput,
  type QuotationInput,
  type QuotationListQuery,
  type QuotationRespondInput,
  type QuotationSendInput,
  type QuotationsService,
} from "./quotations";

const idParam = z.object({ id: z.string().uuid() });
const tokenParam = z.object({ token: z.string().min(1).max(128) });
const targetQuery = z.object({ targetId: z.string().uuid() });
const cancelBody = z.object({ reason: z.string().max(500).nullish() });
/** Quotation routes only match UUID-shaped ids, so "summary" and friends are never read as an id. */
const QID = "/:id([0-9a-fA-F-]{36})";

const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
const feature = { config: { feature: QUOTATIONS_FEATURE } };
const audited = (action: string) => ({ config: { feature: QUOTATIONS_FEATURE, audit: { action, entity: "quotation" } } });

/**
 * Routes under /v1/quotations. The /public/* pages need no sign-in (the share token names the shop); everything else
 * needs an owner, admin or staff member. Permissions (quotations.view / quotations.manage) are attached by the API
 * host (apps/api permissions.ts); the feature `invoices.quotations` is enforced for every route.
 */
export function quotationsRoutes(service: QuotationsService) {
  return async (app: FastifyInstance) => {
    // ---- public
    app.get("/public/:token", feature, async (req) => {
      const { token } = tokenParam.parse(req.params);
      return service.getPublic(token, req.ctx?.tenant?.id ?? null);
    });
    app.post("/public/:token/respond", feature, async (req) => {
      const { token } = tokenParam.parse(req.params);
      return service.respond(token, body(req) as unknown as QuotationRespondInput, req.ctx?.tenant?.id ?? null);
    });

    // ---- staff
    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin", "staff");
        requireTenant(req.ctx);
      });

      staff.get("/", feature, async (req) => service.list(requireTenant(req.ctx).id, quotationListQuerySchema.parse(req.query ?? {}) as QuotationListQuery));
      staff.get("/summary", feature, async (req) => service.summary(requireTenant(req.ctx).id));
      staff.get("/linked", feature, async (req) => {
        const { targetId } = targetQuery.parse(req.query ?? {});
        return { quotation: await service.forTarget(requireTenant(req.ctx).id, targetId) };
      });
      staff.get("/settings", feature, async (req) => service.settings(requireTenant(req.ctx).id));

      staff.post("/", audited("quotations.create"), async (req) => {
        const user = requireUser(req.ctx);
        const q = await service.create(requireTenant(req.ctx), body(req) as QuotationInput, { branchId: req.ctx.branch?.id ?? null, userId: user.id });
        req.auditSummary = `Quotation ${q.number} created for ${q.customer.name}: ${formatINR(q.total)}`;
        req.auditDetail = { entityId: q.id };
        return q;
      });
      staff.get(QID, feature, async (req) => {
        const { id } = idParam.parse(req.params);
        return service.get(requireTenant(req.ctx).id, id);
      });
      staff.patch(QID, audited("quotations.update"), async (req) => {
        const { id } = idParam.parse(req.params);
        const q = await service.update(requireTenant(req.ctx), id, body(req) as Partial<QuotationInput>);
        req.auditSummary = `Quotation ${q.number} edited: ${formatINR(q.total)}`;
        return q;
      });
      staff.post(`${QID}/revise`, audited("quotations.revise"), async (req) => {
        const { id } = idParam.parse(req.params);
        const user = requireUser(req.ctx);
        const q = await service.revise(requireTenant(req.ctx), id, body(req) as Partial<QuotationInput>, user.id);
        req.auditSummary = `Quotation ${q.number} revised (rev ${q.rev}): ${formatINR(q.total)}`;
        req.auditDetail = { entityId: q.id };
        return q;
      });
      staff.post(`${QID}/duplicate`, audited("quotations.duplicate"), async (req) => {
        const { id } = idParam.parse(req.params);
        const user = requireUser(req.ctx);
        const q = await service.duplicate(requireTenant(req.ctx), id, { branchId: req.ctx.branch?.id ?? null, userId: user.id });
        req.auditSummary = `Quotation ${q.number} created as a copy`;
        req.auditDetail = { entityId: q.id };
        return q;
      });
      staff.post(`${QID}/cancel`, audited("quotations.cancel"), async (req) => {
        const { id } = idParam.parse(req.params);
        const { reason } = cancelBody.parse(req.body ?? {});
        const user = requireUser(req.ctx);
        const q = await service.cancel(requireTenant(req.ctx).id, id, reason, user.id);
        req.auditSummary = `Quotation ${q.number} cancelled${reason ? `: ${reason}` : ""}`;
        return q;
      });
      staff.post(`${QID}/share`, audited("quotations.share"), async (req) => {
        const { id } = idParam.parse(req.params);
        const user = requireUser(req.ctx);
        const r = await service.share(requireTenant(req.ctx).id, id, user.id);
        req.auditSummary = `Quotation ${r.quotation.number} shared by link`;
        return r;
      });
      staff.post(`${QID}/send`, audited("quotations.send"), async (req) => {
        const { id } = idParam.parse(req.params);
        const user = requireUser(req.ctx);
        const r = await service.send(requireTenant(req.ctx).id, id, body(req) as QuotationSendInput, user.id);
        req.auditSummary = `Quotation ${r.quotation.number} sent on ${(body(req).channel as string | undefined) ?? "whatsapp"}`;
        return r;
      });
      staff.post(`${QID}/convert`, audited("quotations.convert"), async (req) => {
        const { id } = idParam.parse(req.params);
        const user = requireUser(req.ctx);
        const r = await service.convert(requireTenant(req.ctx), id, body(req) as QuotationConvertInput, { userId: user.id, branchId: req.ctx.branch?.id ?? null });
        const to = r.invoice
          ? `bill ${r.invoice.number ?? "(draft)"}`
          : r.salesDoc
            ? `${r.salesDoc.kind === "proforma" ? "proforma invoice" : "sale order"} ${r.salesDoc.number}`
            : `order ${r.order?.number ?? ""}`;
        req.auditSummary = `Quotation ${r.quotation.number} converted to ${to}${r.advanceRecorded ? ` with advance ${formatINR(r.advanceRecorded)}` : ""}`;
        return r;
      });
    });
  };
}

import { formatINR } from "@srirealtime/gst";
import { requireRole, requireTenant, requireUser } from "@srirealtime/core";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { ChallanInput, ChallanInvoiceInput, ChallanListQuery, ChallanPatch, ChallanReturnInput, OrderChallanInput } from "./challans";
import type { ProformaConvertInput, ProformaInput, ProformaListQuery } from "./proformas";
import type { SaleOrderInput, SaleOrderInvoiceInput, SaleOrderListQuery } from "./sale-orders";
import { SALES_DOCS_FEATURE, type AdvanceInput, type SalesDocSendInput } from "./sales-docs-base";
import type { SalesDocsService } from "./sales-docs";

const idParam = z.object({ id: z.string().uuid() });
const tokenParam = z.object({ token: z.string().min(1).max(128) });
const targetQuery = z.object({ targetId: z.string().uuid() });
const cancelBody = z.object({ reason: z.string().max(500).nullish() });
/** Only UUID-shaped ids, so "invoice" and friends are never read as an id. */
const ID = "/:id([0-9a-fA-F-]{36})";

const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
const feature = { config: { feature: SALES_DOCS_FEATURE } };
const audited = (action: string, entity: string) => ({ config: { feature: SALES_DOCS_FEATURE, audit: { action, entity } } });

/**
 * Routes under /v1/sales-docs (docs/sales-documents.md). `GET /public/:token` needs no sign-in (the share token names
 * the shop); everything else needs an owner, admin or staff member. Permissions (sales-docs.view / sales-docs.manage,
 * plus invoices.create to bill and payments.receive for advances) are attached by the API host (apps/api permissions.ts).
 */
export function salesDocsRoutes(service: SalesDocsService) {
  const { proformas, saleOrders, challans } = service;
  return async (app: FastifyInstance) => {
    app.get("/public/:token", feature, async (req) => {
      const { token } = tokenParam.parse(req.params);
      return service.getPublic(token, req.ctx?.tenant?.id ?? null);
    });

    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin", "staff");
        requireTenant(req.ctx);
      });
      const ctxOf = (req: FastifyRequest) => ({ userId: requireUser(req.ctx).id, branchId: req.ctx.branch?.id ?? null });

      staff.get("/summary", feature, async (req) => service.summary(requireTenant(req.ctx).id));
      staff.get("/settings", feature, async (req) => service.settings(requireTenant(req.ctx).id));
      staff.get("/linked", feature, async (req) => {
        const { targetId } = targetQuery.parse(req.query ?? {});
        return service.linked(requireTenant(req.ctx).id, targetId);
      });

      // ---- proforma invoices
      staff.get("/proformas", feature, async (req) => proformas.list(requireTenant(req.ctx).id, (req.query ?? {}) as ProformaListQuery));
      staff.post("/proformas", audited("sales-docs.proforma.create", "proforma"), async (req) => {
        const c = ctxOf(req);
        const p = await proformas.create(requireTenant(req.ctx), body(req) as ProformaInput, c);
        req.auditSummary = `Proforma ${p.number} made for ${p.customer.name}: ${formatINR(p.total)}`;
        req.auditDetail = { entityId: p.id };
        return p;
      });
      staff.get(`/proformas${ID}`, feature, async (req) => proformas.get(requireTenant(req.ctx).id, idParam.parse(req.params).id));
      staff.patch(`/proformas${ID}`, audited("sales-docs.proforma.update", "proforma"), async (req) => {
        const p = await proformas.update(requireTenant(req.ctx), idParam.parse(req.params).id, body(req) as Partial<ProformaInput>, requireUser(req.ctx).id);
        req.auditSummary = `Proforma ${p.number} edited: ${formatINR(p.total)}`;
        return p;
      });
      staff.post(`/proformas${ID}/issue`, audited("sales-docs.proforma.issue", "proforma"), async (req) => {
        const p = await proformas.issue(requireTenant(req.ctx).id, idParam.parse(req.params).id, requireUser(req.ctx).id);
        req.auditSummary = `Proforma ${p.number} issued`;
        return p;
      });
      staff.post(`/proformas${ID}/cancel`, audited("sales-docs.proforma.cancel", "proforma"), async (req) => {
        const { reason } = cancelBody.parse(req.body ?? {});
        const p = await proformas.cancel(requireTenant(req.ctx).id, idParam.parse(req.params).id, reason, requireUser(req.ctx).id);
        req.auditSummary = `Proforma ${p.number} cancelled${reason ? `: ${reason}` : ""}`;
        return p;
      });
      staff.post(`/proformas${ID}/share`, audited("sales-docs.proforma.share", "proforma"), async (req) => {
        const r = await proformas.share(requireTenant(req.ctx).id, idParam.parse(req.params).id, requireUser(req.ctx).id);
        req.auditSummary = `Proforma ${r.proforma.number} shared by link`;
        return r;
      });
      staff.post(`/proformas${ID}/send`, audited("sales-docs.proforma.send", "proforma"), async (req) => {
        const r = await proformas.send(requireTenant(req.ctx).id, idParam.parse(req.params).id, body(req) as SalesDocSendInput, requireUser(req.ctx).id);
        req.auditSummary = `Proforma ${r.proforma.number} sent on ${(body(req).channel as string | undefined) ?? "whatsapp"}`;
        return r;
      });
      staff.post(`/proformas${ID}/advance`, audited("sales-docs.proforma.advance", "proforma"), async (req) => {
        const p = await proformas.recordAdvance(requireTenant(req.ctx).id, idParam.parse(req.params).id, body(req) as AdvanceInput, requireUser(req.ctx).id);
        req.auditSummary = `Advance ${formatINR(Number(body(req).amount ?? 0))} against proforma ${p.number}`;
        return p;
      });
      staff.post(`/proformas${ID}/convert`, audited("sales-docs.proforma.convert", "proforma"), async (req) => {
        const r = await proformas.convert(requireTenant(req.ctx), idParam.parse(req.params).id, body(req) as ProformaConvertInput, ctxOf(req));
        req.auditSummary = `Proforma ${r.proforma.number} billed: ${r.invoice.number ?? "draft bill"}${r.advanceApplied ? ` with advance ${formatINR(r.advanceApplied)}` : ""}`;
        return r;
      });

      // ---- sale orders
      staff.get("/sale-orders", feature, async (req) => saleOrders.list(requireTenant(req.ctx).id, (req.query ?? {}) as SaleOrderListQuery));
      staff.post("/sale-orders", audited("sales-docs.sale-order.create", "sale_order"), async (req) => {
        const o = await saleOrders.create(requireTenant(req.ctx), body(req) as SaleOrderInput, ctxOf(req));
        req.auditSummary = `Sale order ${o.number} made for ${o.customer.name}: ${formatINR(o.total)}`;
        req.auditDetail = { entityId: o.id };
        return o;
      });
      staff.get(`/sale-orders${ID}`, feature, async (req) => saleOrders.get(requireTenant(req.ctx).id, idParam.parse(req.params).id));
      staff.patch(`/sale-orders${ID}`, audited("sales-docs.sale-order.update", "sale_order"), async (req) => {
        const o = await saleOrders.update(requireTenant(req.ctx), idParam.parse(req.params).id, body(req) as Partial<SaleOrderInput>, requireUser(req.ctx).id);
        req.auditSummary = `Sale order ${o.number} edited`;
        return o;
      });
      staff.post(`/sale-orders${ID}/cancel`, audited("sales-docs.sale-order.cancel", "sale_order"), async (req) => {
        const { reason } = cancelBody.parse(req.body ?? {});
        const o = await saleOrders.cancel(requireTenant(req.ctx).id, idParam.parse(req.params).id, reason, requireUser(req.ctx).id);
        req.auditSummary = `Sale order ${o.number} cancelled${reason ? `: ${reason}` : ""}`;
        return o;
      });
      staff.post(`/sale-orders${ID}/share`, audited("sales-docs.sale-order.share", "sale_order"), async (req) => {
        const r = await saleOrders.share(requireTenant(req.ctx).id, idParam.parse(req.params).id, requireUser(req.ctx).id);
        req.auditSummary = `Sale order ${r.order.number} shared by link`;
        return r;
      });
      staff.post(`/sale-orders${ID}/send`, audited("sales-docs.sale-order.send", "sale_order"), async (req) => {
        const r = await saleOrders.send(requireTenant(req.ctx).id, idParam.parse(req.params).id, body(req) as SalesDocSendInput, requireUser(req.ctx).id);
        req.auditSummary = `Sale order ${r.order.number} sent on ${(body(req).channel as string | undefined) ?? "whatsapp"}`;
        return r;
      });
      staff.post(`/sale-orders${ID}/advance`, audited("sales-docs.sale-order.advance", "sale_order"), async (req) => {
        const o = await saleOrders.recordAdvance(requireTenant(req.ctx).id, idParam.parse(req.params).id, body(req) as AdvanceInput, requireUser(req.ctx).id);
        req.auditSummary = `Advance ${formatINR(Number(body(req).amount ?? 0))} against sale order ${o.number}`;
        return o;
      });
      staff.post(`/sale-orders${ID}/deliver`, audited("sales-docs.sale-order.deliver", "sale_order"), async (req) => {
        const r = await saleOrders.deliver(requireTenant(req.ctx), idParam.parse(req.params).id, body(req) as OrderChallanInput, requireUser(req.ctx).id);
        req.auditSummary = `Sale order ${r.order.number}: challan ${r.challan.number}`;
        return r;
      });
      staff.post(`/sale-orders${ID}/invoice`, audited("sales-docs.sale-order.invoice", "sale_order"), async (req) => {
        const r = await saleOrders.invoice(requireTenant(req.ctx), idParam.parse(req.params).id, body(req) as SaleOrderInvoiceInput, ctxOf(req));
        req.auditSummary = `Sale order ${r.order.number} billed: ${r.invoice.number ?? "draft bill"}`;
        return r;
      });
      staff.post(`/sale-orders${ID}/invoice-challans`, audited("sales-docs.sale-order.invoice", "sale_order"), async (req) => {
        const b = z.object({ challanIds: z.array(z.string().uuid()).max(50).optional(), issue: z.boolean().optional() }).parse(req.body ?? {});
        const r = await saleOrders.invoiceChallans(requireTenant(req.ctx), idParam.parse(req.params).id, b, ctxOf(req));
        req.auditSummary = `Sale order ${r.order.number}: delivered challans billed in ${r.invoice.number ?? "a draft bill"}`;
        return r;
      });

      // ---- delivery challans
      staff.get("/challans", feature, async (req) => challans.list(requireTenant(req.ctx).id, (req.query ?? {}) as ChallanListQuery));
      staff.post("/challans", audited("sales-docs.challan.create", "challan"), async (req) => {
        const c = await challans.create(requireTenant(req.ctx), body(req) as ChallanInput, ctxOf(req));
        req.auditSummary = `Delivery challan ${c.number} (${c.reason}) for ${c.customer.name}: ${formatINR(c.total)}`;
        req.auditDetail = { entityId: c.id };
        return c;
      });
      staff.post("/challans/invoice", audited("sales-docs.challan.invoice", "challan"), async (req) => {
        const r = await challans.invoice(requireTenant(req.ctx), body(req) as ChallanInvoiceInput, ctxOf(req));
        req.auditSummary = `Challans ${r.challans.map((c) => c.number).join(", ")} billed in ${r.invoice.number ?? "a draft bill"}`;
        return r;
      });
      staff.get(`/challans${ID}`, feature, async (req) => challans.get(requireTenant(req.ctx).id, idParam.parse(req.params).id));
      staff.patch(`/challans${ID}`, audited("sales-docs.challan.update", "challan"), async (req) => {
        const c = await challans.update(requireTenant(req.ctx).id, idParam.parse(req.params).id, body(req) as ChallanPatch, requireUser(req.ctx).id);
        req.auditSummary = `Delivery challan ${c.number} edited`;
        return c;
      });
      staff.post(`/challans${ID}/return`, audited("sales-docs.challan.return", "challan"), async (req) => {
        const c = await challans.recordReturn(requireTenant(req.ctx).id, idParam.parse(req.params).id, body(req) as ChallanReturnInput, requireUser(req.ctx).id);
        req.auditSummary = `Goods back on delivery challan ${c.number}`;
        return c;
      });
      staff.post(`/challans${ID}/cancel`, audited("sales-docs.challan.cancel", "challan"), async (req) => {
        const { reason } = cancelBody.parse(req.body ?? {});
        const c = await challans.cancel(requireTenant(req.ctx).id, idParam.parse(req.params).id, reason, requireUser(req.ctx).id);
        req.auditSummary = `Delivery challan ${c.number} cancelled${reason ? `: ${reason}` : ""}`;
        return c;
      });
      staff.post(`/challans${ID}/share`, audited("sales-docs.challan.share", "challan"), async (req) => {
        const r = await challans.share(requireTenant(req.ctx).id, idParam.parse(req.params).id, requireUser(req.ctx).id);
        req.auditSummary = `Delivery challan ${r.challan.number} shared by link`;
        return r;
      });
      staff.post(`/challans${ID}/send`, audited("sales-docs.challan.send", "challan"), async (req) => {
        const r = await challans.send(requireTenant(req.ctx).id, idParam.parse(req.params).id, body(req) as SalesDocSendInput, requireUser(req.ctx).id);
        req.auditSummary = `Delivery challan ${r.challan.number} sent on ${(body(req).channel as string | undefined) ?? "whatsapp"}`;
        return r;
      });
    });
  };
}

import { requirePermission, requireRole, requireTenant, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { EINVOICE_FEATURE, EINVOICE_PERMISSION, EWAYBILL_FEATURE } from "./features";
import type { AccountInput, CancelInput, EInvoiceService, EwbRequestInput } from "./service";

const invoiceParam = z.object({ invoiceId: z.string().uuid() });
const periodQuery = z.object({
  period: z.string().regex(/^(0[1-9]|1[0-2])\d{4}$/, "Use MMYYYY"),
  /** GSTR-1 is per GSTIN (branches in other states have their own); default: the account's / the most used one. */
  gstin: z.string().trim().toUpperCase().length(15).optional(),
});
const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
const tenantOf = (req: { ctx: RequestContext }) => requireTenant(req.ctx).id;

const read = (feature: string) => ({ config: { feature } });
const manage = (feature: string, audit?: { action: string; entity: string; idParam?: string } | false) => ({
  config: { feature, permission: EINVOICE_PERMISSION, ...(audit !== undefined ? { audit } : {}) },
});

/**
 * Routes under /v1/einvoice (staff: owner/admin/staff; writes, account and exports need `einvoice.manage`).
 * - Account: `GET/PUT/DELETE /account`
 * - Per bill: `GET /invoices/:invoiceId` (status + history), `GET /invoices/:invoiceId/preview` (NIC JSON + issues),
 *   `POST /invoices/:invoiceId/irn`, `POST /invoices/:invoiceId/irn/cancel`, `POST /invoices/:invoiceId/ewb`,
 *   `POST /invoices/:invoiceId/ewb/cancel`
 * - GSTR-1: `GET /gstr1.json?period=MMYYYY` (the file), `GET /gstr1?period=MMYYYY` (`{ json, warnings, counts }`)
 */
export function einvoiceRoutes(service: EInvoiceService) {
  return async (app: FastifyInstance) => {
    await app.register(async (staff) => {
      staff.addHook("preHandler", async (req) => {
        requireRole(req.ctx, "owner", "admin", "staff");
        requireTenant(req.ctx);
        // The host checks config.permission too; repeated so the module is safe on its own.
        const p = req.routeOptions.config?.permission;
        if (p) requirePermission(req.ctx, ...(Array.isArray(p) ? p : [p]));
      });

      staff.get("/account", manage(EINVOICE_FEATURE), async (req) => service.getAccount(tenantOf(req)));
      staff.put("/account", manage(EINVOICE_FEATURE, { action: "einvoice.account.save", entity: "einvoice_account" }), async (req) =>
        service.putAccount(tenantOf(req), body(req) as AccountInput),
      );
      staff.delete("/account", manage(EINVOICE_FEATURE, { action: "einvoice.account.delete", entity: "einvoice_account" }), async (req) => {
        await service.deleteAccount(tenantOf(req));
        return { ok: true };
      });

      staff.get("/invoices/:invoiceId", read(EINVOICE_FEATURE), async (req) => {
        const { invoiceId } = invoiceParam.parse(req.params);
        return service.status(tenantOf(req), invoiceId);
      });
      staff.get("/invoices/:invoiceId/preview", manage(EINVOICE_FEATURE), async (req) => {
        const { invoiceId } = invoiceParam.parse(req.params);
        return service.preview(tenantOf(req), invoiceId);
      });
      staff.post(
        "/invoices/:invoiceId/irn",
        manage(EINVOICE_FEATURE, { action: "einvoice.irn.generate", entity: "invoice", idParam: "invoiceId" }),
        async (req) => {
          const { invoiceId } = invoiceParam.parse(req.params);
          const res = await service.generateIrn(tenantOf(req), invoiceId);
          req.auditSummary = `IRN ${res.alreadyGenerated ? "already generated" : "generated"} for ${res.record.docNo}`;
          return res;
        },
      );
      staff.post(
        "/invoices/:invoiceId/irn/cancel",
        manage(EINVOICE_FEATURE, { action: "einvoice.irn.cancel", entity: "invoice", idParam: "invoiceId" }),
        async (req) => {
          const { invoiceId } = invoiceParam.parse(req.params);
          const rec = await service.cancelIrn(tenantOf(req), invoiceId, body(req) as CancelInput);
          req.auditSummary = `IRN cancelled for ${rec.docNo} (reason ${rec.cancelReason})`;
          return rec;
        },
      );
      staff.post(
        "/invoices/:invoiceId/ewb",
        manage(EWAYBILL_FEATURE, { action: "einvoice.ewb.generate", entity: "invoice", idParam: "invoiceId" }),
        async (req) => {
          const { invoiceId } = invoiceParam.parse(req.params);
          const res = await service.generateEwb(tenantOf(req), invoiceId, body(req) as EwbRequestInput);
          req.auditSummary = `E-way bill ${res.record.ewbNo} for ${res.record.docNo}`;
          return res;
        },
      );
      staff.post(
        "/invoices/:invoiceId/ewb/cancel",
        manage(EWAYBILL_FEATURE, { action: "einvoice.ewb.cancel", entity: "invoice", idParam: "invoiceId" }),
        async (req) => {
          const { invoiceId } = invoiceParam.parse(req.params);
          const rec = await service.cancelEwb(tenantOf(req), invoiceId, body(req) as CancelInput);
          req.auditSummary = `E-way bill ${rec.ewbNo} cancelled`;
          return rec;
        },
      );

      staff.get("/gstr1.json", manage(EINVOICE_FEATURE), async (req, reply) => {
        const { period, gstin } = periodQuery.parse(req.query ?? {});
        const res = await service.gstr1(tenantOf(req), period, { gstin });
        reply.header("content-disposition", `attachment; filename="${res.filename}"`);
        reply.header("x-gstr1-warnings", String(res.warnings.length));
        return res.json;
      });
      staff.get("/gstr1", manage(EINVOICE_FEATURE), async (req) => {
        const { period, gstin } = periodQuery.parse(req.query ?? {});
        return service.gstr1(tenantOf(req), period, { gstin });
      });
    });
  };
}

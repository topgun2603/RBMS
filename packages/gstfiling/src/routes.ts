import { badRequest, requirePermission, requireRole, requireTenant, requireUser, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { RCM_CATEGORIES } from "./rcm-categories";
import { GST_FILING_FEATURE, GST_MANAGE_PERMISSION, GST_VIEW_PERMISSION } from "./features";
import type { GstFilingService } from "./service";
import { Gstr2bService } from "./service-2b";
import { readWorkbook, XlsxError } from "./xlsx";

const view = { config: { feature: GST_FILING_FEATURE, permission: GST_VIEW_PERMISSION } };
const manage = { config: { feature: GST_FILING_FEATURE, permission: GST_MANAGE_PERMISSION } };
const UPLOAD_TYPES = ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream"];
const MAX_UPLOAD = 12 * 1024 * 1024;

const ID = "[0-9a-fA-F-]{36}";
async function periodQueryIssues(service: GstFilingService, tenantId: string, period: string | undefined) {
  if (!period) throw badRequest("Say which month or quarter: period=YYYY-MM or period=YYYY-Qn");
  return service.periodIssues(tenantId, period);
}
const q = (req: { query: unknown }) => (req.query ?? {}) as Record<string, string | undefined>;

function file(reply: FastifyReply, name: string, type: string, body: string) {
  return reply.header("content-type", `${type}; charset=utf-8`).header("content-disposition", `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, "_")}"`).send(body);
}

/**
 * Routes under /v1/gstfiling (feature `invoices.gst-reports`; reading needs `reports.view`, changes `gst.manage`):
 * - `GET /overview` (calendar + issues), `GET|PUT /settings`, `GET /rcm-categories`
 * - GSTR-1: `GET /gstr1?period=MMYYYY|quarter=YYYY-Qn`, `/gstr1.json`, `/gstr1/issues.csv`
 * - GSTR-3B: `GET /gstr3b?period=YYYY-MM|YYYY-Qn`, `/gstr3b.json`, `/gstr3b.csv`, `/gstr3b/cell?period=&cell=`
 * - ITC register: `GET /itc`, `/itc.csv`, `PUT /itc/:docType/:docId`; reverse charge: `GET /rcm`
 * - GSTR-2B: `GET /gstr2b/imports`, `POST /gstr2b/import`, `GET /gstr2b/:month`, `/rows`, `/suppliers`, `/export.csv`,
 *   `POST /gstr2b/:month/rematch`, `POST /gstr2b/rows/:id/action`, `DELETE /gstr2b/:month`
 * - Composition: `GET /cmp08?quarter=`, `/cmp08.csv`, `/gstr4?fy=`; payments `GET|POST|DELETE /payments`
 * - Typed-in figures: `/adjustments`, `/advances`; filing marks: `GET|PUT /filings`, `DELETE /filings/:type/:period`
 */
export function gstFilingRoutes(service: GstFilingService, reco: Gstr2bService) {
  return async (app: FastifyInstance) => {
    const guard = (ctx: RequestContext, write: boolean) => {
      requireRole(ctx, "owner", "admin", "staff");
      requireTenant(ctx);
      requirePermission(ctx, write ? GST_MANAGE_PERMISSION : GST_VIEW_PERMISSION);
      return requireTenant(ctx).id;
    };
    const userId = (ctx: RequestContext) => requireUser(ctx).id;
    const month = (v: string | undefined) => {
      if (!v || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw badRequest("Use a month as YYYY-MM");
      return v;
    };

    app.get("/overview", view, async (req) => service.overview(guard(req.ctx, false)));
    app.get("/issues", view, async (req) => periodQueryIssues(service, guard(req.ctx, false), q(req).period));
    app.get("/settings", view, async (req) => ({ config: await service.getConfig(guard(req.ctx, false)), rcmCategories: RCM_CATEGORIES }));
    app.put("/settings", manage, async (req) => ({ config: await service.saveConfig(guard(req.ctx, true), req.body) }));
    app.get("/composition/preview", view, async (req) => service.compositionPreview(guard(req.ctx, false), q(req).from ?? ""));
    app.get("/rcm-categories", view, async (req) => {
      guard(req.ctx, false);
      return { items: RCM_CATEGORIES };
    });

    // ---- GSTR-1
    const gstr1Query = (req: { query: unknown }) => {
      const v = q(req);
      return { period: v.period, quarter: v.quarter, gstin: v.gstin };
    };
    app.get("/gstr1", view, async (req) => service.gstr1(guard(req.ctx, false), gstr1Query(req)));
    app.get("/gstr1.json", view, async (req, reply) => {
      const res = await service.gstr1(guard(req.ctx, false), gstr1Query(req));
      reply.header("content-disposition", `attachment; filename="${res.filename}"`);
      reply.header("x-gstr1-errors", String(res.issues.filter((i) => i.severity === "error").length));
      return res.json;
    });
    app.get("/gstr1/issues.csv", view, async (req, reply) => {
      const res = await service.gstr1(guard(req.ctx, false), gstr1Query(req));
      return file(reply, `GSTR1_issues_${res.period.key}.csv`, "text/csv", service.gstr1IssuesCsv(res.issues));
    });

    // ---- GSTR-3B
    const periodOf = (req: { query: unknown }) => {
      const v = q(req).period ?? q(req).month ?? q(req).quarter;
      if (!v) throw badRequest("Say which month or quarter: period=YYYY-MM or period=YYYY-Qn");
      return v;
    };
    app.get("/gstr3b", view, async (req) => service.gstr3b(guard(req.ctx, false), periodOf(req)));
    app.get("/gstr3b.json", view, async (req, reply) => {
      const res = await service.gstr3b(guard(req.ctx, false), periodOf(req));
      reply.header("content-disposition", `attachment; filename="${res.filename}"`);
      return res.json;
    });
    app.get("/gstr3b.csv", view, async (req, reply) => {
      const res = await service.gstr3b(guard(req.ctx, false), periodOf(req));
      return file(reply, `GSTR3B_${res.period.key}.csv`, "text/csv", service.gstr3bCsv(res));
    });
    app.get("/gstr3b/cell", view, async (req) => {
      const v = q(req);
      return service.gstr3bCell(guard(req.ctx, false), periodOf(req), v.cell ?? "", Number(v.limit) || 500);
    });

    // ---- ITC register, flags, reverse charge
    app.get("/itc", view, async (req) => {
      const v = q(req);
      return service.itcRegister(guard(req.ctx, false), { ...v, limit: v.limit ? Number(v.limit) : undefined, offset: v.offset ? Number(v.offset) : undefined });
    });
    app.get("/itc.csv", view, async (req, reply) => {
      const v = q(req);
      const res = await service.itcRegister(guard(req.ctx, false), { ...v, limit: 500, offset: 0 });
      return file(reply, `ITC_register_${v.month ?? "range"}.csv`, "text/csv", service.itcRegisterCsv(res.items));
    });
    app.put(`/itc/:docType(purchase|expense)/:docId(${ID})`, manage, async (req) => {
      const t = guard(req.ctx, true);
      const p = z.object({ docType: z.string(), docId: z.string().uuid() }).parse(req.params);
      return service.setFlag(t, userId(req.ctx), p.docType, p.docId, req.body);
    });
    app.get("/rcm", view, async (req) => service.rcmRegister(guard(req.ctx, false), q(req)));

    // ---- typed-in figures
    app.get("/adjustments", view, async (req) => service.listAdjustments(guard(req.ctx, false), q(req).month));
    app.post("/adjustments", manage, async (req) => service.addAdjustment(guard(req.ctx, true), userId(req.ctx), req.body));
    app.delete(`/adjustments/:id(${ID})`, manage, async (req) => service.deleteAdjustment(guard(req.ctx, true), (req.params as { id: string }).id));
    app.get("/advances", view, async (req) => service.listAdvances(guard(req.ctx, false), q(req).month));
    app.post("/advances", manage, async (req) => service.addAdvance(guard(req.ctx, true), userId(req.ctx), req.body));
    app.delete(`/advances/:id(${ID})`, manage, async (req) => service.deleteAdvance(guard(req.ctx, true), (req.params as { id: string }).id));
    app.get("/payments", view, async (req) => service.listTaxPayments(guard(req.ctx, false), q(req)));
    app.post("/payments", manage, async (req) => service.addTaxPayment(guard(req.ctx, true), userId(req.ctx), req.body));
    app.delete(`/payments/:id(${ID})`, manage, async (req) => service.deleteTaxPayment(guard(req.ctx, true), (req.params as { id: string }).id));
    app.get("/filings", view, async (req) => service.listFilings(guard(req.ctx, false)));
    app.put("/filings", manage, async (req) => service.markFiled(guard(req.ctx, true), userId(req.ctx), req.body));
    app.delete("/filings/:type/:period", manage, async (req) => {
      const p = req.params as { type: string; period: string };
      return service.unmarkFiled(guard(req.ctx, true), p.type, p.period);
    });

    // ---- composition
    app.get("/cmp08", view, async (req) => {
      const key = q(req).quarter;
      if (!key) throw badRequest("Say which quarter: quarter=YYYY-Qn (Q1 = April to June)");
      return service.cmp08(guard(req.ctx, false), key);
    });
    app.get("/cmp08.csv", view, async (req, reply) => {
      const key = q(req).quarter ?? "";
      return file(reply, `CMP08_${key}.csv`, "text/csv", service.cmp08Csv(await service.cmp08(guard(req.ctx, false), key)));
    });
    app.get("/gstr4", view, async (req) => {
      const fy = Number(q(req).fy);
      if (!Number.isInteger(fy) || fy < 2017 || fy > 2100) throw badRequest("Say the financial year by its first year: fy=2026 for 2026-27");
      return service.gstr4(guard(req.ctx, false), fy);
    });

    // ---- GSTR-2B
    app.get("/gstr2b/imports", view, async (req) => reco.imports(guard(req.ctx, false)));
    await app.register(async (up) => {
      // The Excel file arrives as raw bytes; a JSON file as a normal JSON body.
      up.addContentTypeParser(UPLOAD_TYPES, { parseAs: "buffer", bodyLimit: MAX_UPLOAD }, (_req, body, done) => done(null, body));
      up.post("/gstr2b/import", { ...manage, bodyLimit: MAX_UPLOAD }, async (req) => {
        const t = guard(req.ctx, true);
        const v = q(req);
        const name = (req.headers["x-file-name"] as string | undefined) ?? v.filename ?? null;
        let parsed;
        let format: "json" | "xlsx";
        if (Buffer.isBuffer(req.body)) {
          format = "xlsx";
          try {
            parsed = reco.parse({ sheets: await readWorkbook(req.body) });
          } catch (err) {
            if (err instanceof XlsxError) throw badRequest(err.message);
            throw err;
          }
        } else {
          format = "json";
          parsed = reco.parse({ json: req.body });
        }
        return reco.import(t, userId(req.ctx), { parsed, month: v.month ? month(v.month) : null, filename: name, format });
      });
    });
    app.get("/gstr2b/:month(\\d{4}-\\d{2})", view, async (req) => reco.summary(guard(req.ctx, false), (req.params as { month: string }).month));
    app.get("/gstr2b/:month(\\d{4}-\\d{2})/rows", view, async (req) => {
      const v = q(req);
      return reco.list(guard(req.ctx, false), (req.params as { month: string }).month, { ...v, limit: v.limit ? Number(v.limit) : undefined, offset: v.offset ? Number(v.offset) : undefined });
    });
    app.get("/gstr2b/:month(\\d{4}-\\d{2})/suppliers", view, async (req) => reco.suppliers(guard(req.ctx, false), (req.params as { month: string }).month));
    app.get("/gstr2b/:month(\\d{4}-\\d{2})/export.csv", view, async (req, reply) => {
      const m = (req.params as { month: string }).month;
      const kind = q(req).kind === "suppliers" ? "suppliers" : "rows";
      return file(reply, `GSTR2B_${kind}_${m}.csv`, "text/csv", await reco.csv(guard(req.ctx, false), m, kind));
    });
    app.post("/gstr2b/:month(\\d{4}-\\d{2})/rematch", manage, async (req) => reco.rematch(guard(req.ctx, true), (req.params as { month: string }).month));
    app.delete("/gstr2b/:month(\\d{4}-\\d{2})", manage, async (req) => reco.remove(guard(req.ctx, true), (req.params as { month: string }).month));
    app.post(`/gstr2b/rows/:id(${ID})/action`, manage, async (req) => reco.act(guard(req.ctx, true), userId(req.ctx), (req.params as { id: string }).id, req.body));
  };
}

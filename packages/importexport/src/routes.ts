import { badRequest, permissionDenied, permissionsAllow, requireRole, requireTenant, type RequestContext } from "@srirealtime/core";
import type { FastifyContextConfig, FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { MultipartError, fileFromMultipart } from "./multipart";
import type { FullExportService } from "./fullexport";
import type { ImportExportService, UploadedFile } from "./service";
import type { ImportJobListQuery } from "./store";

export const IMPORTEXPORT_FEATURE = "importexport";
export const IMPORTEXPORT_PERMISSION = "importexport.run";

/** Content types the upload route accepts as a raw body (plus multipart/form-data). */
export const UPLOAD_CONTENT_TYPES = [
  "text/csv",
  "application/csv",
  "text/plain",
  "application/vnd.ms-excel", // what Windows browsers send for .csv
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
  "application/xml", // Tally XML exports
  "text/xml",
  "multipart/form-data",
];

const commitBody = z.object({
  mapping: z.record(z.string().max(60), z.union([z.string().max(200), z.number().int().min(0), z.null()])).optional(),
  skipInvalid: z.boolean().default(true),
  options: z.object({ carryDues: z.boolean().optional() }).optional(),
});
const sourceQuery = z.object({ source: z.string().max(20).optional() });
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const tallyQuery = z
  .object({ kind: z.enum(["sale", "purchase"]).default("sale"), from: dateStr, to: dateStr })
  .refine((q) => q.to >= q.from, { message: "To date is before From date", path: ["to"] });
const idParam = z.object({ id: z.string().uuid() });
const jobParam = z.object({ jobId: z.string().uuid() });

const cfg = (feature: string | string[], permission?: string) => ({
  config: { feature, ...(permission ? { permission } : {}) } as FastifyContextConfig,
});
const features = (own?: string) => (own && own !== IMPORTEXPORT_FEATURE ? [IMPORTEXPORT_FEATURE, own] : IMPORTEXPORT_FEATURE);

function staff(ctx: RequestContext, permission?: string) {
  const tenant = requireTenant(ctx);
  const user = requireRole(ctx, "owner", "admin", "staff");
  // When auth fills `permissions` (staff package), also check the importer's own permission (patterns such as
  // `catalogue.*` count; owners/admins hold "*").
  const perms = (user as { permissions?: string[] }).permissions;
  if (permission && perms && !user.platformRoles.includes("superadmin") && !permissionsAllow(perms, permission)) {
    if (!user.tenantRoles.some((r) => r === "owner" || r === "admin")) throw permissionDenied(permission);
  }
  return { tenant, user };
}

/** The uploaded file from a multipart form (field "file") or a raw body (file name from `x-file-name` or `?filename=`). */
function uploadedFile(req: FastifyRequest): UploadedFile {
  const body = req.body;
  if (!Buffer.isBuffer(body)) throw badRequest("Upload the file as multipart/form-data or as a raw CSV/XLSX body");
  const ct = req.headers["content-type"] ?? "";
  if (/^multipart\/form-data/i.test(ct)) {
    try {
      const f = fileFromMultipart(body, ct);
      return { fileName: f.fileName, contentType: f.contentType, data: f.data };
    } catch (err) {
      if (err instanceof MultipartError) throw badRequest(err.message);
      throw err;
    }
  }
  const headerName = req.headers["x-file-name"];
  const queryName = (req.query as Record<string, unknown> | undefined)?.filename;
  const raw = typeof headerName === "string" ? headerName : typeof queryName === "string" ? queryName : null;
  let fileName: string | null = null;
  if (raw) {
    try {
      fileName = decodeURIComponent(raw);
    } catch {
      fileName = raw;
    }
  }
  return { fileName, contentType: ct || null, data: body };
}

/**
 * `/v1/import`: per importer `POST /:key/preview`, `GET /:key/template.xlsx|csv`; generic `POST /:jobId/commit`,
 * `GET /:jobId`, `GET /jobs`, `GET /importers`. Importers must be registered before the host mounts the routes.
 */
export function importRoutes(service: ImportExportService) {
  return async (app: FastifyInstance) => {
    const bodyLimit = service.limits.maxBytes + 256 * 1024;
    // Scoped to this plugin: files arrive as Buffers; JSON (commit) keeps the default parser.
    app.addContentTypeParser(UPLOAD_CONTENT_TYPES, { parseAs: "buffer", bodyLimit }, (_req, body, done) => done(null, body));

    app.get("/importers", cfg(IMPORTEXPORT_FEATURE), async (req) => {
      staff(req.ctx);
      return { items: service.registry.listImporters() };
    });

    app.get("/sources", cfg(IMPORTEXPORT_FEATURE), async (req) => {
      staff(req.ctx);
      return { items: service.sources() };
    });

    app.get("/jobs", cfg(IMPORTEXPORT_FEATURE, IMPORTEXPORT_PERMISSION), async (req) => {
      const { tenant } = staff(req.ctx);
      return service.list(tenant.id, (req.query ?? {}) as ImportJobListQuery);
    });

    for (const imp of service.registry.listImporters()) {
      const def = service.registry.importer(imp.key)!;
      const conf = cfg(features(def.feature), IMPORTEXPORT_PERMISSION);

      app.post(`/${imp.key}/preview`, { ...conf, bodyLimit }, async (req) => {
        const { tenant, user } = staff(req.ctx, def.permission);
        const { source } = sourceQuery.parse(req.query ?? {});
        return service.preview(tenant.id, user.id, imp.key, uploadedFile(req), { source });
      });

      app.get(`/${imp.key}/template.xlsx`, conf, async (req, reply) => {
        staff(req.ctx);
        const buf = await service.templateXlsx(imp.key, sourceQuery.parse(req.query ?? {}).source);
        return reply
          .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
          .header("content-disposition", `attachment; filename="${imp.key.replace(/\./g, "-")}-template.xlsx"`)
          .send(buf);
      });

      app.get(`/${imp.key}/template.csv`, conf, async (req, reply) => {
        staff(req.ctx);
        return reply
          .header("content-type", "text/csv; charset=utf-8")
          .header("content-disposition", `attachment; filename="${imp.key.replace(/\./g, "-")}-template.csv"`)
          .send(service.templateCsv(imp.key));
      });
    }

    app.post("/:jobId/commit", cfg(IMPORTEXPORT_FEATURE, IMPORTEXPORT_PERMISSION), async (req) => {
      const { tenant } = staff(req.ctx);
      const { jobId } = jobParam.parse(req.params);
      const body = commitBody.parse(req.body ?? {});
      return service.commit(tenant.id, jobId, body);
    });

    // Undo a finished import batch (removes what it created; see ImportExportService.rollback).
    app.post("/:jobId/rollback", cfg(IMPORTEXPORT_FEATURE, IMPORTEXPORT_PERMISSION), async (req) => {
      const { tenant, user } = staff(req.ctx);
      requireRole(req.ctx, "owner", "admin");
      const { jobId } = jobParam.parse(req.params);
      return service.rollback(tenant.id, jobId, user.id);
    });

    // Row-level error report as CSV.
    app.get("/:jobId/errors.csv", cfg(IMPORTEXPORT_FEATURE, IMPORTEXPORT_PERMISSION), async (req, reply) => {
      const { tenant } = staff(req.ctx);
      const { jobId } = jobParam.parse(req.params);
      const out = await service.errorsCsv(tenant.id, jobId);
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${out.filename}"`)
        .header("cache-control", "private, no-store")
        .send(out.csv);
    });

    app.get("/:jobId", cfg(IMPORTEXPORT_FEATURE, IMPORTEXPORT_PERMISSION), async (req) => {
      const { tenant } = staff(req.ctx);
      const { jobId } = jobParam.parse(req.params);
      return service.status(tenant.id, jobId);
    });
  };
}

/** `/v1/export`: per exporter `GET /:key.csv` and `GET /:key.xlsx` (query passed to the exporter); `GET /exporters`. */
export function exportRoutes(service: ImportExportService, full?: FullExportService) {
  return async (app: FastifyInstance) => {
    if (full) {
      const ownerOnly = (ctx: RequestContext) => {
        const tenant = requireTenant(ctx);
        const user = requireRole(ctx, "owner");
        return { tenant, user };
      };
      const meta = (req: FastifyRequest) => ({ ip: req.ctx.ip ?? null, userAgent: req.ctx.userAgent ?? null });
      // "Export all my data": owner only, background job, signed download link, audited.
      app.post("/all", cfg(IMPORTEXPORT_FEATURE), async (req) => {
        const { tenant, user } = ownerOnly(req.ctx);
        return full.start(tenant.id, user.id, meta(req));
      });
      app.get("/all", cfg(IMPORTEXPORT_FEATURE), async (req) => {
        const { tenant } = ownerOnly(req.ctx);
        return full.list(tenant.id);
      });
      app.get("/all/:id", cfg(IMPORTEXPORT_FEATURE), async (req) => {
        const { tenant } = ownerOnly(req.ctx);
        return full.get(tenant.id, idParam.parse(req.params).id);
      });
      app.get("/all/:id/download", cfg(IMPORTEXPORT_FEATURE), async (req, reply) => {
        const { tenant, user } = ownerOnly(req.ctx);
        reply.header("cache-control", "private, no-store");
        return full.download(tenant.id, idParam.parse(req.params).id, user.id, meta(req));
      });
      app.get("/all/:id/file", cfg(IMPORTEXPORT_FEATURE), async (req, reply) => {
        const { tenant, user } = ownerOnly(req.ctx);
        const out = await full.file(tenant.id, idParam.parse(req.params).id, user.id, meta(req));
        return reply
          .header("content-type", "application/zip")
          .header("content-disposition", `attachment; filename="${out.fileName.replace(/[^\w.-]+/g, "_")}"`)
          .header("cache-control", "private, no-store")
          .send(out.data);
      });
      // Sales/purchase vouchers for Tally (import via Gateway of Tally > Import Data > Vouchers).
      app.get("/tally/vouchers.xml", cfg(IMPORTEXPORT_FEATURE), async (req, reply) => {
        const { tenant } = ownerOnly(req.ctx);
        const q = tallyQuery.parse(req.query ?? {});
        const out = await full.tallyXml(tenant.id, q);
        return reply
          .header("content-type", "application/xml; charset=utf-8")
          .header("content-disposition", `attachment; filename="${out.filename}"`)
          .header("x-voucher-count", String(out.count))
          .header("cache-control", "private, no-store")
          .send(out.xml);
      });
      app.get("/tally/vouchers.xlsx", cfg(IMPORTEXPORT_FEATURE), async (req, reply) => {
        const { tenant } = ownerOnly(req.ctx);
        const q = tallyQuery.parse(req.query ?? {});
        const out = await full.tallyXlsx(tenant.id, q);
        return reply
          .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
          .header("content-disposition", `attachment; filename="${out.filename}"`)
          .header("x-voucher-count", String(out.count))
          .header("cache-control", "private, no-store")
          .send(out.data);
      });
    }

    app.get("/exporters", cfg(IMPORTEXPORT_FEATURE), async (req) => {
      staff(req.ctx);
      return { items: service.registry.listExporters() };
    });

    for (const exp of service.registry.listExporters()) {
      const def = service.registry.exporter(exp.key)!;
      for (const format of ["csv", "xlsx"] as const) {
        app.get(`/${exp.key}.${format}`, cfg(features(def.feature), IMPORTEXPORT_PERMISSION), async (req, reply) => {
          const { tenant } = staff(req.ctx, def.permission);
          const query = Object.fromEntries(
            Object.entries((req.query ?? {}) as Record<string, unknown>).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 200) : undefined]),
          );
          const out = await service.export(tenant.id, exp.key, format, query);
          return reply
            .header("content-type", out.contentType)
            .header("content-disposition", `attachment; filename="${out.filename}"`)
            .header("cache-control", "private, no-store")
            .send(out.stream);
        });
      }
    }
  };
}

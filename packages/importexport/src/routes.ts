import { badRequest, permissionDenied, permissionsAllow, requireRole, requireTenant, type RequestContext } from "@srirealtime/core";
import type { FastifyContextConfig, FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { MultipartError, fileFromMultipart } from "./multipart";
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
  "multipart/form-data",
];

const commitBody = z.object({
  mapping: z.record(z.string().max(60), z.union([z.string().max(200), z.number().int().min(0), z.null()])).optional(),
  skipInvalid: z.boolean().default(true),
});
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

    app.get("/jobs", cfg(IMPORTEXPORT_FEATURE, IMPORTEXPORT_PERMISSION), async (req) => {
      const { tenant } = staff(req.ctx);
      return service.list(tenant.id, (req.query ?? {}) as ImportJobListQuery);
    });

    for (const imp of service.registry.listImporters()) {
      const def = service.registry.importer(imp.key)!;
      const conf = cfg(features(def.feature), IMPORTEXPORT_PERMISSION);

      app.post(`/${imp.key}/preview`, { ...conf, bodyLimit }, async (req) => {
        const { tenant, user } = staff(req.ctx, def.permission);
        return service.preview(tenant.id, user.id, imp.key, uploadedFile(req));
      });

      app.get(`/${imp.key}/template.xlsx`, conf, async (req, reply) => {
        staff(req.ctx);
        const buf = await service.templateXlsx(imp.key);
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

    app.get("/:jobId", cfg(IMPORTEXPORT_FEATURE, IMPORTEXPORT_PERMISSION), async (req) => {
      const { tenant } = staff(req.ctx);
      const { jobId } = jobParam.parse(req.params);
      return service.status(tenant.id, jobId);
    });
  };
}

/** `/v1/export`: per exporter `GET /:key.csv` and `GET /:key.xlsx` (query passed to the exporter); `GET /exporters`. */
export function exportRoutes(service: ImportExportService) {
  return async (app: FastifyInstance) => {
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

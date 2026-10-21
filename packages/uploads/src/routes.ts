import { requireRole, requireSuperAdmin, requireTenant, requireUser, type RequestContext } from "@srirealtime/core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { UploadsService } from "./service";
import { contentDisposition } from "./storage/s3";

const signBody = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(3).max(255),
  size: z.number().int().positive(),
  visibility: z.enum(["public", "private"]).default("private"),
  purpose: z
    .string()
    .regex(/^[a-z0-9_-]{1,40}$/)
    .optional(),
});

const idParams = z.object({ id: z.string().uuid() });

/** Tenant roles that may browse the shop's files. */
export const STAFF_ROLES = ["owner", "admin", "staff"] as const;

export const listQuery = z.object({
  purpose: z
    .string()
    .regex(/^[a-z0-9_-]{1,40}$/)
    .optional(),
  kind: z.enum(["image", "video"]).optional(),
  visibility: z.enum(["public", "private"]).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  cursor: z.string().max(200).optional(),
});
const signedQuery = z.object({ exp: z.string().optional(), sig: z.string().optional(), dl: z.string().optional() });

/** Tenant files when a tenant is resolved; platform files (no tenant) are super-admin only. */
function scope(ctx: RequestContext): string | null {
  if (ctx.tenant) return ctx.tenant.id;
  requireSuperAdmin(ctx);
  return null;
}

/** One `bytes=` range of a `size`-byte body: null when absent / not a single range, "invalid" when unsatisfiable. */
export function byteRange(header: string | undefined, size: number): { start: number; end: number } | null | "invalid" {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    // "bytes=-500": the last 500 bytes.
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (size === 0 || start >= size || start > end) return "invalid";
  return { start, end };
}

const wildcardKey = (params: unknown) => {
  const raw = (params as Record<string, string | undefined>)["*"] ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

export function uploadsRoutes(service: UploadsService) {
  return async (app: FastifyInstance) => {
    app.post("/sign", async (req) => {
      const user = requireUser(req.ctx);
      const tenantId = scope(req.ctx);
      const body = signBody.parse(req.body);
      return service.sign({ ...body, tenantId, userId: user.id });
    });

    app.post("/:id/complete", async (req) => {
      const user = requireUser(req.ctx);
      const tenantId = scope(req.ctx);
      const { id } = idParams.parse(req.params);
      return service.complete(id, { tenantId, userId: user.id });
    });

    // The shop's files, newest first (Files page, the site editor's media library). Staff only: customers who are
    // signed in on the store never see what the shop has uploaded.
    app.get("/", async (req) => {
      requireRole(req.ctx, ...STAFF_ROLES);
      const tenant = requireTenant(req.ctx);
      const q = listQuery.parse(req.query);
      return service.page({ tenantId: tenant.id, ...q });
    });

    app.get("/:id", async (req) => {
      const { id } = idParams.parse(req.params);
      const tenantId = req.ctx.tenant?.id ?? null;
      if (!tenantId) requireSuperAdmin(req.ctx);
      const file = await service.get(id, tenantId);
      if (file.visibility === "private") requireUser(req.ctx);
      return file;
    });

    app.delete("/:id", async (req) => {
      const user = requireUser(req.ctx);
      const tenantId = scope(req.ctx);
      const { id } = idParams.parse(req.params);
      const file = await service.get(id, tenantId);
      if (file.ownerUserId !== user.id) {
        if (tenantId) requireRole(req.ctx, "owner", "admin");
        else requireSuperAdmin(req.ctx);
      }
      await service.remove(id, tenantId);
      return { ok: true };
    });

    // Local disk driver only: signed uploads and file serving through the API.
    if (service.storage.driver === "local") {
      await app.register(async (local) => {
        // Accept any body as a raw Buffer in this scope only.
        local.removeAllContentTypeParsers();
        local.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: service.maxBytes }, (_req, body, done) => done(null, body));

        local.put("/local/*", { bodyLimit: service.maxBytes }, async (req) => {
          const key = wildcardKey(req.params);
          const query = signedQuery.parse(req.query);
          const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
          await service.localUploadHandler(key, query, body);
          return { ok: true };
        });

        local.get("/files/*", async (req, reply) => {
          const key = wildcardKey(req.params);
          const query = signedQuery.parse(req.query);
          const file = await service.localFileHandler(key, query);
          reply.header("content-type", file.contentType);
          reply.header("x-content-type-options", "nosniff");
          reply.header("cache-control", query.sig ? "private, max-age=600" : "public, max-age=86400");
          if (file.downloadName) reply.header("content-disposition", contentDisposition(file.downloadName));
          reply.header("accept-ranges", "bytes");
          // Byte ranges, so browsers can stream and seek a hero video (Safari won't play video without them).
          const range = byteRange(req.headers.range, file.body.length);
          if (range === "invalid") {
            reply.header("content-range", `bytes */${file.body.length}`);
            return reply.code(416).send();
          }
          if (range) {
            reply.code(206).header("content-range", `bytes ${range.start}-${range.end}/${file.body.length}`);
            return reply.send(file.body.subarray(range.start, range.end + 1));
          }
          return reply.send(file.body);
        });
      });
    }
  };
}
